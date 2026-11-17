/**
 * Log redaction (IN-06). Dev/container lanes must never log a provider URL's
 * query string: a failed/ready OAuth redirect can carry an authorization code
 * there. Only scheme + host + path is emitted; query and fragment are dropped.
 */
export function redactUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return '<unparseable-url>'
  }
  const base = parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin
  return `${base}${parsed.pathname}`
}
