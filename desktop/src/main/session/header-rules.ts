import type { HeaderRule, PermissionSet, PlatformSpoof } from '../../shared/types'

/**
 * Pure identity/header/permission helpers (REG-02, EMB-03). No Electron import:
 * every function is unit-testable in a plain Node process, and the Session
 * wiring in session-manager.ts composes them.
 */

/**
 * Single UA owner. A packet may declare either a full desktop UA (contains the
 * Mozilla token) or only a platform fragment; a fragment is substituted into the
 * default UA's parenthesised platform token.
 */
export function resolveUserAgent(packetUserAgent: string, defaultUserAgent: string): string {
  if (packetUserAgent.includes('Mozilla')) return packetUserAgent
  const fragment = packetUserAgent.trim()
  if (!fragment) return defaultUserAgent
  return defaultUserAgent.replace(/\(([^)]*)\)/, `(${fragment})`)
}

function urlOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/** True only when `origin` is one of the packet's declared allowedOrigins. */
export function originAllowed(origin: string, allowedOrigins: string[]): boolean {
  const normalized = urlOrigin(origin)
  if (!normalized) return false
  return allowedOrigins.some((allowed) => urlOrigin(allowed) === normalized)
}

/**
 * Map the packet's declared booleans to Electron permission names.
 * `mediaKeySystem` (DRM) is granted ONLY when `media` is declared true, so an
 * all-false / read-only packet receives no DRM grant.
 */
export function permissionNames(permissions: PermissionSet): string[] {
  const names: string[] = []
  if (permissions.media) names.push('media')
  if (permissions.input) names.push('keyboardLock')
  if (permissions.pointerLock) names.push('pointerLock')
  if (permissions.fullscreen) names.push('fullscreen')
  if (permissions.media) names.push('mediaKeySystem')
  return names
}

/**
 * Rewrite the outgoing platform Client Hints so the real OS is not leaked:
 * `Sec-CH-UA-Platform` -> spoof.platform and `Sec-CH-UA-Platform-Version` ->
 * spoof.platformVersion. Every other header passes through byte-identical; any
 * case-variant platform header is dropped so exactly one canonical value is
 * sent. `Sec-CH-UA` (brands) carries no OS and is deliberately left untouched.
 *
 * Pure: the caller (session-manager) scopes this to the packet's allowed
 * origins, so this is never a blanket rewrite.
 */
export function applyPlatformSpoofHeaders(
  requestHeaders: Record<string, string>,
  spoof: PlatformSpoof
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(requestHeaders)) {
    const lower = name.toLowerCase()
    if (lower === 'sec-ch-ua-platform' || lower === 'sec-ch-ua-platform-version') continue
    result[name] = value
  }
  result['Sec-CH-UA-Platform'] = spoof.platform
  result['Sec-CH-UA-Platform-Version'] = spoof.platformVersion
  return result
}

/** Minimal Chrome match-pattern support: only the `*` wildcard is used. */
function patternMatches(urlFilter: string, url: string): boolean {
  const escaped = urlFilter.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(url)
}

/**
 * Apply ONLY packet-declared, origin-scoped header rules.
 *
 * The callback receives the RESPONSE URL: a rule is applied only when its
 * urlFilter matches that URL and the response origin is within allowedOrigins.
 * Everything else passes through unchanged — there is no blanket CSP or
 * X-Frame-Options deletion (REG-02, threat T-02-04).
 */
export function applyHeaderRules(
  responseUrl: string,
  headerRules: HeaderRule[],
  allowedOrigins: string[],
  responseHeaders: Record<string, string[]>
): Record<string, string[]> {
  const responseOrigin = urlOrigin(responseUrl)
  if (!responseOrigin || !originAllowed(responseOrigin, allowedOrigins)) {
    return { ...responseHeaders }
  }
  const result: Record<string, string[]> = { ...responseHeaders }
  for (const rule of headerRules) {
    if (!patternMatches(rule.urlFilter, responseUrl)) continue
    for (const [name, value] of Object.entries(rule.headers)) {
      result[name] = [value]
    }
  }
  return result
}
