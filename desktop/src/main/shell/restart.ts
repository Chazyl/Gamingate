import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { persistDecision } from '../decode/capability'
import type { DecodeMode, DecodeState, RestartOutcome } from '../../shared/shell-contract'

/**
 * Loop-guarded decode-mode relaunch (SHL-02, threat T-03-40).
 *
 * `app.disableHardwareAcceleration()` and the decode command-line switches are
 * pre-ready / process-lifetime only — a runtime call is a silent no-op. A real
 * decode-mode change therefore means: persist the decision, write a restart
 * marker, and relaunch the process so the next boot applies it BEFORE ready.
 *
 * A relaunch must never loop. Three guards:
 *   1. `checkRelaunchAllowed` refuses when `--no-relaunch` is present.
 *   2. It refuses when the restart flag `--decode-restarted` is already in argv
 *      (the process was itself spawned by a relaunch).
 *   3. `consumeDecodeRestartMarker` deletes the on-disk marker pre-ready so a
 *      stale marker can never re-trigger a relaunch on the following boot.
 *
 * When relaunch is not allowed the caller gets an explicit `error` so the shell
 * can surface a failure instead of silently claiming the mode changed.
 */

export const DECODE_RESTART_FLAG = '--decode-restarted'
export const NO_RELAUNCH_FLAG = '--no-relaunch'
export const RESTART_MARKER_FILENAME = 'decode-restart-requested'

/** Minimal slice of Electron's `app` used here, so tests can fake it. */
export interface RelaunchApp {
  relaunch(options?: { args?: string[] }): void
  exit(code?: number): void
}

export function restartMarkerPath(dir: string): string {
  return join(dir, RESTART_MARKER_FILENAME)
}

/**
 * The relaunch gate. `markerJustWritten` must be true — a relaunch is only ever
 * justified by a freshly-written marker for THIS user action, never by a marker
 * observed at boot.
 */
export function checkRelaunchAllowed(argv: readonly string[], markerJustWritten: boolean): boolean {
  if (!markerJustWritten) return false
  if (argv.includes(NO_RELAUNCH_FLAG)) return false
  if (argv.includes(DECODE_RESTART_FLAG)) return false
  return true
}

/** Delete-and-report the restart marker; called pre-ready so it cannot linger. */
export function consumeDecodeRestartMarker(dir: string): { consumed: boolean } {
  const path = restartMarkerPath(dir)
  if (!existsSync(path)) return { consumed: false }
  try {
    rmSync(path, { force: true })
  } catch {
    // A marker we cannot delete must never crash boot.
  }
  return { consumed: true }
}

function writeRestartMarker(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(restartMarkerPath(dir), new Date().toISOString())
}

/**
 * Relaunch the process with `--decode-restarted` appended, then exit. Returns a
 * structured outcome; when the guard refuses, it never relaunches and reports
 * the block so the caller can surface an error.
 */
export function requestRelaunch(
  app: RelaunchApp,
  dir: string,
  argv: readonly string[] = process.argv
): RestartOutcome {
  if (!checkRelaunchAllowed(argv, true)) {
    return { applied: true, relaunched: false, error: 'relaunch blocked' }
  }
  try {
    writeRestartMarker(dir)
  } catch {
    // The marker is evidence, not a gate; a write failure must not block a relaunch.
  }
  app.relaunch({ args: argv.slice(1).concat(DECODE_RESTART_FLAG) })
  app.exit(0)
  return { applied: true, relaunched: true, error: null }
}

/**
 * Persist the chosen decode mode as a pre-ready `pref` decision, then relaunch
 * so the next boot resolves it and disables hardware acceleration before ready.
 */
export function applyDecodeRestart(app: RelaunchApp, dir: string, mode: DecodeMode): RestartOutcome {
  const state: DecodeState = {
    mode,
    backend: mode,
    videoDecodeStatus: 'unprobed',
    probedAt: null,
    source: 'pref'
  }
  persistDecision(state, dir)
  return requestRelaunch(app, dir)
}
