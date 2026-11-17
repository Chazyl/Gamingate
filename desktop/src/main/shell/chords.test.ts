import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { attachChordBlocker, resolveChord, type ChordInput } from './chords'

/**
 * Gaming-mode chord policy (INP-03, threat T-03-20).
 *
 * The policy is a PURE mapping so the "never block Esc / only while running /
 * keyDown only" invariants are provable without Electron. Every block must map
 * to a labelled action the engine turns into a toast (never silent).
 */

function input(over: Partial<ChordInput>): ChordInput {
  return { type: 'keyDown', key: '', ...over }
}

describe('resolveChord', () => {
  it('blocks F5 / Ctrl+R / Ctrl+Shift+R / Ctrl+W while running', () => {
    expect(resolveChord(input({ key: 'F5' }), true)).toEqual({ kind: 'block', label: 'F5' })
    expect(resolveChord(input({ key: 'r', control: true }), true)).toEqual({
      kind: 'block',
      label: 'Ctrl+R'
    })
    expect(resolveChord(input({ key: 'R', control: true, shift: true }), true)).toEqual({
      kind: 'block',
      label: 'Ctrl+Shift+R'
    })
    expect(resolveChord(input({ key: 'w', control: true }), true)).toEqual({
      kind: 'block',
      label: 'Ctrl+W'
    })
  })

  it('labels the Meta modifier chords the same (mac Cmd)', () => {
    expect(resolveChord(input({ key: 'w', meta: true }), true)).toEqual({
      kind: 'block',
      label: 'Ctrl+W'
    })
  })

  it('blocks devtools chords (Ctrl/Cmd+Shift+I/J/C and F12)', () => {
    for (const key of ['i', 'j', 'c']) {
      expect(resolveChord(input({ key, control: true, shift: true }), true)).toEqual({
        kind: 'block',
        label: 'DevTools shortcut'
      })
    }
    expect(resolveChord(input({ key: 'F12' }), true)).toEqual({
      kind: 'block',
      label: 'DevTools shortcut'
    })
  })

  it('maps F11 to fullscreen and Ctrl+Shift+S to the overlay', () => {
    expect(resolveChord(input({ key: 'F11' }), true)).toEqual({ kind: 'fullscreen' })
    expect(resolveChord(input({ key: 'S', control: true, shift: true }), true)).toEqual({
      kind: 'overlay'
    })
  })

  it('NEVER blocks Esc (pointer-lock release must always work)', () => {
    expect(resolveChord(input({ key: 'Escape' }), true)).toEqual({ kind: 'pass' })
  })

  it('never blocks clipboard keys', () => {
    expect(resolveChord(input({ key: 'c', control: true }), true)).toEqual({ kind: 'pass' })
    expect(resolveChord(input({ key: 'v', control: true }), true)).toEqual({ kind: 'pass' })
    expect(resolveChord(input({ key: 'x', control: true }), true)).toEqual({ kind: 'pass' })
    expect(resolveChord(input({ key: 'a', control: true }), true)).toEqual({ kind: 'pass' })
  })

  it('passes every chord when no session is running', () => {
    expect(resolveChord(input({ key: 'F5' }), false)).toEqual({ kind: 'pass' })
    expect(resolveChord(input({ key: 'w', control: true }), false)).toEqual({ kind: 'pass' })
    expect(resolveChord(input({ key: 'F11' }), false)).toEqual({ kind: 'pass' })
  })

  it('handles only fresh keyDown events (no keyUp double-fire)', () => {
    expect(resolveChord(input({ key: 'F5', type: 'keyUp' }), true)).toEqual({ kind: 'pass' })
    expect(resolveChord(input({ key: 'w', control: true, type: 'char' }), true)).toEqual({
      kind: 'pass'
    })
  })

  it('passes ordinary gameplay keys through', () => {
    expect(resolveChord(input({ key: 'a' }), true)).toEqual({ kind: 'pass' })
    expect(resolveChord(input({ key: 'Enter' }), true)).toEqual({ kind: 'pass' })
  })
})

describe('attachChordBlocker', () => {
  function fakeWebContents(): EventEmitter & { removeListener: EventEmitter['removeListener'] } {
    return new EventEmitter()
  }

  it('prevents default and reports a block for a blocked chord', () => {
    const wc = fakeWebContents()
    const deps = {
      isRunning: () => true,
      onBlock: vi.fn(),
      onFullscreen: vi.fn(),
      onOverlay: vi.fn()
    }
    attachChordBlocker(wc as unknown as WebContents, deps)

    const event = { preventDefault: vi.fn() }
    wc.emit('before-input-event', event, input({ key: 'w', control: true }))

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(deps.onBlock).toHaveBeenCalledWith('Ctrl+W')
    expect(deps.onFullscreen).not.toHaveBeenCalled()
  })

  it('does not preventDefault a pass-through and stops listening after detach', () => {
    const wc = fakeWebContents()
    const deps = {
      isRunning: () => true,
      onBlock: vi.fn(),
      onFullscreen: vi.fn(),
      onOverlay: vi.fn()
    }
    const detach = attachChordBlocker(wc as unknown as WebContents, deps)

    const pass = { preventDefault: vi.fn() }
    wc.emit('before-input-event', pass, input({ key: 'Escape' }))
    expect(pass.preventDefault).not.toHaveBeenCalled()

    const blocked = { preventDefault: vi.fn() }
    wc.emit('before-input-event', blocked, input({ key: 'F5' }))
    expect(deps.onBlock).toHaveBeenCalledTimes(1)

    detach()
    wc.emit('before-input-event', blocked, input({ key: 'F5' }))
    expect(deps.onBlock).toHaveBeenCalledTimes(1)
  })

  it('routes F11 to fullscreen and Ctrl+Shift+S to the overlay', () => {
    const wc = fakeWebContents()
    const deps = {
      isRunning: () => true,
      onBlock: vi.fn(),
      onFullscreen: vi.fn(),
      onOverlay: vi.fn()
    }
    attachChordBlocker(wc as unknown as WebContents, deps)

    wc.emit('before-input-event', { preventDefault: vi.fn() }, input({ key: 'F11' }))
    wc.emit(
      'before-input-event',
      { preventDefault: vi.fn() },
      input({ key: 's', control: true, shift: true })
    )
    expect(deps.onFullscreen).toHaveBeenCalledOnce()
    expect(deps.onOverlay).toHaveBeenCalledOnce()
  })
})
