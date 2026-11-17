import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import {
  HEALTH_THROTTLE_MS,
  buildHealthSnapshot,
  parseMediaProperties,
  startHealth
} from './health'
import type { HealthSnapshot } from '../../shared/shell-contract'

/**
 * Stream-health sampler tests (SHL-03). The sampler is READ-ONLY: it may only
 * touch `webContents.debugger`, never `executeJavaScript` or any page global.
 * Every metric the runtime cannot expose stays null (rendered as an em dash by
 * the overlay), and a detached/unattachable debugger degrades to statsLive:false
 * instead of throwing.
 */

function fakeDebugger(attachThrows = false) {
  const emitter = new EventEmitter()
  return {
    attach: vi.fn(() => {
      if (attachThrows) throw new Error('another debugger client is attached')
    }),
    detach: vi.fn(),
    isAttached: vi.fn(() => true),
    sendCommand: vi.fn(() => Promise.resolve({})),
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    emit: emitter.emit.bind(emitter)
  }
}
type FakeDebugger = ReturnType<typeof fakeDebugger>

function fakeWebContents(dbg: FakeDebugger): WebContents {
  return {
    debugger: dbg,
    executeJavaScript: vi.fn(() => {
      throw new Error('provider page must never be injected')
    })
  } as unknown as WebContents
}

describe('parseMediaProperties', () => {
  it('decodes JSON-encoded PlayerProperty name/value pairs into typed fields', () => {
    expect(
      parseMediaProperties([
        { name: 'kResolution', value: '"1920x1080"' },
        { name: 'kVideoDecoderName', value: '"VDAVideoDecoder"' },
        { name: 'kIsPlatformVideoDecoder', value: 'true' },
        { name: 'kFramerate', value: '59.94' },
        { name: 'kVideoPlaybackFreezingRatio', value: '0.02' }
      ])
    ).toEqual({
      resolution: '1920x1080',
      decoderName: 'VDAVideoDecoder',
      hardwareDecoder: true,
      framerate: 59.94,
      freezingRatio: 0.02
    })
  })

  it('accepts an unquoted string value', () => {
    expect(parseMediaProperties([{ name: 'kResolution', value: '1280x720' }])).toEqual({
      resolution: '1280x720'
    })
  })

  it('treats a false hardware-decoder property as boolean false, not truthy', () => {
    expect(parseMediaProperties([{ name: 'kIsPlatformVideoDecoder', value: 'false' }])).toEqual({
      hardwareDecoder: false
    })
    expect(parseMediaProperties([{ name: 'kIsPlatformVideoDecoder', value: '"false"' }])).toEqual({
      hardwareDecoder: false
    })
  })

  it('ignores unknown, malformed, and non-array input', () => {
    expect(
      parseMediaProperties([
        { name: 'kSomethingElse', value: '1' },
        { name: 7, value: 'x' },
        { value: 'no-name' },
        'nope',
        null
      ])
    ).toEqual({})
    expect(parseMediaProperties(undefined)).toEqual({})
    expect(parseMediaProperties({})).toEqual({})
  })
})

describe('buildHealthSnapshot (honest defaults)', () => {
  it('nulls RTT, dropped frames, and session — no compliant source exists', () => {
    expect(buildHealthSnapshot({ resolution: '1920x1080' }, true, 123)).toEqual({
      resolution: '1920x1080',
      rttMs: null,
      decoderName: null,
      hardwareDecoder: null,
      framerate: null,
      freezingRatio: null,
      droppedFrames: null,
      sessionStatus: null,
      statsLive: true,
      updatedAt: 123
    })
  })

  it('throttles at exactly 1s (UI-SPEC cadence)', () => {
    expect(HEALTH_THROTTLE_MS).toBe(1000)
  })
})

describe('startHealth (read-only CDP Media sampler)', () => {
  it('attaches CDP 1.3, enables Media, and never injects into the provider page', () => {
    const dbg = fakeDebugger()
    const wc = fakeWebContents(dbg)
    const updates: HealthSnapshot[] = []
    const stop = startHealth(wc, (s) => updates.push(s))

    expect(dbg.attach).toHaveBeenCalledWith('1.3')
    expect(dbg.sendCommand).toHaveBeenCalledWith('Media.enable')

    dbg.emit('message', {}, 'Media.playerPropertiesChanged', {
      properties: [{ name: 'kResolution', value: '"1280x720"' }]
    })
    // A detach both flushes the last snapshot and flips stats-live off.
    dbg.emit('detach')

    expect(updates.at(-1)).toMatchObject({ resolution: '1280x720', statsLive: false })
    expect(
      (wc as unknown as { executeJavaScript: ReturnType<typeof vi.fn> }).executeJavaScript
    ).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
  })

  it('degrades to statsLive:false (never throws) when the debugger cannot attach', () => {
    const dbg = fakeDebugger(true)
    const updates: HealthSnapshot[] = []
    const stop = startHealth(fakeWebContents(dbg), (s) => updates.push(s))

    expect(updates).toEqual([expect.objectContaining({ statsLive: false })])
    expect(() => stop()).not.toThrow()
  })

  it('ignores unrelated CDP methods and reports stats-live false on detach', () => {
    const dbg = fakeDebugger()
    const updates: HealthSnapshot[] = []
    const stop = startHealth(fakeWebContents(dbg), (s) => updates.push(s))

    dbg.emit('message', {}, 'Media.playerCreated', {})
    dbg.emit('detach')

    expect(updates.at(-1)).toMatchObject({ resolution: null, statsLive: false })
    stop()
  })
})
