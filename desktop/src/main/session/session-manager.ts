import { session, type Session } from 'electron'
import type { PlatformPacket } from '../../shared/types'
import {
  applyHeaderRules,
  applyPlatformSpoofHeaders,
  originAllowed,
  permissionNames,
  resolveUserAgent
} from './header-rules'
import { clearTargetsFor, engineSessionsToFlush } from './session-scope'

/**
 * Per-provider session factory and policy application.
 *
 * `sessionFor` creates/returns the partition's Session only. `configureSession`
 * is the single owner of identity (UA), origin-scoped permission grants (both
 * request and check handlers), and the one origin-scoped header listener.
 *
 * `packet.partition` already carries the `persist:` prefix; never re-prefix it.
 */

// Engine-owned sessions (created via `sessionFor`), used by the bounded
// flush-on-quit. Never `session.defaultSession`: the engine did not create it.
const engineSessionRegistry = new Set<Session>()

export function sessionFor(packet: PlatformPacket): Session {
  const ses = session.fromPartition(packet.partition)
  engineSessionRegistry.add(ses)
  return ses
}

/** Every partition the engine created this run. */
export function engineSessions(): Session[] {
  return [...engineSessionRegistry]
}

export function configureSession(ses: Session, packet: PlatformPacket): void {
  // Single UA owner: full UA passed through, fragment substituted into the default.
  ses.setUserAgent(resolveUserAgent(packet.userAgent, ses.getUserAgent()))

  const granted = new Set(permissionNames(packet.permissions))
  const isAllowed = (origin: string): boolean => originAllowed(origin, packet.allowedOrigins)

  // Both handlers are required for complete permission handling; a subframe in a
  // non-allowed origin is denied (threat T-02-03).
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    // `details` is a union: media requests carry securityOrigin, the base type
    // carries requestingUrl. Prefer the precise security origin when present.
    const origin =
      ('securityOrigin' in details ? details.securityOrigin : details.requestingUrl) ?? ''
    callback(granted.has(permission) && isAllowed(origin))
  })

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return granted.has(permission) && isAllowed(requestingOrigin)
  })

  // Exactly one listener per session: only the last onHeadersReceived is used.
  ses.webRequest.onHeadersReceived(
    { urls: packet.allowedOrigins.map((origin) => `${origin}/*`) },
    (details, callback) => {
      callback({
        responseHeaders: applyHeaderRules(
          details.url,
          packet.headerRules,
          packet.allowedOrigins,
          details.responseHeaders ?? {}
        )
      })
    }
  )

  // OS spoof (opt-in): override the platform Client Hints on outgoing requests,
  // scoped to the packet's declared origins only. Registered only when the packet
  // asks for it, so unset packets keep the real headers.
  if (packet.platformSpoof) {
    const spoof = packet.platformSpoof
    ses.webRequest.onBeforeSendHeaders(
      { urls: packet.allowedOrigins.map((origin) => `${origin}/*`) },
      (details, callback) => {
        callback({
          requestHeaders: applyPlatformSpoofHeaders(details.requestHeaders ?? {}, spoof)
        })
      }
    )
  }
}

// A single session's flush must never delay quit indefinitely: flushStorageData
// is synchronous, and the cookie flush is bounded by this deadline.
const FLUSH_TIMEOUT_MS = 3000

async function flushPersistentSession(ses: Session, timeoutMs: number): Promise<void> {
  try {
    ses.flushStorageData()
  } catch (error) {
    console.error('session: flushStorageData failed (continuing quit):', error)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      ses.cookies.flushStore(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      })
    ])
  } catch (error) {
    console.error('session: flushStore failed (continuing quit):', error)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * ENGINE-INTERNAL per-provider data clear (EMB-04, threat T-02-06).
 *
 * Resolves exactly the target packet's partition and clears only that Session:
 * `clearStorageData()` then `clearCache()` then `cookies.flushStore()`. It never
 * touches `session.defaultSession` and never a sibling partition.
 *
 * Deliberately NOT wired to any `ipcMain` handler or preload bridge this phase:
 * provider page content must never be able to clear a partition. Phase 3 binds
 * this to the trusted shell renderer behind a trusted-sender allowlist.
 */
export async function clearProvider(packet: PlatformPacket): Promise<void> {
  const ses = session.fromPartition(clearTargetsFor(packet))
  await ses.clearStorageData()
  await ses.clearCache()
  await ses.cookies.flushStore()
}

/**
 * Bounded flush of every persistent engine session (EMB-02, fast-quit gap).
 *
 * Resolves regardless of any per-session rejection or timeout, so the caller's
 * `finally { app.quit() }` always runs and the app can never hang in
 * prevented-quit. In-memory sessions are excluded by construction.
 */
export async function flushPersistentSessions(sessions: Session[]): Promise<void> {
  await Promise.all(
    engineSessionsToFlush(sessions).map((ses) =>
      flushPersistentSession(ses, FLUSH_TIMEOUT_MS)
    )
  )
}
