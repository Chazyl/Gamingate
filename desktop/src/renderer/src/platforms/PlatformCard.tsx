import type { ReactElement } from 'react'
import type {
  DecodeState,
  PlatformSummary,
  SessionState
} from '../../../shared/shell-contract'
import { Badge, Button } from '../ui/primitives'
import { SignInBadge } from './SignInBadge'
import { deriveDecodeBadge } from '../settings/decode'

/**
 * One registry packet as a card (UI-SPEC Surface 1). Disabled rules:
 *  - Launch: disabled while any session is starting/running (single view in v1)
 *  - Stop:   disabled unless this packet is the active session
 *  - Clear:  disabled while this packet is running (Stop first)
 */
export interface PlatformCardProps {
  platform: PlatformSummary
  session: SessionState
  /** Engine decode state (global) — drives the evidence-based badge. */
  decode: DecodeState | null
  onLaunch: (id: string) => void
  onStop: (id: string) => void
  onRequestClear: (platform: PlatformSummary) => void
}

export function PlatformCard({
  platform,
  session,
  decode: decodeState,
  onLaunch,
  onStop,
  onRequestClear
}: PlatformCardProps): ReactElement {
  const anyActive = session.status === 'starting' || session.status === 'running'
  const active = session.platformId === platform.id && anyActive
  const launching = session.platformId === platform.id && session.status === 'starting'
  const failed = session.status === 'error' && session.platformId === platform.id

  const decode = deriveDecodeBadge(decodeState)

  return (
    <li className="og-card">
      <h2 className="og-card__name">{platform.name}</h2>
      <div className="og-card__badges">
        <SignInBadge state={platform.signIn} />
        <Badge tone={decode.tone}>{decode.label}</Badge>
      </div>
      {failed ? (
        <div className="og-card__error" role="alert" title={session.error ?? undefined}>
          <p>
            Couldn&apos;t load {platform.name}. Check your connection, then Retry or Clear data.
          </p>
          <div className="og-card__actions">
            <Button variant="secondary" onClick={() => onLaunch(platform.id)}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}
      <div className="og-card__actions">
        <Button
          variant="primary"
          disabled={anyActive}
          loading={launching}
          onClick={() => onLaunch(platform.id)}
        >
          Launch
        </Button>
        <Button variant="secondary" disabled={!active} onClick={() => onStop(platform.id)}>
          Stop
        </Button>
        <Button
          variant="destructive"
          disabled={active}
          onClick={() => onRequestClear(platform)}
        >
          Clear data
        </Button>
      </div>
    </li>
  )
}
