import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Trusted-sender allowlist tests (SHL-01, threats T-03-01/02/03).
 *
 * The gate must accept ONLY the registered shell main frame on an allowlisted
 * origin, and must reject a different webContents id (the provider view), a
 * subframe, and a non-allowlisted origin. A rejected gate must never invoke the
 * wrapped handler.
 */

const electronMock = vi.hoisted(() => ({ handlers: new Map<string, Function>(), handle: vi.fn() }))

vi.mock('electron', () => ({
  ipcMain: { handle: electronMock.handle }
}))

vi.mock('../session/session-manager', () => ({
  clearProvider: vi.fn(async () => undefined)
}))

import { clearProvider } from '../session/session-manager'
import type { Registry } from '../../shared/types'
import { IPC } from '../../shared/shell-contract'
import {
  __resetShellRegistry,
  assertTrustedShell,
  handleTrusted,
  handledChannels,
  registerShellIpc,
  registerShellView
} from './ipc'

interface FakeFrame {
  url: string
}
interface FakeSender {
  id: number
  mainFrame: FakeFrame
}
interface FakeEvent {
  sender: FakeSender
  senderFrame: FakeFrame | null
}

const SHELL_ID = 42
// The trusted shell document. Its `file://` origin is the opaque string 'null',
// which is why main registers the FULL URL and compares the concrete document
// (IM-03) rather than a vacuous origin.
const SHELL_URL = 'file:///work/out/renderer/index.html'

function shellEvent(overrides: Partial<FakeEvent> = {}): FakeEvent {
  const mainFrame = { url: SHELL_URL }
  return {
    sender: { id: SHELL_ID, mainFrame },
    senderFrame: mainFrame,
    ...overrides
  }
}

beforeEach(() => {
  __resetShellRegistry()
  electronMock.handlers.clear()
  electronMock.handle.mockImplementation((channel: string, fn: Function) => {
    electronMock.handlers.set(channel, fn)
  })
  vi.mocked(clearProvider).mockClear()
  registerShellView({ id: SHELL_ID } as unknown as Electron.WebContents, SHELL_URL)
})

describe('assertTrustedShell', () => {
  it('accepts the registered shell main frame from the allowlisted origin', () => {
    expect(() => assertTrustedShell(shellEvent() as never)).not.toThrow()
  })

  it('rejects a different webContents id (the provider view)', () => {
    const event = shellEvent({ sender: { id: 99, mainFrame: { url: 'file:///work/out/renderer/index.html' } } })
    event.senderFrame = event.sender.mainFrame
    expect(() => assertTrustedShell(event as never)).toThrowError(/untrusted webContents/)
  })

  it('rejects a subframe with a different frame url', () => {
    const event = shellEvent({
      senderFrame: { url: 'https://evil.example/' }
    })
    expect(() => assertTrustedShell(event as never)).toThrowError(/subframe not allowed/)
  })

  it('rejects a non-allowlisted origin', () => {
    const frame = { url: 'https://evil.example/page' }
    const event = shellEvent({ senderFrame: frame, sender: { id: SHELL_ID, mainFrame: frame } })
    expect(() => assertTrustedShell(event as never)).toThrowError(/untrusted origin/)
  })

  it('rejects a different file:// document that shares the opaque origin', () => {
    const frame = { url: 'file:///etc/passwd' }
    const event = shellEvent({ senderFrame: frame, sender: { id: SHELL_ID, mainFrame: frame } })
    expect(() => assertTrustedShell(event as never)).toThrowError(/untrusted origin/)
  })

  it('rejects a null sender frame', () => {
    expect(() => assertTrustedShell(shellEvent({ senderFrame: null }) as never)).toThrowError(
      /sender frame destroyed/
    )
  })
})

describe('handleTrusted', () => {
  it('never invokes the wrapped function when the gate throws', () => {
    const fn = vi.fn()
    handleTrusted('gamingate:test', 'read', fn)
    const handler = electronMock.handlers.get('gamingate:test')!
    const event = shellEvent({ sender: { id: 99, mainFrame: { url: 'file:///x' } } })
    event.senderFrame = event.sender.mainFrame
    expect(() => handler(event)).toThrowError(/untrusted webContents/)
    expect(fn).not.toHaveBeenCalled()
  })

  it('invokes the wrapped function for a trusted shell call', () => {
    const fn = vi.fn(() => 'ok')
    handleTrusted('gamingate:test', 'read', fn)
    const handler = electronMock.handlers.get('gamingate:test')!
    expect(handler(shellEvent())).toBe('ok')
    expect(fn).toHaveBeenCalledOnce()
  })

  it('records read/write channel access for the coverage gate', () => {
    handleTrusted('gamingate:a', 'read', () => undefined)
    handleTrusted('gamingate:b', 'write', () => undefined)
    expect(handledChannels()).toEqual({ read: ['gamingate:a'], write: ['gamingate:b'] })
  })
})

