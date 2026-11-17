import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Forced decode-mode persist -> relaunch round-trip (CR-01).
 *
 * `applyDecodeRestart` persists a user-chosen mode and relaunches; the NEXT boot
 * resolves it via `resolvePreReady('auto')` and the shell derives a badge from
 * that state. The provenance (`pref` vs `persisted`) must survive the file
 * round-trip, or a forced Hardware choice is shown as "Software" — exactly the
 * inverted, dishonest claim this surface exists to prevent. A persisted `auto`
 * must NOT permanently suppress the one-shot first-run probe.
 */

const electronMock = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electronMock.userData }
}))

import { persistDecision, resolvePreReady } from './capability'
import { applyDecodeRestart } from '../shell/restart'
import { deriveDecodeBadge } from '../../renderer/src/settings/decode'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gamingate-roundtrip-'))
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

describe('forced decode-mode round-trip (CR-01)', () => {
  it('keeps a forced Hardware choice provable after relaunch', () => {
    applyDecodeRestart(fakeApp(), dir, 'hardware')
    expect(deriveDecodeBadge(resolvePreReady('auto'))).toEqual({
      label: 'Hardware (forced)',
      tone: 'neutral'
    })
  })

  it('keeps a forced Software choice provable after relaunch', () => {
    applyDecodeRestart(fakeApp(), dir, 'software')
    expect(deriveDecodeBadge(resolvePreReady('auto'))).toEqual({
      label: 'Software (forced)',
      tone: 'warning'
    })
  })

  it('does not let a persisted Auto choice suppress the first-run probe', () => {
    applyDecodeRestart(fakeApp(), dir, 'auto')
    const state = resolvePreReady('auto')
    // source 'default' is the probe trigger (index.ts runs the probe only then).
    expect(state.source).toBe('default')
    expect(deriveDecodeBadge(state)).toEqual({ label: 'Unknown (not probed)', tone: 'neutral' })
  })

  it('still reports evidenced Hardware from a persisted probe result', () => {
    persistDecision({
      mode: 'hardware',
      backend: 'gpu',
      videoDecodeStatus: 'enabled',
      probedAt: '2026-10-03T00:00:00.000Z',
      source: 'probe'
    })
    expect(deriveDecodeBadge(resolvePreReady('auto'))).toEqual({
      label: 'Hardware',
      tone: 'success'
    })
  })
})
