import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { HealthSnapshot } from '../../../shared/shell-contract'
import { getGamingate } from '../ipc'
import { DASH, DECODER_UNKNOWN, NOT_EXPOSED, formatDecoder, formatMetric } from './format'
import { probeDrm, type DrmCapability } from './drm'

/**
 * Stream-health overlay (SHL-03, UI-SPEC Surface 4). Renders the honest CDP
 * Media readout pushed over `gamingate:health`; a metric with no compliant source
 * shows an em dash plus "Not exposed by this runtime", never `0`.
 *
 * Accessibility (UI-SPEC Accessibility Contract): values update visually every
 * 1s but the polite live region announces ONLY on a state change (a coarse
 * signature), never once per second. Under `prefers-reduced-motion` the panel is
 * static — no motion — while values keep updating.
 */

const EMPTY_HEALTH: HealthSnapshot = {
  resolution: null,
  rttMs: null,
  decoderName: null,
  hardwareDecoder: null,
  framerate: null,
  freezingRatio: null,
  droppedFrames: null,
  sessionStatus: null,
  statsLive: false,
  updatedAt: 0
}

/** Coarse session label; the raw status is never shown as a fake metric. */
function sessionLabel(status: HealthSnapshot['sessionStatus']): { value: string; missing: boolean } {
  if (status === null) return { value: DASH, missing: true }
  return { value: status, missing: false }
}

/** Announce only when the coarse state changes, not on every 1s value tick. */
function announcementOf(health: HealthSnapshot): string {
  const resolution = formatMetric(health.resolution)
  const decoder = formatDecoder(health.decoderName, health.hardwareDecoder)
  const live = health.statsLive ? 'live' : 'unavailable'
  return `Stream health ${live}. Resolution ${resolution}. Decoder ${decoder}.`
}

interface FieldProps {
  label: string
  value: string
  missing?: boolean
}

function Field({ label, value, missing = false }: FieldProps): ReactElement {
  return (
    <div className="og-health__field">
      <dt className="og-health__label">{label}</dt>
      <dd className="og-health__value">
        <span>{value}</span>
        {missing ? <span className="og-health__caption">{NOT_EXPOSED}</span> : null}
      </dd>
    </div>
  )
}

export function OverlayPanel(): ReactElement {
  const [health, setHealth] = useState<HealthSnapshot>(EMPTY_HEALTH)
  const [drm, setDrm] = useState<DrmCapability>('Unknown')
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => getGamingate().onHealth(setHealth), [])

  useEffect(() => {
    let cancelled = false
    probeDrm().then((cap) => {
      if (!cancelled) setDrm(cap)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Change-only announcement: reset the live region when the coarse state moved.
  const signature = useMemo(
    () => announcementOf(health),
    [health.statsLive, health.resolution, health.decoderName, health.hardwareDecoder]
  )
  const lastSignature = useRef('')
  useEffect(() => {
    if (signature === lastSignature.current) return
    lastSignature.current = signature
    setAnnouncement(signature)
  }, [signature])

  const session = sessionLabel(health.sessionStatus)

  return (
    <section className="og-health" aria-label="Stream health">
      <h2 className="og-health__title">Stream health</h2>
      <dl className="og-health__list">
        <Field
          label="Resolution"
          value={formatMetric(health.resolution)}
          missing={health.resolution === null}
        />
        <Field label="Round-trip time" value={formatMetric(health.rttMs)} missing />
        <Field
          label="Decoder"
          value={
            health.decoderName === null
              ? DECODER_UNKNOWN
              : formatDecoder(health.decoderName, health.hardwareDecoder)
          }
          missing={health.decoderName === null}
        />
        <Field label="Dropped frames" value={formatMetric(health.droppedFrames)} missing />
        <Field label="DRM capability" value={drm} missing={drm === 'Unknown'} />
        <Field label="Session" value={session.value} missing={session.missing} />
      </dl>
      <span role="status" aria-live="polite" className="og-health__live">
        {announcement}
      </span>
    </section>
  )
}
