import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { DecodeMode, DecodeState } from '../../../shared/shell-contract'
import { getGamingate } from '../ipc'
import { Badge, SegmentedControl, type SegmentedOption } from '../ui/primitives'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Toast } from '../ui/Toast'
import { DecodeBadge } from './DecodeBadge'
import { deriveDecodeStatusLine } from './decode'

/**
 * Decode mode control (SHL-02, UI-SPEC Surface 3).
 *
 * Toggling decode mode is NOT a cosmetic flip: `app.disableHardwareAcceleration()`
 * is pre-ready / process-lifetime only, so the control persists the decision and
 * restarts Gamingate. While the restart is in flight the control is disabled and
 * says so; a blocked/failed restart surfaces an error rather than a silent claim
 * the mode changed. When a session is live the change requires confirmation.
 */
const MODE_OPTIONS: SegmentedOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'software', label: 'Software' }
]

const RESTART_TIMEOUT_MS = 4000
const IPC_LOSS_ERROR = 'Gateway engine unreachable. Restart the app.'

export interface DecodeControlProps {
  /** True while a provider session is starting/running (confirm only then). */
  sessionLive?: boolean
}

export function DecodeControl({ sessionLive = false }: DecodeControlProps): ReactElement {
  const [state, setState] = useState<DecodeState | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingMode, setPendingMode] = useState<DecodeMode | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    getGamingate()
      .getDecodeState()
      .then((loaded) => !cancelled && setState(loaded))
      .catch(() => {
        // No bridge / IPC loss: stay honest — the badge renders Unknown.
      })
    return () => {
      cancelled = true
      clearTimer()
    }
  }, [clearTimer])

  const apply = useCallback(
    async (mode: DecodeMode) => {
      setRestarting(true)
      setError(null)
      timer.current = setTimeout(() => {
        timer.current = null
        setRestarting(false)
        setError(IPC_LOSS_ERROR)
      }, RESTART_TIMEOUT_MS)
      try {
        const outcome = await getGamingate().setDecodeMode(mode)
        clearTimer()
        if (!outcome.relaunched) {
          setRestarting(false)
          setState((prev) => (prev ? { ...prev, mode, source: 'pref' } : prev))
          setError(outcome.error ?? 'Restart blocked — the change applies on the next launch.')
        }
      } catch {
        clearTimer()
        setRestarting(false)
        setError(IPC_LOSS_ERROR)
      }
    },
    [clearTimer]
  )

  const request = (mode: DecodeMode): void => {
    if (mode === state?.mode) return
    if (sessionLive) setPendingMode(mode)
    else void apply(mode)
  }

  return (
    <section className="og-section" aria-labelledby="og-decode-title">
      <h2 id="og-decode-title" className="og-section__title">
        Decode
      </h2>
      <div className="og-field">
        <span className="og-field__label">Decode mode</span>
        <SegmentedControl
          name="decode-mode"
          ariaLabel="Hardware decode mode"
          options={MODE_OPTIONS}
          value={state?.mode ?? 'auto'}
          disabled={restarting || state === null}
          onChange={(value) => request(value as DecodeMode)}
        />
        <div className="og-card__badges">
          <DecodeBadge state={state} />
          {restarting ? (
            <span className="og-placeholder" role="status">
              Restarting Gamingate to apply…
            </span>
          ) : (
            <Badge tone="warning">Restarts Gamingate to apply.</Badge>
          )}
        </div>
        <span className="og-field__value" title={deriveDecodeStatusLine(state)}>
          {deriveDecodeStatusLine(state)}
        </span>
      </div>
      <Toast message={error} />
      <ConfirmDialog
        open={pendingMode !== null}
        title="Restart Gamingate?"
        body="Changing decode mode restarts Gamingate to apply it. Your session will end."
        confirmLabel="Restart"
        onConfirm={() => {
          const mode = pendingMode
          setPendingMode(null)
          if (mode) void apply(mode)
        }}
        onCancel={() => setPendingMode(null)}
      />
    </section>
  )
}
