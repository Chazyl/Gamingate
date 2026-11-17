import type { WebContents } from 'electron'
import type { PlatformPacket, Registry } from '../../shared/types'
import { sessionFor, configureSession } from '../session/session-manager'
import type { ShellWindow } from './window'
import { reduce, type SessionEvent } from './session-state'
import { detectSignInState } from './signin'
import { readPrefs, writePrefs } from './prefs'
import { attachChordBlocker } from './chords'
import { startHealth } from './health'
import { createSleepInhibitor } from './power'
import {
  IPC,
  IDLE_SESSION,
  type Prefs,
  type PrefsPatch,
  type PlatformSummary,
  type SessionState
} from '../../shared/shell-contract'

/**
 * Session orchestration (SHL-01): launch/stop/clear over the Phase 2
 * registry/session path, driving the pure session-state machine and broadcasting
 * every transition to the trusted views.
 *
 *   launch -> sessionFor + configureSession -> shellWindow.createProvider(packet)
 *            -> loadURL(entryUrl) -> did-finish-load -> running
 *   stop   -> shellWindow.destroyProvider() (explicit webContents.close())
 *            -> stopped (the partition/session is KEPT)
 */
export interface EngineDeps {
  registry: Registry
  shellWindow: ShellWindow
  /** Trusted webContents that receive session-state broadcasts. */
  broadcast: (channel: string, payload: unknown) => void
  /** `app.getPath('userData')` — the only directory prefs may be written to. */
  prefsDir: string
}

export interface Engine {
  listPlatforms: () => Promise<PlatformSummary[]>
  launch: (id: string) => SessionState
  stop: (id: string) => SessionState
  sessionState: () => SessionState
  setOverlay: (visible: boolean) => void
  getPrefs: () => Prefs
  setPrefs: (patch: unknown) => Prefs
  current: () => SessionState
  dispose: () => void
  /** Release the sleep blocker on quit (SHL-04 will-quit path). */
  releaseSleep: () => void
}

export function createEngine(deps: EngineDeps): Engine {
  let state: SessionState = IDLE_SESSION
  let overlayVisible = false
  const listeners: Array<() => void> = []
  let stopHealth: (() => void) | null = null
  const sleep = createSleepInhibitor()

  const dispatch = (event: SessionEvent): SessionState => {
    const previous = state.status
    state = reduce(state, event)
    deps.broadcast(IPC.sessionState, state)
    // Focus retention (INP-01, PERF-03): hand focus to the provider the moment a
    // session begins running; the shell/overlay never call focus() while running.
    if (previous !== 'running' && state.status === 'running') {
      deps.shellWindow.focusProvider()
      // Keep the display awake for the whole session (SHL-04).
      sleep.engage()
    }
    return state
  }

  const stopHealthSampler = (): void => {
    if (stopHealth) {
      stopHealth()
      stopHealth = null
    }
  }

  const detachProvider = (): void => {
    stopHealthSampler()
    for (const off of listeners.splice(0)) off()
  }

  /** Single owner of overlay visibility (F11-adjacent chord + shell toggle). */
  const setOverlay = (visible: boolean): void => {
    overlayVisible = visible
    deps.shellWindow.setOverlayVisible(visible)
  }

  // The Ctrl+Shift+S chord is intercepted by main on the trusted shell view so
  // the provider page never receives it; main just forwards the toggle request.
  deps.shellWindow.onOverlayToggle(() => setOverlay(!overlayVisible))

  /**
   * An error must return the user to the picker. Hiding chrome is not enough:
   * the provider sibling sits above the shell view, so it is torn down too.
   */
  const failSession = (error: string, kind: 'failed' | 'crash'): SessionState => {
    const next = dispatch({ type: kind, error })
    stopHealthSampler()
    sleep.release()
    deps.shellWindow.setChromeVisible(false)
    setOverlay(false)
    deps.shellWindow.destroyProvider()
    return next
  }

  const resolvePacket = (id: string): PlatformPacket => {
    const packet = deps.registry.platforms.find((p) => p.id === id)
    if (!packet) throw new Error(`engine: unknown platform '${id}'`)
    return packet
  }

  const listPlatforms = async (): Promise<PlatformSummary[]> =>
    Promise.all(
      deps.registry.platforms.map(async (p) => ({
        id: p.id,
        name: p.name,
        // Evidence-based: reads cookie NAME presence only, never a value.
        signIn: await detectSignInState(p, sessionFor(p)),
        codecHints: p.codecHints,
        thirdPartyCookies: p.thirdPartyCookies,
        userAgent: p.userAgent
      }))
    )

  const launch = (id: string): SessionState => {
    if (state.status === 'starting' || state.status === 'running') {
      throw new Error('engine: a session is already active')
    }
    const packet = resolvePacket(id)
    const ses = sessionFor(packet)
    configureSession(ses, packet)

    dispatch({ type: 'launch', platformId: id })
    deps.shellWindow.setChromeVisible(true)

    let view: WebContents
    try {
      view = deps.shellWindow.createProvider(packet).webContents
    } catch (error) {
      deps.shellWindow.setChromeVisible(false)
      return dispatch({ type: 'failed', error: error instanceof Error ? error.message : String(error) })
    }

    view.once('did-finish-load', () => {
      // Start the read-only CDP Media sampler the moment the session is live.
      // The session status is stamped onto each push so the (push-only) overlay
      // needs no privileged IPC invoke of its own.
      stopHealthSampler()
      stopHealth = startHealth(view, (snapshot) =>
        deps.broadcast(IPC.health, { ...snapshot, sessionStatus: state.status })
      )
      dispatch({ type: 'loaded' })
    })
    view.once('did-fail-load', (_e, _code, description, _url, isMainFrame) => {
      if (!isMainFrame) return
      failSession(description, 'failed')
    })
    view.once('render-process-gone', (_e, details) =>
      failSession(details?.reason ?? 'process gone', 'crash')
    )
    listeners.push(() => view.removeAllListeners('did-finish-load'))
    listeners.push(() => view.removeAllListeners('did-fail-load'))
    listeners.push(() => view.removeAllListeners('render-process-gone'))

    // Gaming-mode chord blocker (INP-03): scoped to this provider webContents and
    // gated on `running`; every block is surfaced as a toast via the broadcast.
    listeners.push(
      attachChordBlocker(view, {
        isRunning: () => state.status === 'running',
        onBlock: (label) => deps.broadcast(IPC.chordBlocked, label),
        onFullscreen: () => deps.shellWindow.toggleFullscreen(),
        onOverlay: () => setOverlay(!overlayVisible)
      })
    )

    void view.loadURL(packet.entryUrl)
    return state
  }

  const stop = (): SessionState => {
    detachProvider()
    sleep.release()
    deps.shellWindow.destroyProvider()
    deps.shellWindow.setChromeVisible(false)
    setOverlay(false)
    return dispatch({ type: 'stop' })
  }

  return {
    listPlatforms,
    launch,
    stop: () => stop(),
    sessionState: () => state,
    setOverlay,
    getPrefs: () => readPrefs(deps.prefsDir),
    // PrefsPatch.parse inside writePrefs rejects an invalid enum before writing.
    setPrefs: (patch) => writePrefs(deps.prefsDir, patch as PrefsPatch),
    current: () => state,
    releaseSleep: () => sleep.release(),
    dispose: () => {
      detachProvider()
    }
  }
}
