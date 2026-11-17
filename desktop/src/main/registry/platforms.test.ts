import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { parseRegistry, Registry } from '../../shared/types'
import { permissionNames } from '../session/header-rules'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '../../../platforms.schema.json')
// The real bundled fixture, read through the PURE parser (not the asset-path
// loader) so vitest does not have to resolve the `?commonjs-external&asset`
// bundler suffix.
const realRegistryPath = join(here, '../../../platforms.json')

function realRegistry(): unknown {
  return JSON.parse(readFileSync(realRegistryPath, 'utf8'))
}

function validRegistry(): unknown {
  return {
    schemaVersion: '1',
    platforms: [
      {
        id: 'luna',
        name: 'Amazon Luna',
        entryUrl: 'https://luna.amazon.com/',
        allowedOrigins: ['https://luna.amazon.com', 'https://www.amazon.com'],
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0',
        partition: 'persist:luna',
        permissions: { media: true, input: true, pointerLock: true, fullscreen: true },
        headerRules: [],
        codecHints: [],
        gpuHints: {},
        thirdPartyCookies: true
      }
    ]
  }
}

function packet(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...(validRegistry() as { platforms: Record<string, unknown>[] }).platforms[0], ...overrides }
}

describe('parseRegistry (REG-01 fail closed)', () => {
  it('accepts a valid Luna registry and returns typed packets', () => {
    const registry = parseRegistry(validRegistry())
    expect(registry.platforms).toHaveLength(1)
    expect(registry.platforms[0].id).toBe('luna')
    expect(registry.platforms[0].partition).toBe('persist:luna')
  })

  it('rejects a packet missing id, naming the field', () => {
    const raw = validRegistry() as { platforms: Record<string, unknown>[] }
    delete raw.platforms[0].id
    expect(() => parseRegistry(raw)).toThrowError(/id/)
  })

  it('rejects a non-URL entryUrl, naming the field', () => {
    const raw = validRegistry() as { platforms: Record<string, unknown>[] }
    raw.platforms[0].entryUrl = 'not-a-url'
    expect(() => parseRegistry(raw)).toThrowError(/entryUrl/)
  })

  it('rejects a partition lacking the persist: prefix, naming the field', () => {
    const raw = validRegistry() as { platforms: Record<string, unknown>[] }
    raw.platforms[0].partition = 'luna'
    expect(() => parseRegistry(raw)).toThrowError(/partition/)
  })

  it('rejects an unsupported schemaVersion', () => {
    const raw = validRegistry() as { schemaVersion: string }
    raw.schemaVersion = '2'
    expect(() => parseRegistry(raw)).toThrowError(/schemaVersion/)
  })
})

describe('Registry cross-field invariants', () => {
  it('rejects duplicate packet ids', () => {
    const raw = validRegistry() as { platforms: unknown[] }
    raw.platforms.push(packet({ partition: 'persist:luna2' }))
    expect(() => parseRegistry(raw)).toThrowError(/duplicate/)
  })

  it('rejects duplicate partitions', () => {
    const raw = validRegistry() as { platforms: unknown[] }
    raw.platforms.push(packet({ id: 'luna2' }))
    expect(() => parseRegistry(raw)).toThrowError(/duplicate/)
  })

  it('rejects an entryUrl whose origin is not in allowedOrigins', () => {
    const raw = validRegistry() as { platforms: Record<string, unknown>[] }
    raw.platforms[0].allowedOrigins = ['https://other.example']
    expect(() => parseRegistry(raw)).toThrowError(/allowedOrigins/)
  })

  it('rejects a headerRule whose urlFilter origin is not in allowedOrigins', () => {
    const raw = validRegistry() as { platforms: Record<string, unknown>[] }
    raw.platforms[0].headerRules = [{ urlFilter: 'https://evil.example/*', headers: {} }]
    expect(() => parseRegistry(raw)).toThrowError(/allowedOrigins/)
  })
})

describe('real platforms.json fixture (REG-03 multi-packet plurality)', () => {
  it('parses both real packets through the pure parser', () => {
    const registry = parseRegistry(realRegistry())
    expect(registry.platforms).toHaveLength(2)
    expect(registry.platforms.map((p) => p.id)).toEqual(['luna', 'geforce-now-spike'])
  })

  it('carries the second packet with its own partition, origin, UA, and all-false permissions', () => {
    const registry = parseRegistry(realRegistry())
    const spike = registry.platforms[1]
    expect(spike.id).toBe('geforce-now-spike')
    expect(spike.partition).toBe('persist:geforce-now-spike')
    expect(spike.partition).not.toBe(registry.platforms[0].partition)
    expect(new URL(spike.entryUrl).origin).toBe('https://www.nvidia.com')
    expect(spike.allowedOrigins).toContain('https://www.nvidia.com')
    expect(spike.userAgent).not.toBe(registry.platforms[0].userAgent)
    expect(spike.permissions).toEqual({
      media: false,
      input: false,
      pointerLock: false,
      fullscreen: false
    })
    expect(spike.headerRules).toEqual([])
    expect(spike.codecHints).toEqual([])
    expect(spike.gpuHints).toEqual({})
    expect(spike.thirdPartyCookies).toBe(false)
  })

  it('grants the second packet no DRM because media is false (02-01 conditional policy)', () => {
    const registry = parseRegistry(realRegistry())
    const grants = permissionNames(registry.platforms[1].permissions)
    expect(grants).not.toContain('media')
    expect(grants).not.toContain('mediaKeySystem')
  })

  it('still fails closed when the fixture drops a required field, naming it', () => {
    const raw = realRegistry() as { platforms: Record<string, unknown>[] }
    delete raw.platforms[1].id
    expect(() => parseRegistry(raw)).toThrowError(/id/)
  })
})

describe('registry plurality (additional valid packets)', () => {
  it('accepts a third additional valid packet', () => {
    const raw = validRegistry() as { platforms: unknown[] }
    raw.platforms.push(packet({ id: 'third-provider', partition: 'persist:third-provider' }))
    const registry = parseRegistry(raw)
    expect(registry.platforms.map((p) => p.id)).toEqual(['luna', 'third-provider'])
  })

  it('rejects an additional packet that omits a required field, naming it', () => {
    const raw = validRegistry() as { platforms: Record<string, unknown>[] }
    const extra = packet({ id: 'third-provider', partition: 'persist:third-provider' })
    delete extra.name
    raw.platforms.push(extra)
    expect(() => parseRegistry(raw)).toThrowError(/name/)
  })
})

describe('platforms.schema.json drift guard (REG-01 both runtimes)', () => {
  it('deep-equals a fresh z.toJSONSchema(Registry) generation', () => {
    const committed = JSON.parse(readFileSync(schemaPath, 'utf8'))
    expect(committed).toEqual(z.toJSONSchema(Registry))
  })
})
