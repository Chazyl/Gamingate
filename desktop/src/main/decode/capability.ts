import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DecodeMode, DecodeState } from '../../shared/shell-contract'

/**
 * Host decode capability (EMB-03, user decision + review GPU-ordering finding).
 *
 * The engine runs ONE representative probe — `app.getGPUFeatureStatus().video_decode`
 * — persists the hardware/software decision under `userData`, and applies a
 * persisted software decision BEFORE app ready on later launches. Per-GPU-brand
 * matrix logic is deliberately de-scoped: one probe + software fallback.
 *
 * `decode-decision.json` is engine-owned and validated on read; a missing or
 * malformed file falls back to `auto` and never force-disables acceleration
 * (threat T-02-11). `DecodeMode`/`DecodeState` are shared with the shell contract
 * so main and the renderer never drift.
 */

export type { DecodeMode, DecodeState }

interface PersistedDecision {
  mode: DecodeMode
  backend?: string
  videoDecodeStatus?: string
  probedAt?: string | null
  /**
   * Provenance of the decision. Persisted so a forced `pref` survives the file
   * round-trip: without it, a user-forced Hardware choice reloads as
   * `'persisted'` and `deriveDecodeBadge` falls through to "Software" (CR-01).
   */
  source?: DecodeState['source']
}

const DECISION_FILENAME = 'decode-decision.json'

function decisionPath(dir?: string): string {
  return join(dir ?? app.getPath('userData'), DECISION_FILENAME)
}

function isDecodeMode(value: unknown): value is DecodeMode {
  return value === 'auto' || value === 'hardware' || value === 'software'
}

/** Read the persisted decision; malformed/missing => null (safe default auto). */
export function loadPersistedDecision(dir?: string): PersistedDecision | null {
  const path = decisionPath(dir)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as PersistedDecision
    if (!isDecodeMode(raw.mode)) return null
    return raw
  } catch {
    return null
  }
}

/** Resolve the effective decision BEFORE app ready (no probing yet). */
export function resolvePreReady(pref: DecodeMode): DecodeState {
  if (pref !== 'auto') {
    return {
      mode: pref,
      backend: pref,
      videoDecodeStatus: 'unprobed',
      probedAt: null,
      source: 'pref'
    }
  }
  const persisted = loadPersistedDecision()
  if (persisted) {
    // A persisted `auto` is not a decision — it means "let the probe decide".
    // Resolving it as `default` keeps the one-shot probe enabled instead of
    // suppressing it forever with a stored non-default source (CR-01).
    if (persisted.mode === 'auto') {
      return {
        mode: 'auto',
        backend: 'unknown',
        videoDecodeStatus: 'unprobed',
        probedAt: null,
        source: 'default'
      }
    }
    return {
      mode: persisted.mode,
      backend: persisted.backend ?? 'unknown',
      videoDecodeStatus: persisted.videoDecodeStatus ?? 'unknown',
      probedAt: persisted.probedAt ?? null,
      // Restore the user-forced provenance; anything else is persisted evidence.
      source: persisted.source === 'pref' ? 'pref' : 'persisted'
    }
  }
  return {
    mode: 'auto',
    backend: 'unknown',
    videoDecodeStatus: 'unprobed',
    probedAt: null,
    source: 'default'
  }
}

/**
 * The one representative probe, run AFTER ready (getGPUFeatureStatus is only
 * meaningful then). Returns the decided mode but cannot disable acceleration —
 * that can only be applied pre-ready on a subsequent launch.
 */
export function probeDecodeBackend(): {
  mode: DecodeMode
  backend: string
  videoDecodeStatus: string
} {
  let videoDecodeStatus = 'unknown'
  try {
    videoDecodeStatus = String(app.getGPUFeatureStatus().video_decode ?? 'unknown')
  } catch {
    // leave 'unknown' — never fabricate a backend
  }
  const hardware =
    videoDecodeStatus.startsWith('enabled') || videoDecodeStatus === 'accelerated'
  return {
    mode: hardware ? 'hardware' : 'software',
    backend: hardware ? 'gpu' : 'swiftshader',
    videoDecodeStatus
  }
}

/**
 * Engine API for Phase 3's visible decode indicator and the FR-06 HW-decode
 * toggle: the persisted decision, or the safe default when no decision file
 * exists. A pref applies at launch only, so this reads persisted-or-default.
 */
export function getDecodeState(): DecodeState {
  return resolvePreReady('auto')
}

/** Persist the probed decision under userData (best effort, never throws). */
export function persistDecision(state: DecodeState, dir?: string): void {
  const payload: PersistedDecision = {
    mode: state.mode,
    backend: state.backend,
    videoDecodeStatus: state.videoDecodeStatus,
    probedAt: state.probedAt,
    source: state.source
  }
  try {
    writeFileSync(decisionPath(dir), JSON.stringify(payload, null, 2))
  } catch (error) {
    console.error('decode: failed to persist decision:', error)
  }
}
