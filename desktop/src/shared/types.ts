import { z } from 'zod'

/**
 * Shared registry contract for the gateway engine (REG-01).
 *
 * One zod schema is the single source of truth for the packet shape and (via
 * `z.infer`) the TypeScript types compiled by main and preload. The same schema
 * is exported to `platforms.schema.json` so the Android shell enforces the
 * identical contract (task 2).
 *
 * Fail closed: a corrupt packet must never reach the embed path. `parseRegistry`
 * throws an Error built from `z.prettifyError`, which names the offending field.
 */

export const HeaderRule = z.object({
  // Electron webRequest URL match pattern (e.g. "https://luna.amazon.com/*").
  urlFilter: z.string().min(1),
  // Explicit header allow-map: only these names are touched; everything else
  // passes through byte-identical (no blanket CSP/X-Frame-Options deletion).
  headers: z.record(z.string(), z.string())
})

export const PermissionSet = z.object({
  media: z.boolean(),
  input: z.boolean(),
  pointerLock: z.boolean(),
  fullscreen: z.boolean()
})

/**
 * Optional per-packet OS spoof. Some providers block Linux outright (Luna shows
 * "Système d'exploitation non pris en charge"); when set, the provider view must
 * report this platform CONSISTENTLY across `navigator.platform`,
 * `navigator.userAgentData`, and the Sec-CH-UA-Platform Client Hints.
 */
export const PlatformSpoof = z.object({
  platform: z.string().min(1),
  platformVersion: z.string().min(1)
})

export const PlatformPacket = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  entryUrl: z.string().url(),
  // Full origins (scheme + host), e.g. "https://luna.amazon.com".
  allowedOrigins: z.array(z.string().url()),
  // Desktop UA: either a full UA (contains the Mozilla token) or a fragment to
  // substitute into the default. Resolution is owned by session-manager (task 2).
  userAgent: z.string().min(1),
  // Chromium persistent partition name. The `persist:` prefix is mandatory: a
  // missing prefix is in-memory only and would silently drop the session.
  partition: z.string().startsWith('persist:'),
  permissions: PermissionSet,
  headerRules: z.array(HeaderRule).default([]),
  codecHints: z.array(z.string()).default([]),
  // Provider auth cookie NAMES (never values) whose presence in the packet
  // partition evidences a signed-in session. Empty => sign-in state is
  // 'unknown', never guessed (SHL-01). Provider-specific names live here in
  // data, so the engine source stays provider-agnostic.
  authCookieHints: z.array(z.string()).default([]),
  gpuHints: z
    .object({ disableHardwareAcceleration: z.boolean().optional() })
    .default({}),
  thirdPartyCookies: z.boolean(),
  // Optional: packets that must not expose the real OS opt in here; unset
  // packets are unchanged.
  platformSpoof: PlatformSpoof.optional()
})

function urlOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export const Registry = z
  .object({
    schemaVersion: z.enum(['1']),
    platforms: z.array(PlatformPacket).min(1)
  })
  // Cross-field invariants (REG-01). These are TS/runtime-only: z.toJSONSchema
  // drops refinements, so `platforms.schema.json` carries the structural rules
  // and these invariants are proven by the vitest suite (Assumption 1).
  .superRefine((registry, ctx) => {
    const seenIds = new Set<string>()
    const seenPartitions = new Set<string>()
    registry.platforms.forEach((platform, index) => {
      if (seenIds.has(platform.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate platform id: ${platform.id}`,
          path: ['platforms', index, 'id']
        })
      }
      seenIds.add(platform.id)

      if (seenPartitions.has(platform.partition)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate platform partition: ${platform.partition}`,
          path: ['platforms', index, 'partition']
        })
      }
      seenPartitions.add(platform.partition)

      const entryOrigin = urlOrigin(platform.entryUrl)
      const allowed = new Set(platform.allowedOrigins.map(urlOrigin))
      if (entryOrigin && !allowed.has(entryOrigin)) {
        ctx.addIssue({
          code: 'custom',
          message: `entryUrl origin ${entryOrigin} is not in allowedOrigins`,
          path: ['platforms', index, 'entryUrl']
        })
      }

      platform.headerRules.forEach((rule, ruleIndex) => {
        const ruleOrigin = urlOrigin(rule.urlFilter)
        if (ruleOrigin && !allowed.has(ruleOrigin)) {
          ctx.addIssue({
            code: 'custom',
            message: `headerRule origin ${ruleOrigin} is not in allowedOrigins`,
            path: ['platforms', index, 'headerRules', ruleIndex, 'urlFilter']
          })
        }
      })
    })
  })

export type HeaderRule = z.infer<typeof HeaderRule>
export type PermissionSet = z.infer<typeof PermissionSet>
export type PlatformSpoof = z.infer<typeof PlatformSpoof>
export type PlatformPacket = z.infer<typeof PlatformPacket>
export type Registry = z.infer<typeof Registry>

/** Parse + validate a raw registry object; throw a field-naming Error on failure. */
export function parseRegistry(raw: unknown): Registry {
  const result = Registry.safeParse(raw)
  if (!result.success) {
    throw new Error('platforms.json failed validation:\n' + z.prettifyError(result.error))
  }
  return result.data
}
