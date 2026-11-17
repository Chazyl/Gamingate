import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({ fromPartition: vi.fn() }))

vi.mock('electron', () => ({
  session: { fromPartition: electronMock.fromPartition }
}))

import type { Session } from 'electron'
import type { PlatformPacket } from '../../shared/types'
import { clearProvider, flushPersistentSessions } from './session-manager'
import { clearTargetsFor, engineSessionsToFlush } from './session-scope'

interface FakeSession {
  isPersistent: ReturnType<typeof vi.fn>
  flushStorageData: ReturnType<typeof vi.fn>
  clearStorageData: ReturnType<typeof vi.fn>
  clearCache: ReturnType<typeof vi.fn>
  cookies: {
    flushStore: ReturnType<typeof vi.fn>
  }
}

function fakeSession(persistent: boolean): FakeSession {
  return {
    isPersistent: vi.fn(() => persistent),
    flushStorageData: vi.fn(),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    cookies: {
      flushStore: vi.fn().mockResolvedValue(undefined)
    }
  }
}

function packet(partition: string): PlatformPacket {
  return {
    id: partition.replace('persist:', ''),
    name: partition,
    entryUrl: 'https://luna.amazon.com/',
    allowedOrigins: ['https://luna.amazon.com'],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/152.0.0.0',
    partition,
    permissions: { media: true, input: true, pointerLock: true, fullscreen: true },
    headerRules: [],
    codecHints: [],
    authCookieHints: [],
    gpuHints: {},
    thirdPartyCookies: true
  }
}

describe('clearTargetsFor (partition scope)', () => {
  it('returns only the packet partition key', () => {
    expect(clearTargetsFor(packet('persist:luna'))).toBe('persist:luna')
  })
})

describe('clearProvider (EMB-04 partition isolation)', () => {
  beforeEach(() => {
    electronMock.fromPartition.mockReset()
  })

  it('clears only the target partition and leaves the sibling untouched', async () => {
    const target = fakeSession(true)
    const sibling = fakeSession(true)
    electronMock.fromPartition.mockImplementation((partition: string) =>
      partition === 'persist:luna' ? target : sibling
    )

    await clearProvider(packet('persist:luna'))

    expect(electronMock.fromPartition).toHaveBeenCalledTimes(1)
    expect(electronMock.fromPartition).toHaveBeenCalledWith('persist:luna')
    expect(target.clearStorageData).toHaveBeenCalledTimes(1)
    expect(target.clearCache).toHaveBeenCalledTimes(1)
    expect(target.cookies.flushStore).toHaveBeenCalledTimes(1)
    expect(sibling.clearStorageData).not.toHaveBeenCalled()
    expect(sibling.clearCache).not.toHaveBeenCalled()
    expect(sibling.cookies.flushStore).not.toHaveBeenCalled()
  })
})

describe('engineSessionsToFlush / flushPersistentSessions (EMB-02 bounded flush)', () => {
  it('excludes in-memory (non-persistent) sessions from the flush set', () => {
    const persisted = fakeSession(true) as unknown as Session
    const memory = fakeSession(false) as unknown as Session
    expect(engineSessionsToFlush([persisted, memory])).toEqual([persisted])
  })

  it('flushes only persistent sessions and still resolves when a flush rejects', async () => {
    const persisted = fakeSession(true)
    const memory = fakeSession(false)
    persisted.cookies.flushStore.mockRejectedValue(new Error('disk full'))

    await expect(
      flushPersistentSessions([persisted, memory] as unknown as Session[])
    ).resolves.toBeUndefined()

    expect(persisted.flushStorageData).toHaveBeenCalledTimes(1)
    expect(persisted.cookies.flushStore).toHaveBeenCalledTimes(1)
    expect(memory.flushStorageData).not.toHaveBeenCalled()
    expect(memory.cookies.flushStore).not.toHaveBeenCalled()
  })
})
