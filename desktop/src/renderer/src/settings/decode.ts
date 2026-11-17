/**
 * Honest decode-badge derivation (SHL-02, UI-SPEC "Decoder badge is
 * evidence-based"). Pure and framework-free so it is unit-testable.
 *
 * Deliberately a structural type (not an import of main's `DecodeState`) so the
 * renderer never pulls the Electron main bundle.
 */
export interface DecodeStateLike {
  mode: 'auto' | 'hardware' | 'software'
  backend: string
  videoDecodeStatus: string
  probedAt: string | null
  source: string
}

export type DecodeTone = 'success' | 'warning' | 'neutral'

export interface DecodeBadgeView {
  label: string
  tone: DecodeTone
}

export function deriveDecodeBadge(state: DecodeStateLike | null | undefined): DecodeBadgeView {
  if (!state || state.source === 'default') {
    return { label: 'Unknown (not probed)', tone: 'neutral' }
  }
  const hardwareEvidenced =
    state.backend === 'gpu' ||
    state.videoDecodeStatus === 'accelerated' ||
    state.videoDecodeStatus.startsWith('enabled')
  if (hardwareEvidenced) return { label: 'Hardware', tone: 'success' }

  // A user-forced mode is real but unproven: label it as forced, never as
  // evidenced hardware (UI-SPEC honesty rule 3).
  if (state.source === 'pref') {
    return state.mode === 'software'
      ? { label: 'Software (forced)', tone: 'warning' }
      : { label: 'Hardware (forced)', tone: 'neutral' }
  }
  return { label: 'Software', tone: 'warning' }
}

/**
 * The read-only status line (UI-SPEC Surface 3): effective backend +
 * videoDecodeStatus + probedAt + source. Never invents a value — a missing
 * state renders the honest unknown copy.
 */
export function deriveDecodeStatusLine(state: DecodeStateLike | null | undefined): string {
  if (!state) return 'Unknown (not probed)'
  const probed = state.probedAt ?? 'never probed'
  return `backend ${state.backend} · video ${state.videoDecodeStatus} · probed ${probed} · source ${state.source}`
}
