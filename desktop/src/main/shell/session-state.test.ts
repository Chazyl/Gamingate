import { describe, expect, it } from 'vitest'
import { IDLE_SESSION, type SessionState } from '../../shared/shell-contract'
import { isActive, reduce } from './session-state'

describe('session-state reducer', () => {
  it('walks launch -> running -> stop -> stopped', () => {
    let s: SessionState = IDLE_SESSION
    s = reduce(s, { type: 'launch', platformId: 'luna' })
    expect(s).toEqual({ status: 'starting', platformId: 'luna', error: null })
    s = reduce(s, { type: 'loaded' })
    expect(s).toEqual({ status: 'running', platformId: 'luna', error: null })
    s = reduce(s, { type: 'stop' })
    expect(s).toEqual(IDLE_SESSION)
  })

  it('walks launch -> error -> stopped', () => {
    let s = reduce(IDLE_SESSION, { type: 'launch', platformId: 'luna' })
    s = reduce(s, { type: 'failed', error: 'did-fail-load' })
    expect(s).toEqual({ status: 'error', platformId: 'luna', error: 'did-fail-load' })
    expect(reduce(s, { type: 'stop' })).toEqual(IDLE_SESSION)
  })

  it('only a starting session can become running', () => {
    expect(reduce(IDLE_SESSION, { type: 'loaded' })).toEqual(IDLE_SESSION)
    const running = reduce(reduce(IDLE_SESSION, { type: 'launch', platformId: 'luna' }), {
      type: 'loaded'
    })
    // A second loaded event is a no-op (not starting).
    expect(reduce(running, { type: 'loaded' })).toEqual(running)
  })

  it('crash only applies to a running session', () => {
    const starting = reduce(IDLE_SESSION, { type: 'launch', platformId: 'luna' })
    expect(reduce(starting, { type: 'crash', error: 'gone' })).toEqual(starting)
    const running = reduce(starting, { type: 'loaded' })
    expect(reduce(running, { type: 'crash', error: 'gone' })).toEqual({
      status: 'error',
      platformId: 'luna',
      error: 'gone'
    })
  })

  it('isActive is true while starting or running', () => {
    expect(isActive(IDLE_SESSION)).toBe(false)
    const starting = reduce(IDLE_SESSION, { type: 'launch', platformId: 'luna' })
    expect(isActive(starting)).toBe(true)
    expect(isActive(reduce(starting, { type: 'loaded' }))).toBe(true)
  })
})
