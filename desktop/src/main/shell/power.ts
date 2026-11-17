import { powerSaveBlocker } from 'electron'

/**
 * Sleep inhibition lifecycle (SHL-04, 03-RESEARCH "Sleep Inhibition").
 *
 * While a session runs the display must not sleep; the blocker is released on
 * every exit path (stop, load failure, render-process-gone, will-quit). A single
 * `prevent-display-sleep` blocker is owned here — double-engage cannot start a
 * second one, and release when inactive is a no-op (threat T-03-32).
 */

/** The subset of Electron's `powerSaveBlocker` this module depends on. */
export interface PowerBlocker {
  start: (type: 'prevent-display-sleep' | 'prevent-app-suspension') => number
  stop: (id: number) => void
  isStarted: (id: number) => boolean
}

export interface SleepInhibitor {
  engage: () => void
  release: () => void
  isActive: () => boolean
}

export function createSleepInhibitor(blocker: PowerBlocker = powerSaveBlocker): SleepInhibitor {
  let blockerId: number | null = null

  const isActive = (): boolean => blockerId !== null && blocker.isStarted(blockerId)

  const engage = (): void => {
    if (isActive()) return
    blockerId = blocker.start('prevent-display-sleep')
  }

  const release = (): void => {
    if (blockerId !== null && blocker.isStarted(blockerId)) blocker.stop(blockerId)
    blockerId = null
  }

  return { engage, release, isActive }
}
