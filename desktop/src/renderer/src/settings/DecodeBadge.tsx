import type { ReactElement } from 'react'
import type { DecodeState } from '../../../shared/shell-contract'
import { Badge } from '../ui/primitives'
import { deriveDecodeBadge } from './decode'

/**
 * Evidence-based decode badge (UI-SPEC Honesty Constraint 3). "Hardware" is
 * only ever shown on real evidence (`backend === 'gpu'` or an `enabled*` /
 * `accelerated` videoDecodeStatus); everything else is labelled honestly, and a
 * never-probed state renders "Unknown (not probed)".
 */
export interface DecodeBadgeProps {
  state: DecodeState | null
}

export function DecodeBadge({ state }: DecodeBadgeProps): ReactElement {
  const view = deriveDecodeBadge(state)
  return <Badge tone={view.tone}>{view.label}</Badge>
}
