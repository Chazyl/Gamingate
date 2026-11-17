import { describe, expect, it, vi } from 'vitest'
import { createSleepInhibitor, type PowerBlocker } from './power'

/**
 * Sleep-inhibition lifecycle tests (SHL-04, threat T-03-32). Exactly one
 * `prevent-display-sleep` blocker may be engaged while a session runs, released
 * on every exit path (stop, load failure, crash, will-quit). Double-engage must
 * never start a second blocker; release when inactive is a no-op.
 */

function fakeBlocker() {
  let nextId = 1
  const active = new Set<number>()
  return {
    start: vi.fn((type: 'prevent-display-sleep' | 'prevent-app-suspension') => {
      void type
      const id = nextId++
      active.add(id)
      return id
    }),
    stop: vi.fn((id: number) => {
      active.delete(id)
    }),
    isStarted: vi.fn((id: number) => active.has(id)),
    activeIds: () => [...active]
  }
}

describe('createSleepInhibitor', () => {
  it('engages exactly one prevent-display-sleep blocker', () => {
    const blocker = fakeBlocker()
    const inhibitor = createSleepInhibitor(blocker as unknown as PowerBlocker)

    inhibitor.engage()

    expect(inhibitor.isActive()).toBe(true)
    expect(blocker.start).toHaveBeenCalledTimes(1)
    expect(blocker.start).toHaveBeenCalledWith('prevent-display-sleep')
    expect(blocker.activeIds()).toHaveLength(1)
  })

  it('does not start a second blocker on a double engage', () => {
    const blocker = fakeBlocker()
    const inhibitor = createSleepInhibitor(blocker as unknown as PowerBlocker)

    inhibitor.engage()
    inhibitor.engage()

    expect(blocker.start).toHaveBeenCalledTimes(1)
    expect(blocker.activeIds()).toHaveLength(1)
  })

  it('releases the active blocker and clears state', () => {
    const blocker = fakeBlocker()
    const inhibitor = createSleepInhibitor(blocker as unknown as PowerBlocker)

    inhibitor.engage()
    const [id] = blocker.activeIds()
    inhibitor.release()

    expect(blocker.stop).toHaveBeenCalledWith(id)
    expect(inhibitor.isActive()).toBe(false)
    expect(blocker.activeIds()).toHaveLength(0)
  })

  it('is a no-op to release when inactive', () => {
    const blocker = fakeBlocker()
    const inhibitor = createSleepInhibitor(blocker as unknown as PowerBlocker)

    expect(() => inhibitor.release()).not.toThrow()
    expect(blocker.stop).not.toHaveBeenCalled()
    expect(inhibitor.isActive()).toBe(false)
  })

  it('re-engages cleanly after a release', () => {
    const blocker = fakeBlocker()
    const inhibitor = createSleepInhibitor(blocker as unknown as PowerBlocker)

    inhibitor.engage()
    inhibitor.release()
    inhibitor.engage()

    expect(inhibitor.isActive()).toBe(true)
    expect(blocker.start).toHaveBeenCalledTimes(2)
    expect(blocker.activeIds()).toHaveLength(1)
  })
})
