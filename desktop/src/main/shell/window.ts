import { BaseWindow, WebContentsView } from 'electron'
import type { PlatformPacket } from '../../shared/types'
import { originAllowed } from '../session/header-rules'
import { rendererSandboxEnabled } from '../runtime/sandbox'
import { createProviderView } from '../view/view-manager'
import { computeShellLayout } from './layout'

/** Height of the in-session top chrome bar (UI-SPEC `2xl` token, exactly 48px). */
export const CHROME_BAR_HEIGHT = 48

/** Overlay panel footprint (UI-SPEC surface 4: 280px wide, top-right, 16px inset). */
export const OVERLAY_WIDTH = 280
export const OVERLAY_INSET = 16
export const OVERLAY_HEIGHT = 220

export interface ShellWindowDeps {
  shellPreloadPath: string
  providerPreloadPath: string
  /** Renderer entry URL (dev server URL or built index.html file://). */
  rendererUrl: string
}

export interface ShellWindow {
  window: BaseWindow
  /** The trusted React shell view (child index 0). */
  shellView: WebContentsView
  /** The live provider view, or null when no session is active. */
  providerView: WebContentsView | null
  /** The trusted transparent overlay view, or null when hidden. */
  overlayView: WebContentsView | null
  /** Register the trusted shell webContents id + origin for IPC allowlisting. */
  onShellReady: (cb: (wc: Electron.WebContents, origin: string) => void) => void
  /** Create + load the provider view; returns it. Throws if one is live. */
  createProvider: (packet: PlatformPacket) => WebContentsView
  /** Remove and explicitly close the provider view (keeps the partition). */
  destroyProvider: () => void
  /** Show/hide the top chrome bar (relayouts shell vs provider bounds). */
  setChromeVisible: (visible: boolean) => void
  /** Create or remove the transparent trusted overlay child (index 2). */
  setOverlayVisible: (visible: boolean) => void
  /** Register the main-intercepted Ctrl+Shift+S overlay-toggle handler. */
  onOverlayToggle: (cb: () => void) => void
  /** Focus the provider view (input passthrough). */
  focusProvider: () => void
  /** Toggle OS fullscreen. */
  toggleFullscreen: () => void
  /** Tear the whole window down, closing every child webContents. */
  destroy: () => void
}

function shellOriginOf(url: string): string {
  return new URL(url).origin
}

/**
 * Compose the multi-view trusted shell (SHL-01, research Pattern 1):
 *
 *   contentView
 *     ├── shellView    (index 0) trusted React chrome, HAS the gamingate bridge
 *     ├── providerView (index 1) packet partition, INERT preload, no bridge
 *     └── overlayView  (index 2) transparent trusted sibling, health only
 *
 * The shell and provider are separate native views: the shell cannot read
 * provider content and the provider has no bridge (its webPreferences come from
 * `createProviderView`, the same builder the capture lane uses — never the shell
 * preload). `BaseWindow` does not destroy child webContents, so teardown closes
 * every one explicitly (guarded against double-close).
 */
