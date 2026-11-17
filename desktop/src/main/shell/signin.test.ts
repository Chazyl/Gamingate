import { describe, expect, it, vi } from 'vitest'
import { detectSignInState } from './signin'

/**
 * Evidence-based sign-in detection (SHL-01, SHL-05, threat T-03-15).
 *
 * Only cookie NAME presence is observed; a cookie VALUE is never read, logged,
 * or returned. No hints declared => 'unknown' (never guess).
 */

interface FakeCookie {
  name: string
  value?: string
}

function jar(names: string[]): { cookies: { get: ReturnType<typeof vi.fn> } } {
  const get = vi.fn(async ({ name }: { name: string }) =>
    names
      .filter((n) => n === name)
      .map((n): FakeCookie => ({ name: n }))
  )
  return { cookies: { get } }
}

describe('detectSignInState', () => {
  it("returns 'unknown' when the packet declares no hints (and never queries cookies)", async () => {
    const session = jar(['session-token'])
    await expect(detectSignInState({ authCookieHints: [] }, session as never)).resolves.toBe(
      'unknown'
    )
    expect(session.cookies.get).not.toHaveBeenCalled()
  })

  it("returns 'signed-in' when a hint-named cookie is present", async () => {
    const session = jar(['at-main'])
    await expect(
      detectSignInState({ authCookieHints: ['session-token', 'at-main'] }, session as never)
    ).resolves.toBe('signed-in')
  })

  it("returns 'signed-out' when hints are declared but absent", async () => {
    const session = jar([])
    await expect(
      detectSignInState({ authCookieHints: ['session-token'] }, session as never)
    ).resolves.toBe('signed-out')
  })

  it('never reads a cookie value', async () => {
    const cookie: FakeCookie = { name: 'session-token' }
    Object.defineProperty(cookie, 'value', {
      get() {
        throw new Error('cookie value must never be read')
      }
    })
    const session = { cookies: { get: async () => [cookie] } }
    await expect(
      detectSignInState({ authCookieHints: ['session-token'] }, session as never)
    ).resolves.toBe('signed-in')
  })
})
