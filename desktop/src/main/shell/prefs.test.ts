import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { codecForcePatch, prefsPath, readPrefs, resolveCodecForce, writePrefs } from './prefs'

/**
 * Local prefs store (SHL-05, threat T-03-14).
 *
 * `prefs.json` lives under userData, is zod-validated on read/write, and is
 * written atomically (tmp + rename). A missing/malformed file must NEVER throw —
 * it falls back to schema defaults so a corrupt file cannot brick the shell.
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gamingate-prefs-'))
})

describe('readPrefs', () => {
  it('returns schema defaults when prefs.json is missing', () => {
    expect(readPrefs(dir)).toEqual({ codecForce: 'auto', hintsSeen: false, perPlatform: {} })
  })

  it('returns defaults for a malformed file without throwing', () => {
    writeFileSync(prefsPath(dir), '{ not valid json')
    expect(readPrefs(dir)).toEqual({ codecForce: 'auto', hintsSeen: false, perPlatform: {} })
  })

  it('returns defaults for schema-invalid content (unknown codec)', () => {
    writeFileSync(prefsPath(dir), JSON.stringify({ codecForce: 'h265' }))
    expect(readPrefs(dir)).toEqual({ codecForce: 'auto', hintsSeen: false, perPlatform: {} })
  })
})

describe('writePrefs', () => {
  it('validates, merges, and round-trips a patch', () => {
    const next = writePrefs(dir, {
      codecForce: 'h264',
      perPlatform: { luna: { codecForce: 'vp9' } }
    })
    expect(next).toEqual({
      codecForce: 'h264',
      hintsSeen: false,
      perPlatform: { luna: { codecForce: 'vp9' } }
    })
    expect(readPrefs(dir)).toEqual(next)
  })

  it('persists the first-session hintsSeen flag', () => {
    const next = writePrefs(dir, { hintsSeen: true })
    expect(next.hintsSeen).toBe(true)
    expect(readPrefs(dir).hintsSeen).toBe(true)
  })

  it('merges successive per-platform patches without dropping existing entries', () => {
    writePrefs(dir, { perPlatform: { luna: { codecForce: 'av1' } } })
    writePrefs(dir, { perPlatform: { spike: { codecForce: 'vp9' } } })
    expect(readPrefs(dir).perPlatform).toEqual({
      luna: { codecForce: 'av1' },
      spike: { codecForce: 'vp9' }
    })
  })

  it('writes atomically (no temp file left behind)', () => {
    writePrefs(dir, { codecForce: 'h264' })
    const files = readdirSync(dir)
    expect(files).toContain('prefs.json')
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false)
  })

  it('rejects an unknown codec enum', () => {
    expect(() => writePrefs(dir, { codecForce: 'h265' as never })).toThrow()
  })
})

describe('resolveCodecForce', () => {
  it('prefers the per-platform override', () => {
    const prefs = writePrefs(dir, {
      codecForce: 'h264',
      perPlatform: { luna: { codecForce: 'av1' } }
    })
    expect(resolveCodecForce(prefs, 'luna')).toBe('av1')
  })

  it('falls back to the global value when no override exists', () => {
    const prefs = writePrefs(dir, { codecForce: 'vp9' })
    expect(resolveCodecForce(prefs, 'luna')).toBe('vp9')
  })

  it("defaults to 'auto'", () => {
    expect(resolveCodecForce(readPrefs(dir), 'luna')).toBe('auto')
  })
})

describe('codecForcePatch', () => {
  it('writes a per-platform override when a platform is selected', () => {
    expect(codecForcePatch('luna', 'av1')).toEqual({ perPlatform: { luna: { codecForce: 'av1' } } })
    const next = writePrefs(dir, codecForcePatch('luna', 'av1'))
    expect(resolveCodecForce(next, 'luna')).toBe('av1')
  })

  it('writes the global value when no platform is selected', () => {
    expect(codecForcePatch(null, 'vp9')).toEqual({ codecForce: 'vp9' })
    const next = writePrefs(dir, codecForcePatch(null, 'vp9'))
    expect(resolveCodecForce(next, 'luna')).toBe('vp9')
  })
})
