import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const electronMock = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electronMock.userData }
}))

import { getDecodeState, resolvePreReady } from './capability'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gamingate-decode-'))
  electronMock.userData = dir
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function persistDecision(content: string): void {
  writeFileSync(join(dir, 'decode-decision.json'), content)
}

describe('resolvePreReady (EMB-03 pre-ready software fallback)', () => {
  it('resolves an explicit software pref to software (HW accel disabled)', () => {
    expect(resolvePreReady('software').mode).toBe('software')
  })

  it('resolves an explicit hardware pref to hardware', () => {
    expect(resolvePreReady('hardware').mode).toBe('hardware')
  })

  it('resolves auto with no persisted decision to auto (no disable)', () => {
    const state = resolvePreReady('auto')
    expect(state.mode).toBe('auto')
    expect(state.source).toBe('default')
  })

  it('forces software before ready from a persisted software decision', () => {
    persistDecision(
      JSON.stringify({
        mode: 'software',
        backend: 'swiftshader',
        videoDecodeStatus: 'disabled',
        probedAt: null
      })
    )
    const state = resolvePreReady('auto')
    expect(state.mode).toBe('software')
    expect(state.source).toBe('persisted')
  })

  it('falls back to auto for a malformed decision file', () => {
    persistDecision('{ not json')
    expect(resolvePreReady('auto').mode).toBe('auto')
  })
})

describe('getDecodeState (engine API consumed by Phase 3)', () => {
  it('returns the safe default when no decision file exists', () => {
    expect(getDecodeState()).toEqual({
      mode: 'auto',
      backend: 'unknown',
      videoDecodeStatus: 'unprobed',
      probedAt: null,
      source: 'default'
    })
  })

  it('returns the persisted decision shape when a decision exists', () => {
    persistDecision(
      JSON.stringify({
        mode: 'software',
        backend: 'swiftshader',
        videoDecodeStatus: 'disabled',
        probedAt: '2026-10-02T00:00:00.000Z'
      })
    )
    expect(getDecodeState()).toMatchObject({
      mode: 'software',
      backend: 'swiftshader',
      videoDecodeStatus: 'disabled',
      probedAt: '2026-10-02T00:00:00.000Z'
    })
  })
})
