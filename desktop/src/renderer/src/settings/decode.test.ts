import { describe, expect, it } from 'vitest'
import { deriveDecodeBadge, deriveDecodeStatusLine } from './decode'

/**
 * Honest decode badge derivation (SHL-02, UI-SPEC "Decoder badge is
 * evidence-based"). "Hardware" requires real evidence (`backend === 'gpu'` or an
 * `enabled*`/`accelerated` videoDecodeStatus); the default/unknown state renders
 * "Unknown (not probed)". Never overstate.
 */

const base = {
  mode: 'auto' as const,
  backend: 'unknown',
  videoDecodeStatus: 'unknown',
  probedAt: '2026-10-03T00:00:00.000Z',
  source: 'probe'
}

describe('deriveDecodeBadge', () => {
  it('renders Unknown for a missing state', () => {
    expect(deriveDecodeBadge(undefined)).toEqual({ label: 'Unknown (not probed)', tone: 'neutral' })
  })

  it("renders Unknown when source is 'default' (never probed)", () => {
    expect(deriveDecodeBadge({ ...base, source: 'default', probedAt: null })).toEqual({
      label: 'Unknown (not probed)',
      tone: 'neutral'
    })
  })

  it("claims Hardware only on backend === 'gpu'", () => {
    expect(deriveDecodeBadge({ ...base, backend: 'gpu', videoDecodeStatus: 'unknown' })).toEqual({
      label: 'Hardware',
      tone: 'success'
    })
  })

  it('claims Hardware on an accelerated videoDecodeStatus', () => {
    expect(deriveDecodeBadge({ ...base, backend: 'unknown', videoDecodeStatus: 'accelerated' })).toEqual(
      { label: 'Hardware', tone: 'success' }
    )
  })

  it('claims Hardware on an enabled* videoDecodeStatus', () => {
    expect(
      deriveDecodeBadge({ ...base, backend: 'unknown', videoDecodeStatus: 'enabled_force' })
    ).toEqual({ label: 'Hardware', tone: 'success' })
  })

  it('renders Software for a probed non-hardware backend', () => {
    expect(deriveDecodeBadge({ ...base, backend: 'swiftshader' })).toEqual({
      label: 'Software',
      tone: 'warning'
    })
  })

  it('labels a forced software pref honestly', () => {
    expect(
      deriveDecodeBadge({
        ...base,
        mode: 'software',
        source: 'pref',
        probedAt: null,
        videoDecodeStatus: 'unprobed'
      })
    ).toEqual({ label: 'Software (forced)', tone: 'warning' })
  })

  it('never claims Hardware for a forced hardware pref without evidence', () => {
    expect(
      deriveDecodeBadge({
        ...base,
        mode: 'hardware',
        source: 'pref',
        probedAt: null,
        videoDecodeStatus: 'unprobed'
      })
    ).toEqual({ label: 'Hardware (forced)', tone: 'neutral' })
  })
})

describe('deriveDecodeStatusLine', () => {
  it('renders the honest unknown value with no state', () => {
    expect(deriveDecodeStatusLine(null)).toBe('Unknown (not probed)')
  })

  it('surfaces backend, videoDecodeStatus, probedAt and source', () => {
    const line = deriveDecodeStatusLine({ ...base, backend: 'gpu', videoDecodeStatus: 'enabled' })
    expect(line).toContain('gpu')
    expect(line).toContain('enabled')
    expect(line).toContain('2026-10-03T00:00:00.000Z')
    expect(line).toContain('probe')
  })

  it('renders "never probed" when probedAt is null', () => {
    expect(deriveDecodeStatusLine({ ...base, probedAt: null })).toContain('never probed')
  })
})
