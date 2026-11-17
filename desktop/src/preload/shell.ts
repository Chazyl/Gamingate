import { contextBridge, ipcRenderer } from 'electron'
// Channel constants come from the zod-free module; the contract is imported
// TYPE-ONLY (erased) so this sandboxed preload never pulls zod at runtime.
import { IPC } from '../shared/shell-channels'
import type {
  ChordBlockedPayload,
  DecodeMode,
  DecodeState,
  HealthSnapshot,
  GamingateApi,
  PlatformSummary,
  Prefs,
  PrefsPatch,
  RestartOutcome,
  SessionState,
  SetCodecForceArgs
} from '../shared/shell-contract'

/**
 * Trusted shell preload (SHL-01).
 *
 * Exposes ONLY the explicit named `gamingate` API — never a generic
 * `send(channel, ...)` passthrough (threat T-03-13). Every method here has a
 * matching `handleTrusted` handler in main/shell/ipc.ts; the `shell-ipc-gate`
 * step asserts the exposed/declared/handled sets are identical, so a handler
 * that lands later phase cannot be reachable without a bridge added with it.
 */
const api: GamingateApi = {
  listPlatforms: () => ipcRenderer.invoke(IPC.listPlatforms) as Promise<PlatformSummary[]>,
  launch: (id: string) => ipcRenderer.invoke(IPC.launch, id) as Promise<SessionState>,
  stop: (id: string) => ipcRenderer.invoke(IPC.stop, id) as Promise<SessionState>,
  clearProvider: (id: string) => ipcRenderer.invoke(IPC.clearProvider, id) as Promise<boolean>,
  sessionState: () => ipcRenderer.invoke(IPC.sessionState) as Promise<SessionState>,
  setOverlay: (visible: boolean) => ipcRenderer.invoke(IPC.setOverlay, visible) as Promise<boolean>,
  getPrefs: () => ipcRenderer.invoke(IPC.getPrefs) as Promise<Prefs>,
  setPrefs: (patch: PrefsPatch) => ipcRenderer.invoke(IPC.setPrefs, patch) as Promise<Prefs>,
  getDecodeState: () => ipcRenderer.invoke(IPC.getDecodeState) as Promise<DecodeState>,
  setDecodeMode: (mode: DecodeMode) =>
    ipcRenderer.invoke(IPC.setDecodeMode, mode) as Promise<RestartOutcome>,
  setCodecForce: (args: SetCodecForceArgs) =>
    ipcRenderer.invoke(IPC.setCodecForce, args) as Promise<RestartOutcome>,
  onSessionState: (cb: (state: SessionState) => void) => {
    const listener = (_event: unknown, state: SessionState): void => cb(state)
    ipcRenderer.on(IPC.sessionState, listener)
    return () => {
      ipcRenderer.off(IPC.sessionState, listener)
    }
  },
  onChordBlocked: (cb: (label: ChordBlockedPayload) => void) => {
    const listener = (_event: unknown, label: ChordBlockedPayload): void => cb(label)
    ipcRenderer.on(IPC.chordBlocked, listener)
    return () => {
      ipcRenderer.off(IPC.chordBlocked, listener)
    }
  },
  onHealth: (cb: (snapshot: HealthSnapshot) => void) => {
    const listener = (_event: unknown, snapshot: HealthSnapshot): void => cb(snapshot)
    ipcRenderer.on(IPC.health, listener)
    return () => {
      ipcRenderer.off(IPC.health, listener)
    }
  }
}

contextBridge.exposeInMainWorld('gamingate', Object.freeze(api))
