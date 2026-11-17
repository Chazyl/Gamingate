import { describe, expect, it, vi } from 'vitest'

/** The provider view builder is imported after the electron mock below. */
vi.mock('electron', () => ({
  BaseWindow: class {},
  WebContentsView: class {}
}))

import type { PlatformPacket } from '../../shared/types'
import {
  applyInputThrottlingFlags,
  INPUT_THROTTLING_SWITCHES,
  WINDOWS_OCCLUSION_FEATURE
} from './input-flags'
import { buildProviderWebPreferences } from '../view/view-manager'
import { encodePlatformSpoof } from '../../shared/platform-spoof'

/**
 * PERF-03 flag wiring: the pre-ready switches disable Chromium timer/renderer/
 * occlusion throttling, and the provider view disables backgroundThrottling AT
 * CREATION (never toggled at runtime — Electron #50250).
 */

interface FakeCommandLine {
  switches: Map<string, string | undefined>
  appendSwitch: (key: string, value?: string) => void
  hasSwitch: (key: string) => boolean
}

function fakeCommandLine(): FakeCommandLine {
  const switches = new Map<string, string | undefined>()
  return {
    switches,
    appendSwitch: (key: string, value?: string) => {
      switches.set(key, value)
    },
    hasSwitch: (key: string) => switches.has(key)
  }
}

const PACKET = {
  partition: 'persist:luna'
} as unknown as PlatformPacket

describe('applyInputThrottlingFlags', () => {
  it('appends every throttling switch with no value', () => {
    const cmd = fakeCommandLine()
    applyInputThrottlingFlags(cmd, 'linux')

    for (const flag of INPUT_THROTTLING_SWITCHES) {
      expect(cmd.switches.get(flag)).toBeUndefined()
    }
    expect(cmd.switches.size).toBe(INPUT_THROTTLING_SWITCHES.length)
  })

  it('appends each switch exactly once across repeated calls', () => {
    const cmd = fakeCommandLine()
    applyInputThrottlingFlags(cmd, 'linux')
    applyInputThrottlingFlags(cmd, 'linux')
    expect(cmd.switches.size).toBe(INPUT_THROTTLING_SWITCHES.length)
  })

  it('adds the Windows-only occlusion disable-features switch on win32', () => {
    const cmd = fakeCommandLine()
    applyInputThrottlingFlags(cmd, 'win32')
    expect(cmd.switches.get('disable-features')).toBe(WINDOWS_OCCLUSION_FEATURE)
  })

  it('does not add the occlusion feature on non-Windows platforms', () => {
    const cmd = fakeCommandLine()
    applyInputThrottlingFlags(cmd, 'linux')
    expect(cmd.switches.has('disable-features')).toBe(false)
  })
})

describe('buildProviderWebPreferences', () => {
  it('disables backgroundThrottling at view creation', () => {
    const prefs = buildProviderWebPreferences(PACKET, '/preload/index.js')
    expect(prefs.backgroundThrottling).toBe(false)
  })

  it('omits additionalArguments when the packet declares no platform spoof', () => {
    const prefs = buildProviderWebPreferences(PACKET, '/preload/index.js')
    expect(prefs.additionalArguments).toBeUndefined()
  })

  it('passes the encoded platform spoof as additionalArguments when declared', () => {
    const spoofed = {
      partition: 'persist:luna',
      platformSpoof: { platform: 'Windows', platformVersion: '10.0.0' }
    } as unknown as PlatformPacket
    const prefs = buildProviderWebPreferences(spoofed, '/preload/index.js')
    expect(prefs.additionalArguments).toEqual([encodePlatformSpoof(spoofed.platformSpoof!)])
  })
})
