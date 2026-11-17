import type { WebContents } from 'electron'

/**
 * Gaming-mode chord blocker (INP-03, 03-RESEARCH "Gaming-Mode Chord Blocker").
 *
 * `resolveChord` is a PURE mapping from a Chromium input event + the
 * session-running flag to a discriminated action; `attachChordBlocker` wires it
 * to a provider view's `before-input-event`. Only block/fullscreen/overlay
 * actions call `preventDefault`; the engine surfaces every block as a toast so
 * nothing is silently suppressed. Esc, clipboard, and accessibility keys are
 * never matched, so pointer-lock release always works (threat T-03-20).
 *
 * Chords are scoped to the provider webContents while running — never a global
 * `globalShortcut` (prohibition: registration is view-local only).
 */
export interface ChordInput {
  type: string
  key: string
  control?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
}

export type ChordAction =
  | { kind: 'block'; label: string }
  | { kind: 'fullscreen' }
  | { kind: 'overlay' }
  | { kind: 'pass' }

export interface ChordBlockerDeps {
  isRunning: () => boolean
  onBlock: (label: string) => void
  onFullscreen: () => void
  onOverlay: () => void
}

export function resolveChord(input: ChordInput, running: boolean): ChordAction {
  // Pass straight through outside a running session (picker/settings own the
  // keyboard) and on anything but a fresh keyDown (keyUp/char/rawKeyDown), so a
  // chord cannot double-fire on its paired keyUp.
  if (!running || input.type !== 'keyDown') return { kind: 'pass' }

  const lower = input.key.toLowerCase()
  const mod = Boolean(input.control || input.meta)
  const shift = Boolean(input.shift)

  if (input.key === 'F11') return { kind: 'fullscreen' }
  if (mod && shift && lower === 's') return { kind: 'overlay' }
  if (input.key === 'F5') return { kind: 'block', label: 'F5' }
  if (mod && lower === 'r') return { kind: 'block', label: shift ? 'Ctrl+Shift+R' : 'Ctrl+R' }
  if (mod && lower === 'w') return { kind: 'block', label: 'Ctrl+W' }
  if (input.key === 'F12') return { kind: 'block', label: 'DevTools shortcut' }
  if (mod && shift && (lower === 'i' || lower === 'j' || lower === 'c')) {
    return { kind: 'block', label: 'DevTools shortcut' }
  }
  // Esc, clipboard (Ctrl/Cmd+C/V/X/A), and everything else pass through.
  return { kind: 'pass' }
}

/**
 * Attach the blocker to a provider webContents. Returns a detach function so
 * the engine can drop the listener when the session ends.
 */
export function attachChordBlocker(
  webContents: WebContents,
  deps: ChordBlockerDeps
): () => void {
  const handler = (event: { preventDefault: () => void }, input: ChordInput): void => {
    const action = resolveChord(input, deps.isRunning())
    if (action.kind === 'pass') return
    event.preventDefault()
    if (action.kind === 'block') deps.onBlock(action.label)
    else if (action.kind === 'fullscreen') deps.onFullscreen()
    else deps.onOverlay()
  }
  webContents.on('before-input-event', handler)
  return () => webContents.removeListener('before-input-event', handler)
}
