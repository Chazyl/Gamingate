import { describe, expect, it } from 'vitest'
import { decodePlatformSpoof, encodePlatformSpoof, PLATFORM_SPOOF_ARG } from './platform-spoof'

const SPOOF = { platform: 'Windows', platformVersion: '10.0.0' }

describe('encodePlatformSpoof / decodePlatformSpoof', () => {
  it('round-trips a spoof through the argv argument form', () => {
    const arg = encodePlatformSpoof(SPOOF)
    expect(arg.startsWith(PLATFORM_SPOOF_ARG)).toBe(true)
    expect(decodePlatformSpoof(arg)).toEqual(SPOOF)
  })

  it('encodes the payload as the arg suffix only (no stray prefix)', () => {
    const arg = encodePlatformSpoof(SPOOF)
    expect(arg.slice(PLATFORM_SPOOF_ARG.length)).toBe(btoa(JSON.stringify(SPOOF)))
  })

  it('returns null for a non-spoof argument', () => {
    expect(decodePlatformSpoof('--other=flag')).toBeNull()
  })

  it('returns null for malformed base64 / JSON', () => {
    expect(decodePlatformSpoof(PLATFORM_SPOOF_ARG + 'not-base64!!')).toBeNull()
    expect(decodePlatformSpoof(PLATFORM_SPOOF_ARG + btoa('{"platform":"Windows"}'))).toBeNull()
    expect(
      decodePlatformSpoof(PLATFORM_SPOOF_ARG + btoa('{"platform":"","platformVersion":"10"}'))
    ).toBeNull()
  })
})
