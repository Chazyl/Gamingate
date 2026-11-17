import type { ReactElement } from 'react'
import type { SignInState } from '../../../shared/shell-contract'
import { Badge, type BadgeTone } from '../ui/primitives'

/**
 * Evidence-based sign-in badge (SHL-01, UI-SPEC). Always carries text — never
 * colour alone; `unknown` is the honest default before any evidence exists.
 */
const DISPLAY: Record<SignInState, { label: string; tone: BadgeTone }> = {
  unknown: { label: 'Sign-in unknown', tone: 'neutral' },
  'signed-out': { label: 'Signed out', tone: 'muted' },
  'signed-in': { label: 'Signed in', tone: 'success' }
}

export interface SignInBadgeProps {
  state: SignInState
}

export function SignInBadge({ state }: SignInBadgeProps): ReactElement {
  const { label, tone } = DISPLAY[state]
  return <Badge tone={tone}>{label}</Badge>
}
