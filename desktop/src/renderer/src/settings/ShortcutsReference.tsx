import type { ReactElement } from 'react'

/**
 * Shortcuts reference (UI-SPEC Surface 3, INP-03). Lists every chord the
 * gaming-mode blocker intercepts while a session is running AND every shortcut
 * that remains available, including that gamepad does NOT navigate the shell in
 * v1 (SHL-07 deferred) so users are not surprised.
 */
interface Shortcut {
  keys: string
  effect: string
}

const BLOCKED: Shortcut[] = [
  { keys: 'F5', effect: 'Reload blocked — the session keeps playing.' },
  { keys: 'Ctrl/Cmd+R', effect: 'Reload blocked, including Ctrl/Cmd+Shift+R.' },
  { keys: 'Ctrl/Cmd+W', effect: 'Window close blocked — use Stop to end the session.' },
  { keys: 'Ctrl/Cmd+Shift+I / J / C, F12', effect: 'DevTools chords blocked while playing.' }
]

const AVAILABLE: Shortcut[] = [
  { keys: 'F11', effect: 'Toggle fullscreen.' },
  { keys: 'Ctrl/Cmd+Shift+S', effect: 'Show or hide stream health.' },
  { keys: 'Esc', effect: 'Release the mouse (pointer lock).' },
  { keys: 'Click', effect: 'Capture the mouse for camera control.' },
  { keys: 'Ctrl/Cmd+C / V / X / A', effect: 'Clipboard keys always pass through.' },
  { keys: 'DevTools', effect: 'Open via the developer menu/flag — opening it stops health sampling.' }
]

function ShortcutList({ items }: { items: Shortcut[] }): ReactElement {
  return (
    <ul className="og-shortcuts">
      {items.map((item) => (
        <li key={item.keys} className="og-shortcuts__item">
          <kbd className="og-kbd">{item.keys}</kbd>
          <span className="og-shortcuts__effect">{item.effect}</span>
        </li>
      ))}
    </ul>
  )
}

export function ShortcutsReference(): ReactElement {
  return (
    <section className="og-section" aria-labelledby="og-shortcuts-title">
      <h2 id="og-shortcuts-title" className="og-section__title">
        Shortcuts
      </h2>

      <h3 className="og-shortcuts__heading">Blocked while a session is running</h3>
      <ShortcutList items={BLOCKED} />

      <h3 className="og-shortcuts__heading">Always available</h3>
      <ShortcutList items={AVAILABLE} />

      <p className="og-shortcuts__note">
        A gamepad does not navigate the shell in v1 — it controls the game only. Shell gamepad
        navigation is planned for a later version.
      </p>
    </section>
  )
}
