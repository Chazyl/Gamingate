import { describe, expect, it } from 'vitest'
import { DASH, formatDecoder, formatMetric } from './format'

/**
 * Honesty-rule tests (SHL-03): a value with no real source must render an em
 * dash — never `0`, never an estimate. A genuinely measured `0` is a value and
 * passes through.
 */
describe('formatMetric', () => {
  it('renders an em dash for null (never 0)', () => {
    expect(formatMetric(null)).toBe(DASH)
    expect(formatMetric(null)).not.toBe('0')
  })

  it('renders an em dash for undefined', () => {
    expect(formatMetric(undefined)).toBe(DASH)
  })

  it('renders an em dash for NaN / Infinity', () => {
    expect(formatMetric(Number.NaN)).toBe(DASH)
    expect(formatMetric(Number.POSITIVE_INFINITY)).toBe(DASH)
  })

  it('renders an em dash for a blank string', () => {
    expect(formatMetric('')).toBe(DASH)
    expect(formatMetric('   ')).toBe(DASH)
  })

  it('passes a real value through', () => {
    expect(formatMetric('1920x1080')).toBe('1920x1080')
    expect(formatMetric(59.94)).toBe('59.94')
  })

  it('passes a measured zero through (0 is a real measurement, not missing)', () => {
    expect(formatMetric(0)).toBe('0')
  })
})

describe('formatDecoder', () => {
  it('falls back to "Unknown (not probed)" when CDP exposed no decoder name', () => {
    expect(formatDecoder(null, null)).toBe('Unknown (not probed)')
    expect(formatDecoder('', null)).toBe('Unknown (not probed)')
  })

  it('labels a known decoder with its hardware flag when known', () => {
    expect(formatDecoder('VDAVideoDecoder', true)).toBe('VDAVideoDecoder (hardware)')
    expect(formatDecoder('FFmpegVideoDecoder', false)).toBe('FFmpegVideoDecoder (software)')
  })

  it('omits the flag when the hardware flag is unknown', () => {
    expect(formatDecoder('SomeDecoder', null)).toBe('SomeDecoder')
  })
})