export function createShellWindow(deps: ShellWindowDeps): ShellWindow {
  const window = new BaseWindow({
    width: 1280,
    height: 800,
    title: 'Gamingate'
  })

  const shellView = new WebContentsView({
    webPreferences: {
      preload: deps.shellPreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: rendererSandboxEnabled()
    }
  })
  // Shell chrome must never be navigated away from its own origin.
  shellView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  let chromeVisible = false
  let htmlFullScreen = false
  let providerView: WebContentsView | null = null
  let overlayView: WebContentsView | null = null
  let destroyed = false

  const relayout = (): void => {
    if (destroyed) return
    const [w, h] = window.getContentSize()
    // Picker mode (no provider): the shell fills the window. Session mode: the
    // shell is only the top chrome bar. HTML fullscreen gives the provider the
    // whole window (a WebContentsView's HTML fullscreen fills only the view, so
    // main must expand it — 03-RESEARCH "HTML fullscreen").
    const { shell, provider } = computeShellLayout({
      width: w,
      height: h,
      hasProvider: providerView !== null,
      chromeVisible,
      htmlFullScreen,
      chromeBarHeight: CHROME_BAR_HEIGHT
    })
    shellView.setBounds(shell)
    if (providerView && provider) providerView.setBounds(provider)
    if (overlayView) {
      const bar = provider ? provider.y : 0
      overlayView.setBounds({
        x: Math.max(0, w - OVERLAY_WIDTH - OVERLAY_INSET),
        y: bar + OVERLAY_INSET,
        width: OVERLAY_WIDTH,
        height: OVERLAY_HEIGHT
      })
    }
  }

  window.contentView.addChildView(shellView, 0)
  relayout()
  void shellView.webContents.loadURL(deps.rendererUrl)

  // Overlay toggle chord (Ctrl+Shift+S). The chord is consumed by main here, on
  // the trusted shell view, so it works even when the provider would otherwise
  // swallow it — the provider page never sees it (SHL-03, INP-03). The engine
  // owns overlay visibility, so main just forwards the request.
  let onOverlayToggle: (() => void) | null = null
  shellView.webContents.on('before-input-event', (event, input) => {
    const mod = input.control || input.meta
    if (input.type === 'keyDown' && mod && input.shift && input.key.toLowerCase() === 's') {
      event.preventDefault()
      onOverlayToggle?.()
    }
  })

  const providerReady = (wc: Electron.WebContents, allowedOrigins: string[]): void => {
    // Provider popups (e.g. some SSO windows) are denied; log the URL so a
    // packaged-app sign-in failure is diagnosable rather than silent.
    wc.setWindowOpenHandler(({ url }) => {
      console.warn('PROVIDER_POPUP_BLOCKED', url)
      return { action: 'deny' }
    })
    // The provider view is a separate webContents, so it can never navigate the
    // shell frame. This blocks the PROVIDER view's own top-level navigations to
    // origins the packet did not declare — defense-in-depth on top of the
    // session's origin-scoped header/permission policy (IM-03). Log blocks so a
    // missing sign-in step is diagnosable.
    wc.on('will-navigate', (event, url) => {
      if (!originAllowed(url, allowedOrigins)) {
        console.warn('PROVIDER_NAV_BLOCKED', url)
        event.preventDefault()
      }
    })
  }

  const createProvider = (packet: PlatformPacket): WebContentsView => {
    if (providerView) throw new Error('shell: a provider view is already live')
    const view = createProviderView(packet, deps.providerPreloadPath)
    providerView = view
    providerReady(view.webContents, packet.allowedOrigins)

    // Provider HTML fullscreen fills the view, not the screen: expand the view to
    // the whole window, hide the chrome bar, and go true OS fullscreen. Restore
    // on leave. (INP-02, threat T-03-22 — one relayout owner.)
    view.webContents.on('enter-html-full-screen', () => {
      htmlFullScreen = true
      relayout()
      if (!window.isFullScreen()) window.setFullScreen(true)
    })
    view.webContents.on('leave-html-full-screen', () => {
      htmlFullScreen = false
      if (window.isFullScreen()) window.setFullScreen(false)
      relayout()
    })

    window.contentView.addChildView(view, 1)
    relayout()
    return view
  }

  const destroyProvider = (): void => {
    const view = providerView
    if (!view) return
    providerView = null
    htmlFullScreen = false
    // Never leave the window stuck in OS fullscreen after the session ends.
    if (window.isFullScreen()) window.setFullScreen(false)
    // remove first, then explicitly close (BaseWindow does not close children).
    window.contentView.removeChildView(view)
    if (!view.webContents.isDestroyed()) view.webContents.close()
    relayout()
  }

  const setChromeVisible = (visible: boolean): void => {
    chromeVisible = visible
    relayout()
  }

  const setOverlayVisible = (visible: boolean): void => {
    if (visible === (overlayView !== null)) return
    if (visible) {
      const view = new WebContentsView({
        webPreferences: {
          preload: deps.shellPreloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: rendererSandboxEnabled(),
          transparent: true
        }
      })
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      overlayView = view
      window.contentView.addChildView(view, 2)
      void view.webContents.loadURL(deps.rendererUrl + '?surface=overlay')
    } else if (overlayView) {
      const view = overlayView
      overlayView = null
      // Removed outright when hidden: a sibling WebContentsView cannot be
      // per-view click-through, so leaving it over the game would create an
      // input dead-zone (Pitfall 7). Absent is the only safe hidden state.
      window.contentView.removeChildView(view)
      if (!view.webContents.isDestroyed()) view.webContents.close()
    }
    relayout()
  }

  window.on('resize', relayout)
  // A fullscreen transition changes the content size; relayout explicitly so
  // provider/shell/overlay bounds stay consistent on both platforms.
  window.on('enter-full-screen', relayout)
  window.on('leave-full-screen', relayout)

  // Leak guard: close every child webContents explicitly on window close.
  window.on('closed', () => {
    destroyed = true
    if (providerView && !providerView.webContents.isDestroyed()) {
      providerView.webContents.close()
    }
    if (overlayView && !overlayView.webContents.isDestroyed()) {
      overlayView.webContents.close()
    }
    if (!shellView.webContents.isDestroyed()) shellView.webContents.close()
  })

  return {
    window,
    shellView,
    get providerView() {
      return providerView
    },
    get overlayView() {
      return overlayView
    },
    onShellReady: (cb) => {
      const fire = (): void => {
        cb(shellView.webContents, shellOriginOf(shellView.webContents.getURL()))
      }
      if (shellView.webContents.getURL()) fire()
      else shellView.webContents.once('did-finish-load', fire)
    },
    createProvider,
    destroyProvider,
    setChromeVisible,
    setOverlayVisible,
    onOverlayToggle: (cb) => {
      onOverlayToggle = cb
    },
    focusProvider: () => {
      providerView?.webContents.focus()
    },
    toggleFullscreen: () => {
      window.setFullScreen(!window.isFullScreen())
    },
    destroy: () => {
      if (!window.isDestroyed()) window.close()
    }
  }
}