describe('registerShellIpc handlers', () => {
  const registry: Registry = {
    schemaVersion: '1',
    platforms: [
      {
        id: 'luna',
        name: 'Amazon Luna',
        entryUrl: 'https://luna.amazon.com/',
        allowedOrigins: ['https://luna.amazon.com'],
        userAgent: 'Mozilla/5.0',
        partition: 'persist:luna',
        permissions: { media: true, input: true, pointerLock: true, fullscreen: true },
        headerRules: [],
        codecHints: [],
        authCookieHints: [],
        gpuHints: {},
        thirdPartyCookies: false
      }
    ]
  }

  function deps(over: Partial<Parameters<typeof registerShellIpc>[0]> = {}) {
    return {
      registry,
      listPlatforms: () => [
        {
          id: 'luna',
          name: 'Amazon Luna',
          signIn: 'unknown' as const,
          codecHints: [],
          thirdPartyCookies: false,
          userAgent: 'Mozilla/5.0'
        }
      ],
      launch: vi.fn(() => ({ status: 'starting' as const, platformId: 'luna', error: null })),
      stop: vi.fn(() => ({ status: 'stopped' as const, platformId: null, error: null })),
      sessionState: vi.fn(() => ({ status: 'stopped' as const, platformId: null, error: null })),
      setOverlay: vi.fn(),
      getPrefs: vi.fn(() => ({ codecForce: 'auto' as const, hintsSeen: false, perPlatform: {} })),
      setPrefs: vi.fn(() => ({ codecForce: 'auto' as const, hintsSeen: false, perPlatform: {} })),
      getDecodeState: vi.fn(() => ({
        mode: 'auto' as const,
        backend: 'unknown',
        videoDecodeStatus: 'unprobed',
        probedAt: null,
        source: 'default' as const
      })),
      setDecodeMode: vi.fn(() => ({ applied: true, relaunched: false, error: 'relaunch blocked' })),
      setCodecForce: vi.fn(() => ({ applied: true, relaunched: false, error: 'relaunch blocked' })),
      ...over
    }
  }

  it('clear-provider resolves the packet from the registry by id', async () => {
    registerShellIpc(deps())
    const handler = electronMock.handlers.get(IPC.clearProvider)!
    await expect(handler(shellEvent(), 'luna')).resolves.toBe(true)
    expect(clearProvider).toHaveBeenCalledWith(registry.platforms[0])
  })

  it('clear-provider rejects a raw partition / unknown id', async () => {
    registerShellIpc(deps())
    const handler = electronMock.handlers.get(IPC.clearProvider)!
    await expect(handler(shellEvent(), 'persist:luna')).rejects.toThrow(/unknown platform/)
    expect(clearProvider).not.toHaveBeenCalled()
  })

  it('launch/stop validate the id payload', () => {
    const d = deps()
    registerShellIpc(d)
    electronMock.handlers.get(IPC.launch)!(shellEvent(), 'luna')
    expect(d.launch).toHaveBeenCalledWith('luna')
    expect(() => electronMock.handlers.get(IPC.launch)!(shellEvent(), 5)).toThrow()
  })

  it('set-overlay validates the boolean payload', () => {
    const d = deps()
    registerShellIpc(d)
    electronMock.handlers.get(IPC.setOverlay)!(shellEvent(), true)
    expect(d.setOverlay).toHaveBeenCalledWith(true)
    expect(() => electronMock.handlers.get(IPC.setOverlay)!(shellEvent(), 'yes')).toThrow()
  })

  it('get-prefs returns the main-owned prefs', () => {
    const d = deps()
    registerShellIpc(d)
    expect(electronMock.handlers.get(IPC.getPrefs)!(shellEvent())).toEqual({
      codecForce: 'auto',
      hintsSeen: false,
      perPlatform: {}
    })
    expect(d.getPrefs).toHaveBeenCalled()
  })

  it('set-prefs validates the patch enum before writing', () => {
    const d = deps()
    registerShellIpc(d)
    electronMock.handlers.get(IPC.setPrefs)!(shellEvent(), { codecForce: 'h264' })
    expect(d.setPrefs).toHaveBeenCalledWith({ codecForce: 'h264' })
    expect(() => electronMock.handlers.get(IPC.setPrefs)!(shellEvent(), { codecForce: 'h265' })).toThrow()
    expect(d.setPrefs).toHaveBeenCalledTimes(1)
  })

  it('get-decode-state returns the main-owned evidence state', () => {
    const d = deps()
    registerShellIpc(d)
    expect(electronMock.handlers.get(IPC.getDecodeState)!(shellEvent())).toEqual({
      mode: 'auto',
      backend: 'unknown',
      videoDecodeStatus: 'unprobed',
      probedAt: null,
      source: 'default'
    })
    expect(d.getDecodeState).toHaveBeenCalled()
  })

  it('set-decode-mode validates the mode enum before relaunching', () => {
    const d = deps()
    registerShellIpc(d)
    electronMock.handlers.get(IPC.setDecodeMode)!(shellEvent(), 'software')
    expect(d.setDecodeMode).toHaveBeenCalledWith('software')
    expect(() => electronMock.handlers.get(IPC.setDecodeMode)!(shellEvent(), 'h265')).toThrow()
    expect(d.setDecodeMode).toHaveBeenCalledTimes(1)
  })

  it('set-codec-force validates the payload and rejects an unknown codec', () => {
    const d = deps()
    registerShellIpc(d)
    electronMock.handlers.get(IPC.setCodecForce)!(shellEvent(), {
      platformId: 'luna',
      codecForce: 'av1'
    })
    expect(d.setCodecForce).toHaveBeenCalledWith({ platformId: 'luna', codecForce: 'av1' })
    expect(() =>
      electronMock.handlers.get(IPC.setCodecForce)!(shellEvent(), {
        platformId: 'luna',
        codecForce: 'h265'
      })
    ).toThrow()
    expect(d.setCodecForce).toHaveBeenCalledTimes(1)
  })
})
