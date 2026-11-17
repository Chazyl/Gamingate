import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { clearProvider } from '../session/session-manager'
import type { PlatformPacket, Registry } from '../../shared/types'
import { isTrustedDocument } from './trusted-url'
import {
  ClearArgs,
  DecodeMode,
  IPC,
  LaunchArgs,
  PrefsPatch,
  SetCodecForceArgs,
  SetOverlayArgs,
  StopArgs,
  type DecodeState,
  type PlatformSummary,
  type Prefs,
  type RestartOutcome,
  type SessionState
} from '../../shared/shell-contract'

/**
 * Trusted-shell IPC allowlist (SHL-01, research "Trusted IPC").
 *
 * ONE wrapper — `handleTrusted` — gates every privileged handler behind
 * `assertTrustedShell`, which requires ALL of:
 *   1. `event.sender.id === registered shell webContents id` (a different
 *      webContents — e.g. the provider view — fails closed, threat T-03-01)
 *   2. `event.senderFrame === event.sender.mainFrame` (no subframes, T-03-02)
 *   3. the frame's URL is the registered trusted shell document (T-03-03;
 *      full-document compare for opaque `file://` origins — IM-03)
 *
 * The provider view is a different WebContents with no bridge at all, so it can
 * never satisfy (1); the provider preload exposes no ipcRenderer (T-03-13).
 */

// Registered trusted shell identity. Set from the shell webContents once it has
// loaded. Empty until then => every call fails closed.
let shellWebContentsId = -1
let shellUrlAllowlist: string[] = []
const writeChannels = new Set<string>()
const readChannels = new Set<string>()

export function registerShellView(webContents: Electron.WebContents, trustedUrl: string): void {
  shellWebContentsId = webContents.id
  shellUrlAllowlist = [trustedUrl]
}

/** Test-only reset so unit tests do not leak registration across cases. */
export function __resetShellRegistry(): void {
  shellWebContentsId = -1
  shellUrlAllowlist = []
  writeChannels.clear()
  readChannels.clear()
}

/**
 * Throws unless the event comes from the registered shell main frame on the
 * trusted shell document. Never returns a boolean callers might ignore — fail
 * closed.
 */
export function assertTrustedShell(event: IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  // senderFrame may be null after the frame navigated/destroyed.
  if (!frame) throw new Error('ipc: sender frame destroyed')
  if (event.sender.id !== shellWebContentsId) throw new Error('ipc: untrusted webContents')
  if (frame !== event.sender.mainFrame) throw new Error('ipc: subframe not allowed')
  if (!shellUrlAllowlist.some((trusted) => isTrustedDocument(frame.url, trusted))) {
    throw new Error('ipc: untrusted origin')
  }
}

/**
 * Wrap `ipcMain.handle` with the trusted-sender gate. `fn` is NEVER invoked when
 * the gate throws. `write` channels list every privileged handler so the
 * bridge-coverage gate can assert the exposed/declared/handled sets match.
 */
export function handleTrusted(
  channel: string,
  access: 'read' | 'write',
  fn: (...args: unknown[]) => unknown
): void {
  if (access === 'write') writeChannels.add(channel)
  else readChannels.add(channel)
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedShell(event)
    return fn(...args)
  })
}

/** Channels registered through `handleTrusted` (for the coverage gate/tests). */
export function handledChannels(): { read: string[]; write: string[] } {
  return { read: [...readChannels], write: [...writeChannels] }
}

export interface ShellIpcDeps {
  registry: Registry
  /** Summaries for the registry list; sign-in detection is async (cookie jar). */
  listPlatforms: () => PlatformSummary[] | Promise<PlatformSummary[]>
  launch: (id: string) => SessionState
  stop: (id: string) => SessionState
  sessionState: () => SessionState
  setOverlay: (visible: boolean) => void
  /** Read local prefs (validated + defaulted in main). */
  getPrefs: () => Prefs
  /** Validate + persist a prefs patch; rejects an invalid enum. */
  setPrefs: (patch: unknown) => Prefs
  /** Evidence-based decode state (persisted-or-default, never invented). */
  getDecodeState: () => DecodeState
  /** Persist the decode mode + relaunch; a blocked relaunch returns an error. */
  setDecodeMode: (mode: DecodeMode) => RestartOutcome
  /** Persist a provider-dependent codec-force hint + relaunch to apply it. */
  setCodecForce: (args: SetCodecForceArgs) => RestartOutcome
}

/**
 * Register this plan's foundation handlers. Every handler is wrapped by
 * `handleTrusted` and validates its payload with zod. `clear-provider` resolves
 * the packet from the registry by id — never a raw partition from the renderer
 * (threat T-03-04).
 */
export function registerShellIpc(deps: ShellIpcDeps): void {
  const { registry } = deps

  handleTrusted(IPC.listPlatforms, 'read', () => deps.listPlatforms())

  handleTrusted(IPC.launch, 'write', (raw) => {
    const id = LaunchArgs.parse(raw)
    return deps.launch(id)
  })

  handleTrusted(IPC.stop, 'write', (raw) => {
    const id = StopArgs.parse(raw)
    return deps.stop(id)
  })

  handleTrusted(IPC.clearProvider, 'write', async (raw) => {
    const id = ClearArgs.parse(raw)
    const packet: PlatformPacket | undefined = registry.platforms.find((p) => p.id === id)
    if (!packet) throw new Error(`ipc: unknown platform '${id}'`)
    await clearProvider(packet)
    return true
  })

  handleTrusted(IPC.sessionState, 'read', () => deps.sessionState())

  handleTrusted(IPC.setOverlay, 'write', (raw) => {
    const visible = SetOverlayArgs.parse(raw)
    deps.setOverlay(visible)
    return true
  })

  handleTrusted(IPC.getPrefs, 'read', () => deps.getPrefs())

  handleTrusted(IPC.setPrefs, 'write', (raw) => {
    const patch = PrefsPatch.parse(raw)
    return deps.setPrefs(patch)
  })

  handleTrusted(IPC.getDecodeState, 'read', () => deps.getDecodeState())

  handleTrusted(IPC.setDecodeMode, 'write', (raw) =>
    deps.setDecodeMode(DecodeMode.parse(raw))
  )

  handleTrusted(IPC.setCodecForce, 'write', (raw) =>
    deps.setCodecForce(SetCodecForceArgs.parse(raw))
  )
}
