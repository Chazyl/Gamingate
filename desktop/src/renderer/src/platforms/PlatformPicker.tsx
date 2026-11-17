import type { ReactElement } from 'react'
import type { DecodeState, PlatformSummary, SessionState } from '../../../shared/shell-contract'
import { PlatformCard } from './PlatformCard'

/**
 * Startup service picker (UI-SPEC Surface 1, SHL-01). One card per registry
 * packet; skeleton cards while the list loads; documented empty copy; a global
 * banner only when the shell↔main bridge itself is unreachable.
 */
export interface PlatformPickerProps {
  platforms: PlatformSummary[] | null
  session: SessionState
  /** Engine decode state (global, process-level) for each card's badge. */
  decode: DecodeState | null
  globalError: string | null
  onLaunch: (id: string) => void
  onStop: (id: string) => void
  onRequestClear: (platform: PlatformSummary) => void
}

function Skeletons(): ReactElement {
  return (
    <ul className="og-grid" aria-busy="true">
      {[0, 1].map((key) => (
        <li key={key} className="og-skeleton" aria-hidden="true">
          <div className="og-skeleton__line og-skeleton__line--short" />
          <div className="og-skeleton__line" />
        </li>
      ))}
    </ul>
  )
}

export function PlatformPicker({
  platforms,
  session,
  decode,
  globalError,
  onLaunch,
  onStop,
  onRequestClear
}: PlatformPickerProps): ReactElement {
  let body: ReactElement
  if (platforms === null) {
    body = <Skeletons />
  } else if (platforms.length === 0) {
    body = (
      <div className="og-empty">
        <h2 className="og-empty__heading">No services available</h2>
        <p className="og-empty__body">
          Add a packet to <code>platforms.json</code> and restart Gamingate.
        </p>
      </div>
    )
  } else {
    body = (
      <ul className="og-grid">
        {platforms.map((platform) => (
          <PlatformCard
            key={platform.id}
            platform={platform}
            session={session}
            decode={decode}
            onLaunch={onLaunch}
            onStop={onStop}
            onRequestClear={onRequestClear}
          />
        ))}
      </ul>
    )
  }

  return (
    <>
      {globalError ? (
        <div className="og-banner" role="alert">
          Gateway engine unreachable. Restart the app.
        </div>
      ) : null}
      {body}
    </>
  )
}
