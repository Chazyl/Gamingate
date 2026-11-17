import { z } from 'zod'

/**
 * Trusted-shell IPC contract (SHL-01).
 *
 * Single source of truth for the channels, payload schemas, and the renderer
 * bridge surface. `GamingateApi` is the EXACT set of methods the shell preload
 * exposes — every method here has an `ipcMain.handle` in main/shell/ipc.ts and
 * vice-versa (enforced by the `shell-ipc-gate` step). Later Phase 3 plans extend
 * this file and the matching preload/handler sets in the SAME plan.
 */

// Channel names live in a zod-free module so the sandboxed preload can import
// them without pulling zod. Re-exported here for main/renderer callers.
export { IPC } from './shell-channels'

/** Session lifecycle as seen by the shell (drives every phase-3 subsystem). */
export const SessionStatus = z.enum(['stopped', 'starting', 'running', 'error'])
export type SessionStatus = z.infer<typeof SessionStatus>

/** Evidence-based provider sign-in state; 'unknown' when no hints are declared. */
export const SignInState = z.enum(['unknown', 'signed-out', 'signed-in'])
export type SignInState = z.infer<typeof SignInState>

/**
 * One registry packet as surfaced to the shell. No partition and no cookie
 * values ever cross the bridge; the UA is a read-only display string and the
 * codec/cookie flags drive the settings surface (SHL-02/SHL-05).
 */
export const PlatformSummary = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  signIn: SignInState,
  codecHints: z.array(z.string()).default([]),
  thirdPartyCookies: z.boolean(),
  userAgent: z.string()
})
export type PlatformSummary = z.infer<typeof PlatformSummary>

/** The main-owned session state, broadcast to trusted views. */
export const SessionState = z.object({
  status: SessionStatus,
  platformId: z.string().nullable(),
  error: z.string().nullable()
})
export type SessionState = z.infer<typeof SessionState>

/** Shared session-state shape used before any provider is chosen. */
export const IDLE_SESSION: SessionState = {
  status: 'stopped',
  platformId: null,
  error: null
}

/**
 * Decode mode + evidence-based decode state (SHL-02). The single source of truth
 * for both the main-process capability resolver and the shell's decode surface —
 * the renderer never imports the Electron main bundle.
 */
export const DecodeMode = z.enum(['auto', 'hardware', 'software'])
export type DecodeMode = z.infer<typeof DecodeMode>

export const DecodeState = z.object({
  mode: DecodeMode,
  backend: z.string(),
  videoDecodeStatus: z.string(),
  probedAt: z.string().nullable(),
  source: z.enum(['pref', 'persisted', 'probe', 'default'])
})
export type DecodeState = z.infer<typeof DecodeState>

/**
 * Outcome of a decode/codec re-init request. `relaunched` is false when the
 * loop guard (or `--no-relaunch`) blocked the restart; `error` then carries the
 * reason so the UI can surface a failure rather than a silent lie.
 */
export const RestartOutcome = z.object({
  applied: z.boolean(),
  relaunched: z.boolean(),
  error: z.string().nullable()
})
export type RestartOutcome = z.infer<typeof RestartOutcome>

/**
 * Out-of-process stream health (SHL-03), sampled read-only over CDP Media.
 *
 * Every metric is nullable by design: a value the runtime cannot expose stays
 * `null` and the overlay renders an em dash, never `0`. CDP Media has no
 * compliant source for RTT or a raw dropped-frame count, so those remain `null`
 * for the whole of v1 (03-RESEARCH A4). `sessionStatus` is stamped by the engine
 * from its own state machine so the push-only overlay needs no IPC invoke.
 */
export const HealthSnapshot = z.object({
  resolution: z.string().nullable(),
  rttMs: z.number().nullable(),
  decoderName: z.string().nullable(),
  hardwareDecoder: z.boolean().nullable(),
  framerate: z.number().nullable(),
  freezingRatio: z.number().nullable(),
  droppedFrames: z.number().nullable(),
  sessionStatus: SessionStatus.nullable(),
  statsLive: z.boolean(),
  updatedAt: z.number()
})
export type HealthSnapshot = z.infer<typeof HealthSnapshot>

