import { describe, expect, it } from 'vitest'
import {
  applyHeaderRules,
  applyPlatformSpoofHeaders,
  originAllowed,
  permissionNames,
  resolveUserAgent
} from './header-rules'

const DEFAULT_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

describe('resolveUserAgent (single UA owner)', () => {
  it('leaves a full desktop UA (contains the Mozilla token) unchanged', () => {
    const full = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0 Safari/537.36'
    expect(resolveUserAgent(full, DEFAULT_UA)).toBe(full)
  })

  it('substitutes the platform token when given only a desktop fragment', () => {
    const resolved = resolveUserAgent('Windows NT 10.0; Win64; x64', DEFAULT_UA)
    expect(resolved).toContain('(Windows NT 10.0; Win64; x64)')
    expect(resolved).not.toContain('(X11; Linux x86_64)')
  })
})

describe('originAllowed', () => {
  const allowed = ['https://luna.amazon.com', 'https://www.amazon.com']
  it('accepts an exact declared origin', () => {
    expect(originAllowed('https://luna.amazon.com', allowed)).toBe(true)
    expect(originAllowed('https://luna.amazon.com/', allowed)).toBe(true)
  })
  it('denies an undeclared origin', () => {
    expect(originAllowed('https://evil.example', allowed)).toBe(false)
  })
  it('denies a malformed origin', () => {
    expect(originAllowed('not-an-origin', allowed)).toBe(false)
  })
})

describe('permissionNames (conditional DRM)', () => {
  it('returns nothing for an all-false packet', () => {
    expect(
      permissionNames({ media: false, input: false, pointerLock: false, fullscreen: false })
    ).toEqual([])
  })

  it('grants mediaKeySystem only when media is true', () => {
    const names = permissionNames({
      media: true,
      input: false,
      pointerLock: false,
      fullscreen: false
    })
    expect(names).toContain('media')
    expect(names).toContain('mediaKeySystem')
  })

  it('maps every declared boolean to its permission name', () => {
    const names = permissionNames({
      media: false,
      input: true,
      pointerLock: true,
      fullscreen: true
    })
    expect(names).toEqual(expect.arrayContaining(['keyboardLock', 'pointerLock', 'fullscreen']))
    expect(names).not.toContain('mediaKeySystem')
  })
})

describe('applyHeaderRules (origin-scoped, no blanket deletion)', () => {
  const allowedOrigins = ['https://luna.amazon.com', 'https://www.amazon.com']
  const rules = [
    { urlFilter: 'https://luna.amazon.com/*', headers: { 'X-Gamingate': 'luna' } }
  ]
  const original = {
    'content-security-policy': ["frame-ancestors 'none'"],
    'x-frame-options': ['DENY'],
    'x-undeclared': ['keep-me']
  }

  it('applies a declared header for an allowed origin + matching filter', () => {
    const out = applyHeaderRules(
      'https://luna.amazon.com/play',
      rules,
      allowedOrigins,
      original
    )
    expect(out['X-Gamingate']).toEqual(['luna'])
    expect(out['x-undeclared']).toEqual(['keep-me'])
  })

  it('passes headers through byte-identical for a non-allowed origin', () => {
    const out = applyHeaderRules(
      'https://evil.example/play',
      rules,
      allowedOrigins,
      original
    )
    expect(out).toEqual(original)
  })

  it('does not touch the original CSP / X-Frame-Options (no blanket deletion)', () => {
    const out = applyHeaderRules(
      'https://luna.amazon.com/play',
      rules,
      allowedOrigins,
      original
    )
    expect(out['content-security-policy']).toEqual(["frame-ancestors 'none'"])
    expect(out['x-frame-options']).toEqual(['DENY'])
  })

  it('applies nothing when the filter does not match the response URL', () => {
    const out = applyHeaderRules(
      'https://www.amazon.com/play',
      rules,
      allowedOrigins,
      original
    )
    expect(out).toEqual(original)
  })
})

describe('applyPlatformSpoofHeaders', () => {
  const spoof = { platform: 'Windows', platformVersion: '10.0.0' }

  it('overrides the platform Client Hints and preserves every other header', () => {
    const out = applyPlatformSpoofHeaders(
      {
        Accept: '*/*',
        'Sec-CH-UA': '"Chromium";v="152"',
        'Sec-CH-UA-Platform': '"Linux"',
        'Sec-CH-UA-Platform-Version': '"6.8.0"'
      },
      spoof
    )
    expect(out['Sec-CH-UA-Platform']).toBe('Windows')
    expect(out['Sec-CH-UA-Platform-Version']).toBe('10.0.0')
    expect(out['Sec-CH-UA']).toBe('"Chromium";v="152"')
    expect(out['Accept']).toBe('*/*')
    expect(Object.keys(out).filter((n) => n.toLowerCase() === 'sec-ch-ua-platform')).toHaveLength(1)
  })

  it('adds the platform hints when Chromium sent none', () => {
    const out = applyPlatformSpoofHeaders({ Accept: 'text/html' }, spoof)
    expect(out['Sec-CH-UA-Platform']).toBe('Windows')
    expect(out['Sec-CH-UA-Platform-Version']).toBe('10.0.0')
  })

  it('drops a case-variant duplicate rather than emitting two values', () => {
    const out = applyPlatformSpoofHeaders({ 'sec-ch-ua-platform': '"Linux"' }, spoof)
    const platformKeys = Object.keys(out).filter(
      (n) => n.toLowerCase() === 'sec-ch-ua-platform'
    )
    expect(platformKeys).toEqual(['Sec-CH-UA-Platform'])
    expect(out['Sec-CH-UA-Platform']).toBe('Windows')
  })
})
