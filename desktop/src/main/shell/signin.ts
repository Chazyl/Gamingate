import type { PlatformPacket } from '../../shared/types'
import type { SignInState } from '../../shared/shell-contract'

/**
 * Evidence-based sign-in detection (SHL-01, SHL-05, threat T-03-15).
 *
 * The gateway observes cookie NAME presence only — never a cookie value, never
 * credentials. `authCookieHints` come from the registry packet (data), so the
 * engine stays provider-agnostic. With no hints declared the state is
 * `unknown`; it is only `signed-in` on evidenced hint-cookie presence.
 *
 * The `session` is already the packet's `persist:<id>` partition, so a
 * name-filtered query is scoped to the provider by construction.
 */

/** Minimal structural view of an Electron `Session` cookie jar (test-friendly). */
export interface CookieNameLister {
  cookies: {
    get(filter: { name: string }): Promise<Array<{ name: string }>>
  }
}

export async function detectSignInState(
  packet: Pick<PlatformPacket, 'authCookieHints'>,
  session: CookieNameLister
): Promise<SignInState> {
  const hints = packet.authCookieHints ?? []
  if (hints.length === 0) return 'unknown'
  for (const name of hints) {
    const cookies = await session.cookies.get({ name })
    // Presence only: match on `.name`, never read `.value`.
    if (cookies.some((cookie) => cookie.name === name)) return 'signed-in'
  }
  return 'signed-out'
}
