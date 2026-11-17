import { afterEach, describe, expect, it, vi } from 'vitest'
import { capDrm, probeDrm } from './drm'

/**
 * DRM-cap honesty tests (SHL-03, UI-SPEC Honesty Constraint 1). The EME
 * robustness probe may test a HW_SECURE_ALL config, but the OVERLAY is capped at
 * L3 / SW_SECURE — any higher tier literal is forbidden (Android WebView is
 * L3-only). A denied ladder reports Unknown.
 */
describe('capDrm', () => {
  it('reports L3 (SW_SECURE) when either robustness rung is granted', () => {
    expect(capDrm(true, false)).toBe('L3 (SW_SECURE)')
    expect(capDrm(false, true)).toBe('L3 (SW_SECURE)')
    expect(capDrm(true, true)).toBe('L3 (SW_SECURE)')
  })

  it('reports Unknown when no rung is granted', () => {
    expect(capDrm(false, false)).toBe('Unknown')
  })

  it('caps a granted high-robustness rung down to L3 (a grant is not a displayed tier)', () => {
    expect(capDrm(true, false)).toBe('L3 (SW_SECURE)')
  })

  it('never reports a tier above L3/SW_SECURE for any input combination', () => {
    for (const hwSecure of [true, false]) {
      for (const swSecure of [true, false]) {
        const value = capDrm(hwSecure, swSecure)
        expect(['L3 (SW_SECURE)', 'Unknown']).toContain(value)
        expect(value).not.toMatch(/L1|HD|4K/)
      }
    }
  })
})

describe('probeDrm', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns Unknown when EME is unavailable — never throws, never overstates', async () => {
    vi.stubGlobal('navigator', {})
    await expect(probeDrm()).resolves.toBe('Unknown')
  })
})
