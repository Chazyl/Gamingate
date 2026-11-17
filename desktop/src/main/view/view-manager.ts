import { BaseWindow, WebContentsView } from 'electron'
import type { WebPreferences } from 'electron'
import type { PlatformPacket } from '../../shared/types'
import { encodePlatformSpoof } from '../../shared/platform-spoof'
import { rendererSandboxEnabled } from '../runtime/sandbox'

export interface PlatformView {
  window: BaseWindow
  view: WebContentsView
}

/**
 * The single owner of a provider view's webPreferences. The capture/keep-open
 * lane (`createPlatformView`) and the shell composition (`window.ts`) both go
 * through here so an isolated provider view can never drift from the other.
 *
 * - Provider page is TOP-LEVEL (no iframe/webviewTag), on the packet partition.
 * - `preload` is the INERT provider bridge — no IPC surface.
 * - `backgroundThrottling: false` is set at CREATION (PERF-03, Pitfall 5):
 *   toggling it at runtime while occluded desyncs visibility and hides <video>.
 */
export function buildProviderWebPreferences(
  packet: PlatformPacket,
  preloadPath: string
): WebPreferences {
  const preferences: WebPreferences = {
    partition: packet.partition,
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: rendererSandboxEnabled(),
    backgroundThrottling: false
  }
  // OS spoof is delivered to the INERT preload as an argv argument; the preload
  // injects the main-world overrides before any page script runs. Only present
  // when the packet opts in.
  if (packet.platformSpoof) {
    preferences.additionalArguments = [encodePlatformSpoof(packet.platformSpoof)]
  }
  return preferences
}

/**
 * Create one isolated provider view (not yet added to any window). The caller
 * owns composition, bounds, and teardown; this function only builds the view.
 */
export function createProviderView(packet: PlatformPacket, preloadPath: string): WebContentsView {
  return new WebContentsView({ webPreferences: buildProviderWebPreferences(packet, preloadPath) })
}

/**
 * Compose one isolated provider view in its own BaseWindow, navigated TOP-LEVEL
 * to the packet entry URL. This is the `--capture`/`--keep-open` engine lane and
 * is unchanged from Phase 2 (the shell lane composes siblings in window.ts).
 *
 * - Explicit leak guard: BaseWindow does not destroy child webContents.
 */
export function createPlatformView(packet: PlatformPacket, preloadPath: string): PlatformView {
  const window = new BaseWindow({
    width: 1280,
    height: 800,
    title: packet.name
  })

  const view = createProviderView(packet, preloadPath)
  window.contentView.addChildView(view)
  const [width, height] = window.getContentSize()
  view.setBounds({ x: 0, y: 0, width, height })

  window.on('resize', () => {
    const [w, h] = window.getContentSize()
    view.setBounds({ x: 0, y: 0, width: w, height: h })
  })

  // Leak guard (Pitfall 3): BaseWindow does not close child webContents.
  window.on('closed', () => {
    if (!view.webContents.isDestroyed()) view.webContents.close()
  })

  // Top-level navigation to the provider — this is the embed mechanism.
  void view.webContents.loadURL(packet.entryUrl)

  return { window, view }
}
