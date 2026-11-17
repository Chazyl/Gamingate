import { describe, expect, it } from 'vitest'
import { isTrustedDocument } from './trusted-url'

/**
 * Trusted-document comparison (IM-03). The shell is served from `file://` in
 * production, whose origin is the opaque string `'null'`. An origin-only
 * allowlist therefore admits ANY `file://` URL — including `file:///etc/passwd`
 * — so opaque-origin schemes must compare the concrete scheme+host+path.
 */
describe('isTrustedDocument', () => {
  const shellUrl = 'file:///work/out/renderer/index.html'

  it('accepts the exact same file renderer document', () => {
    expect(isTrustedDocument(shellUrl, shellUrl)).toBe(true)
  })

  it('accepts the same file document with a query/hash (still that document)', () => {
    expect(isTrustedDocument(`${shellUrl}?surface=overlay`, shellUrl)).toBe(true)
    expect(isTrustedDocument(`${shellUrl}#top`, shellUrl)).toBe(true)
  })

  it('rejects a DIFFERENT file:// path (opaque origin is not a trust signal)', () => {
    expect(isTrustedDocument('file:///etc/passwd', shellUrl)).toBe(false)
    expect(isTrustedDocument('file:///work/out/renderer/other.html', shellUrl)).toBe(false)
  })

  it('compares origin for ordinary http(s) documents', () => {
    expect(isTrustedDocument('http://localhost:5173/anything', 'http://localhost:5173/')).toBe(true)
    expect(isTrustedDocument('https://evil.example/', 'http://localhost:5173/')).toBe(false)
  })

  it('rejects unparseable URLs', () => {
    expect(isTrustedDocument('not a url', shellUrl)).toBe(false)
    expect(isTrustedDocument(shellUrl, 'not a url')).toBe(false)
  })
})
