/**
 * Trusted-document comparison for the shell origin allowlist (IM-03).
 *
 * The trusted shell is served from a built `file://` document in production.
 * A `file://` URL's origin is the opaque string `'null'`, so an origin-only
 * allowlist admits ANY `file://` URL — it carries no trust information. For
 * opaque-origin schemes this compares the concrete scheme + host + pathname
 * instead; for ordinary http(s) documents the origin (scheme + host + port) is
 * the correct granularity.
 */

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** True when `candidate` is the same trusted document as `trusted`. */
export function isTrustedDocument(candidate: string, trusted: string): boolean {
  const c = parse(candidate)
  const t = parse(trusted)
  if (!c || !t) return false
  // `origin === 'null'` marks an opaque origin (file:, data:, custom schemes);
  // all such URLs share it, so fall back to the concrete document identity.
  if (t.origin === 'null' || c.origin === 'null') {
    return c.protocol === t.protocol && c.host === t.host && c.pathname === t.pathname
  }
  return c.origin === t.origin
}
