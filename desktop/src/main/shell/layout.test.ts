import { describe, expect, it } from 'vitest'

import { computeShellLayout } from './layout'

const base = { width: 1280, height: 800, chromeBarHeight: 48 }

describe('computeShellLayout', () => {
  it('fills the window with the shell when no provider is live (startup picker)', () => {
    const { shell, provider } = computeShellLayout({
      ...base,
      hasProvider: false,
      chromeVisible: false,
      htmlFullScreen: false
    })
    expect(shell).toEqual({ x: 0, y: 0, width: 1280, height: 800 })
    expect(provider).toBeNull()
  })

  it('splits chrome bar + provider when a session is live and chrome is visible', () => {
    const { shell, provider } = computeShellLayout({
      ...base,
      hasProvider: true,
      chromeVisible: true,
      htmlFullScreen: false
    })
    expect(shell).toEqual({ x: 0, y: 0, width: 1280, height: 48 })
    expect(provider).toEqual({ x: 0, y: 48, width: 1280, height: 752 })
  })

  it('collapses the shell to zero height with chrome hidden', () => {
    const { shell, provider } = computeShellLayout({
      ...base,
      hasProvider: true,
      chromeVisible: false,
      htmlFullScreen: false
    })
    expect(shell.height).toBe(0)
    expect(provider).toEqual({ x: 0, y: 0, width: 1280, height: 800 })
  })

  it('gives the provider the whole window during HTML fullscreen', () => {
    const { shell, provider } = computeShellLayout({
      ...base,
      hasProvider: true,
      chromeVisible: true,
      htmlFullScreen: true
    })
    expect(shell.height).toBe(0)
    expect(provider).toEqual({ x: 0, y: 0, width: 1280, height: 800 })
  })
})
