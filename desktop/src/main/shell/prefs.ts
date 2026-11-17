import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  Prefs,
  PrefsPatch,
  type CodecForce
} from '../../shared/shell-contract'

/**
 * Local prefs store (SHL-05, threat T-03-14).
 *
 * Same plain-fs pattern as `decode/capability.ts` — no `electron-store` (ESM-only,
 * would `ERR_REQUIRE_ESM` in the CJS main bundle). `prefs.json` lives under
 * `app.getPath('userData')`, is zod-validated on read AND write, and is written
 * atomically (temp file + rename) so a crash can never leave a half-written
 * settings file. A missing or malformed file falls back to schema defaults and
 * never throws, so a corrupt file cannot brick the shell.
 *
 * The functions take an explicit `dir` (not `app.getPath`) so they are unit
 * testable without Electron.
 */

export const PREFS_FILENAME = 'prefs.json'

export function prefsPath(dir: string): string {
  return join(dir, PREFS_FILENAME)
}

/** Schema defaults: auto codec, no per-platform overrides. */
export function defaultPrefs(): Prefs {
  return Prefs.parse({})
}

/** Read + validate prefs; missing/malformed/schema-invalid => defaults. */
export function readPrefs(dir: string): Prefs {
  const path = prefsPath(dir)
  if (!existsSync(path)) return defaultPrefs()
  try {
    return Prefs.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return defaultPrefs()
  }
}

/**
 * Validate a patch, merge it over the current prefs, and write atomically.
 * Throws a ZodError on an invalid enum (e.g. an unknown codec), so main can
 * reject the IPC call instead of persisting garbage.
 */
export function writePrefs(dir: string, patch: PrefsPatch): Prefs {
  const validated = PrefsPatch.parse(patch)
  const current = readPrefs(dir)

  const perPlatform: Record<string, { codecForce?: CodecForce }> = {
    ...current.perPlatform
  }
  for (const [id, platformPatch] of Object.entries(validated.perPlatform ?? {})) {
    perPlatform[id] = { ...current.perPlatform[id], ...platformPatch }
  }

  const next = Prefs.parse({
    codecForce: validated.codecForce ?? current.codecForce,
    hintsSeen: validated.hintsSeen ?? current.hintsSeen,
    perPlatform
  })

  mkdirSync(dir, { recursive: true })
  const path = prefsPath(dir)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2))
  renameSync(tmp, path)
  return next
}

/** Platform override when present, else the global value, else 'auto'. */
export function resolveCodecForce(prefs: Prefs, platformId: string): CodecForce {
  return prefs.perPlatform[platformId]?.codecForce ?? prefs.codecForce
}

/**
 * Build the validated prefs patch for a codec-force change: a per-platform
 * override when a platform is selected, else the global default. Codec force is
 * only ever a persisted provider-dependent hint — the provider negotiates the
 * actual codec (03-RESEARCH A6), so this never claims a codec changed.
 */
export function codecForcePatch(platformId: string | null, codecForce: CodecForce): PrefsPatch {
  return platformId ? { perPlatform: { [platformId]: { codecForce } } } : { codecForce }
}
