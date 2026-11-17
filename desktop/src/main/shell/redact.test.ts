import { describe, expect, it } from 'vitest'
import { redactUrl } from './redact'

/**
 * Log redaction (IN-06). Dev/container lanes must never log a provider URL's
 * query string: an OAuth redirect can carry an authorization code there. Only
 * scheme/host/path is emitted; the query and fragment are dropped.
 */
describe('redactUrl', () => {
  it('drops the query and fragment and keeps scheme/host/path', () => {
    const redacted = redactUrl(
      'https://www.amazon.com/ap/signin?openid.oa2.authorization_code=SECRET#frag'
    )
    expect(redacted).toBe('https://www.amazon.com/ap/signin')
    expect(redacted).not.toContain('SECRET')
    expect(redacted).not.toContain('?')
  })

  it('keeps the trailing slash for a bare origin', () => {
    expect(redactUrl('https://luna.amazon.com/?token=abc')).toBe('https://luna.amazon.com/')
  })

  it('handles non-http schemes without leaking the query', () => {
    expect(redactUrl('file:///work/out/renderer/index.html?surface=overlay')).toBe(
      'file:///work/out/renderer/index.html'
    )
  })

  it('never throws on an unparseable value', () => {
    expect(redactUrl('not a url')).toBe('<unparseable-url>')
    expect(redactUrl('not a url')).not.toContain('not a url')
  })
})