/**
 * A blocked gaming-mode chord, pushed main -> trusted renderer so the shell can
 * surface a toast ("{chord} blocked — use Stop to end the session."). The label
 * is the human chord name from the pure policy (e.g. "Ctrl+W").
 */
export const ChordBlockedPayload = z.string().min(1)
export type ChordBlockedPayload = z.infer<typeof ChordBlockedPayload>

// --- Local prefs (SHL-05; the on-disk settings contract) ---------------------
/** Codec force hint. Only a hint: the provider negotiates the actual codec. */
export const CodecForce = z.enum(['auto', 'h264', 'vp9', 'av1'])
export type CodecForce = z.infer<typeof CodecForce>

export const PlatformPrefs = z.object({ codecForce: CodecForce.optional() })
export type PlatformPrefs = z.infer<typeof PlatformPrefs>

/** The validated `prefs.json` shape (single source for main + renderer). */
export const Prefs = z.object({
  codecForce: CodecForce.default('auto'),
  // Durable once-ever flag for the first-session hint sequence (INP-02). Kept in
  // prefs (not renderer storage) because the file:// shell origin has no usable
  // localStorage; the store is the durable-state owner.
  hintsSeen: z.boolean().default(false),
  perPlatform: z.record(z.string(), PlatformPrefs).default({})
})
export type Prefs = z.infer<typeof Prefs>

/** A partial update accepted from the shell; main validates + merges it. */
export const PrefsPatch = z.object({
  codecForce: CodecForce.optional(),
  hintsSeen: z.boolean().optional(),
  perPlatform: z.record(z.string(), PlatformPrefs).optional()
})
export type PrefsPatch = z.infer<typeof PrefsPatch>

/**
 * Codec-force change (SHL-02). `platformId` null targets the global default.
 * Codec force is a persisted, provider-dependent HINT applied on relaunch — the
 * provider negotiates the actual codec, so the UI never asserts a codec change.
 */
export const SetCodecForceArgs = z.object({
  platformId: z.string().min(1).nullable(),
  codecForce: CodecForce
})
export type SetCodecForceArgs = z.infer<typeof SetCodecForceArgs>

// --- IPC payload schemas (re-validated in main on every call) ---------------
export const LaunchArgs = z.string().min(1)
export const StopArgs = z.string().min(1)
export const ClearArgs = z.string().min(1)
export const SetOverlayArgs = z.boolean()

/**
 * The trusted bridge surface (`window.gamingate`). Methods only — no generic
 * `send(channel, ...)`. Subscriptions return an unsubscribe function.
 */
export interface GamingateApi {
  listPlatforms: () => Promise<PlatformSummary[]>
  launch: (id: string) => Promise<SessionState>
  stop: (id: string) => Promise<SessionState>
  clearProvider: (id: string) => Promise<boolean>
  sessionState: () => Promise<SessionState>
  setOverlay: (visible: boolean) => Promise<boolean>
  getPrefs: () => Promise<Prefs>
  setPrefs: (patch: PrefsPatch) => Promise<Prefs>
  /** Evidence-based decode state (never invented) for the settings surface. */
  getDecodeState: () => Promise<DecodeState>
  /** Persist the decode mode and relaunch; a blocked relaunch resolves with an error. */
  setDecodeMode: (mode: DecodeMode) => Promise<RestartOutcome>
  /** Persist a provider-dependent codec-force hint and relaunch to apply it. */
  setCodecForce: (args: SetCodecForceArgs) => Promise<RestartOutcome>
  onSessionState: (cb: (state: SessionState) => void) => () => void
  /** Push subscription: fires for every chord the blocker suppressed (INP-03). */
  onChordBlocked: (cb: (label: ChordBlockedPayload) => void) => () => void
  /** Push subscription: the latest honest stream-health snapshot (SHL-03). */
  onHealth: (cb: (snapshot: HealthSnapshot) => void) => () => void
}
