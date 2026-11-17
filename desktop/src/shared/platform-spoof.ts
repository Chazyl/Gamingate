/**
 * Per-platform OS spoof codec shared by the main process and the INERT provider
 * preload.
 *
 * Main encodes the packet's `platformSpoof` onto the provider view via
 * `webPreferences.additionalArguments`; the preload decodes it and injects the
 * main-world overrides. This module is dependency-free — the only globals used
 * are the standard `btoa`/`atob` — so the SANDBOXED preload can bundle it
 * without pulling in zod or node builtins.
 */
import type { PlatformSpoof } from './types'

export type { PlatformSpoof }

/** `additionalArguments` prefix; mirrored by the preload's scan. */
export const PLATFORM_SPOOF_ARG = '--gamingate-platform-spoof='

/** Encode a packet's spoof for `additionalArguments` (base64 JSON). */
export function encodePlatformSpoof(spoof: PlatformSpoof): string {
  return PLATFORM_SPOOF_ARG + btoa(JSON.stringify(spoof))
}

/** Decode one `additionalArguments` entry; null when absent or malformed. */
export function decodePlatformSpoof(arg: string): PlatformSpoof | null {
  if (!arg.startsWith(PLATFORM_SPOOF_ARG)) return null
  try {
    const decoded: unknown = JSON.parse(atob(arg.slice(PLATFORM_SPOOF_ARG.length)))
    if (typeof decoded !== 'object' || decoded === null) return null
    const { platform, platformVersion } = decoded as Record<string, unknown>
    if (typeof platform !== 'string' || platform.length === 0) return null
    if (typeof platformVersion !== 'string' || platformVersion.length === 0) return null
    return { platform, platformVersion }
  } catch {
    return null
  }
}
