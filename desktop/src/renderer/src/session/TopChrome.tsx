import type { ReactElement } from 'react'
import { Button } from '../ui/primitives'
import { Toast } from '../ui/Toast'

/**
 * In-session top chrome (UI-SPEC Surface 2, INP-02). Mounted only while a
 * session is starting/running; the native shell view is sized to this 48px bar
 * so it never overlaps provider pixels. `notice` renders the chord-blocked
 * toast and the first-session hint sequence inside the bar.
 */
export interface TopChromeProps {
  platformName: string
  onStop: () => void
  notice?: string | null
}

export function TopChrome({ platformName, onStop, notice = null }: TopChromeProps): ReactElement {
  return (
    <div className="og-chrome">
      <span className="og-chrome__name">{platformName}</span>
      <Button variant="destructive" onClick={onStop}>
        Stop
      </Button>
      <Toast message={notice} />
    </div>
  )
}
