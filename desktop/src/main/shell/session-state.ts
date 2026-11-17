import { IDLE_SESSION, type SessionState } from '../../shared/shell-contract'

/**
 * Pure session state machine (SHL-01, research "Session state machine").
 *
 * States: stopped | starting | running | error. Events drive transitions; the
 * engine owns side-effects (view create/destroy, power blocker, health sampler)
 * and this module is a pure reducer so the transition table is unit-testable
 * without Electron.
 *
 *   launch  -> starting          (stopped|error)
 *   loaded  -> running           (starting)
 *   failed  -> error             (starting|running)
 *   crash   -> error             (running)
 *   stop    -> stopped           (any active state)
 */
export type SessionEvent =
  | { type: 'launch'; platformId: string }
  | { type: 'loaded' }
  | { type: 'failed'; error: string }
  | { type: 'crash'; error: string }
  | { type: 'stop' }

export function reduce(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'launch':
      return { status: 'starting', platformId: event.platformId, error: null }
    case 'loaded':
      // Only a starting session can finish loading into running.
      if (state.status !== 'starting') return state
      return { status: 'running', platformId: state.platformId, error: null }
    case 'failed':
      if (state.status !== 'starting' && state.status !== 'running') return state
      return { status: 'error', platformId: state.platformId, error: event.error }
    case 'crash':
      if (state.status !== 'running') return state
      return { status: 'error', platformId: state.platformId, error: event.error }
    case 'stop':
      return IDLE_SESSION
    default:
      return state
  }
}

/** True while a provider view is expected to exist. */
export function isActive(state: SessionState): boolean {
  return state.status === 'starting' || state.status === 'running'
}
