import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Loop-guarded decode relaunch (SHL-02, threat T-03-40).
 *
 * A decode-mode change persists a decision + a restart marker and relaunches,
 * but ONLY when the guard allows it: no `--no-relaunch`, no restart flag already
 * in argv, and a marker just written for this action. The marker is consumed at
 * boot so it can never re-trigger a relaunch on the following launch.
 */

const electronMock = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electronMock.userData }
}))

import {
  DECODE_RESTART_FLAG,
  NO_RELAUNCH_FLAG,
  applyDecodeRestart,
  checkRelaunchAllowed,
  consumeDecodeRestartMarker,
  requestRelaunch,
  restartMarkerPath
} from './restart'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gamingate-restart-'))
  electronMock.userData = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function fakeApp() {
  return {
    relaunch: vi.fn((_options?: { args?: string[] }): void => undefined),
    exit: vi.fn((_code?: number): void => undefined)
  }
}

describe('checkRelaunchAllowed', () => {
  it('allows a freshly-written marker with no blocking flags', () => {
    expect(checkRelaunchAllowed(['node', 'app'], true)).toBe(true)
  })

  it('refuses when --no-relaunch is present', () => {
    expect(checkRelaunchAllowed(['node', 'app', NO_RELAUNCH_FLAG], true)).toBe(false)
  })

  it('refuses when the restart flag is already present (no relaunch loop)', () => {
    expect(checkRelaunchAllowed(['node', 'app', DECODE_RESTART_FLAG], true)).toBe(false)
  })

  it('refuses when no marker was just written', () => {
    expect(checkRelaunchAllowed(['node', 'app'], false)).toBe(false)
  })
})

describe('consumeDecodeRestartMarker', () => {
  it('deletes a marker and reports consumption exactly once', () => {
    writeFileSync(restartMarkerPath(dir), 'requested')
    expect(consumeDecodeRestartMarker(dir)).toEqual({ consumed: true })
    expect(existsSync(restartMarkerPath(dir))).toBe(false)
    expect(consumeDecodeRestartMarker(dir)).toEqual({ consumed: false })
  })

  it('reports nothing when no marker exists', () => {
    expect(consumeDecodeRestartMarker(dir)).toEqual({ consumed: false })
  })
})

describe('requestRelaunch', () => {
  it('relaunches with the restart flag and exits when allowed', () => {
    const app = fakeApp()
    const outcome = requestRelaunch(app, dir, ['node', 'app'])
    expect(outcome).toEqual({ applied: true, relaunched: true, error: null })
    expect(app.relaunch).toHaveBeenCalledWith({ args: ['app', DECODE_RESTART_FLAG] })
    expect(app.exit).toHaveBeenCalledWith(0)
    expect(existsSync(restartMarkerPath(dir))).toBe(true)
  })

  it('returns an explicit failure and never relaunches when blocked', () => {
    const app = fakeApp()
    const outcome = requestRelaunch(app, dir, ['node', 'app', NO_RELAUNCH_FLAG])
    expect(outcome.relaunched).toBe(false)
    expect(outcome.error).toBeTruthy()
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('refuses a second relaunch when the restart flag is already present', () => {
    const app = fakeApp()
    const outcome = requestRelaunch(app, dir, ['node', 'app', DECODE_RESTART_FLAG])
    expect(outcome.relaunched).toBe(false)
    expect(app.relaunch).not.toHaveBeenCalled()
  })
})

describe('applyDecodeRestart', () => {
  it('persists the mode as a pref decision and relaunches', () => {
    const app = fakeApp()
    const outcome = applyDecodeRestart(app, dir, 'software')
    expect(outcome.relaunched).toBe(true)
    const decision = JSON.parse(readFileSync(join(dir, 'decode-decision.json'), 'utf8'))
    expect(decision).toMatchObject({ mode: 'software', backend: 'software' })
    expect(app.exit).toHaveBeenCalledWith(0)
  })
})
