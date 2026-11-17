import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { PlatformSummary } from '../../shared/shell-contract'
import { useShell } from './state/useShell'
import { getGamingate } from './ipc'
import { Button } from './ui/primitives'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { GearIcon } from './icons'
import { PlatformPicker } from './platforms/PlatformPicker'
import { SettingsScreen } from './settings/SettingsScreen'
import { TopChrome } from './session/TopChrome'
import { OverlayPanel } from './health/OverlayPanel'

/**
 * Trusted shell renderer entry. `?surface=overlay` is the transparent overlay
 * child (health/toasts only, built in 03-04); the default surface is the shell,
 * routing between the picker/settings and, while a session is active, the
 * 48px in-session top chrome (the native shell view is resized to it).
 */
function surfaceFromQuery(): 'shell' | 'overlay' {
  return new URLSearchParams(window.location.search).get('surface') === 'overlay'
    ? 'overlay'
    : 'shell'
}

export function App(): ReactElement {
  if (surfaceFromQuery() === 'overlay') {
    return <OverlayPanel />
  }
  return <Shell />
}

/** UI-SPEC chord-blocked copy: "{chord} blocked — use Stop to end the session." */
function chordBlockedMessage(label: string): string {
  return `${label} blocked — use Stop to end the session.`
}

/**
 * First-session hint sequence (UI-SPEC Surface 2): fullscreen, pointer-lock
 * release, and the overlay chord, so the user is never trapped. Played once
 * ever, gated on the durable `hintsSeen` pref.
 */
const FIRST_SESSION_HINTS = [
  'F11 toggles fullscreen.',
  'Click to capture mouse — Esc releases.',
  'Ctrl+Shift+S shows stream health.'
] as const
const HINT_INTERVAL_MS = 2500

function Shell(): ReactElement {
  const shell = useShell()
  const { updatePrefs } = shell
  const [view, setView] = useState<'picker' | 'settings'>('picker')
  const [pendingClear, setPendingClear] = useState<PlatformSummary | null>(null)
  const [chordToast, setChordToast] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  // The blocker push is main -> shell only; every block must surface a toast,
  // never be silently suppressed (INP-03, threat T-03-20).
  useEffect(() => {
    return getGamingate().onChordBlocked((label) => setChordToast(chordBlockedMessage(label)))
  }, [])

  useEffect(() => {
    if (!chordToast) return
    const timer = setTimeout(() => setChordToast(null), HINT_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [chordToast])

  const activeId = shell.session.platformId
  const active = shell.session.status === 'starting' || shell.session.status === 'running'
  const hintsPending = shell.prefs !== null && !shell.prefs.hintsSeen

  useEffect(() => {
    if (!active || !hintsPending) return
    let index = 0
    setHint(FIRST_SESSION_HINTS[0])
    const timer = setInterval(() => {
      index += 1
      if (index < FIRST_SESSION_HINTS.length) setHint(FIRST_SESSION_HINTS[index])
      else {
        clearInterval(timer)
        setHint(null)
        void updatePrefs({ hintsSeen: true })
      }
    }, HINT_INTERVAL_MS)
    return () => {
      clearInterval(timer)
      setHint(null)
    }
  }, [active, hintsPending, updatePrefs])

  const confirmClear = (): void => {
    if (pendingClear) void shell.clear(pendingClear.id)
    setPendingClear(null)
  }

  const activeName =
    shell.platforms?.find((platform) => platform.id === activeId)?.name ?? activeId ?? 'Session'

  if (active) {
    return (
      <div className="og-shell og-shell--session">
        <TopChrome
          platformName={activeName}
          notice={chordToast ?? hint}
          onStop={() => activeId && void shell.stop(activeId)}
        />
      </div>
    )
  }

  return (
    <div className="og-shell">
      <header className="og-header">
        <h1 className="og-header__title">Gamingate</h1>
        <Button
          variant="ghost"
          className="og-btn--icon"
          aria-label="Settings"
          onClick={() => setView(view === 'settings' ? 'picker' : 'settings')}
        >
          <GearIcon />
        </Button>
      </header>
      <main className="og-content">
        {view === 'settings' ? (
          <SettingsScreen
            platforms={shell.platforms ?? []}
            prefs={shell.prefs}
            onRequestClear={(platform) => setPendingClear(platform)}
            onBack={() => setView('picker')}
            sessionLive={active}
          />
        ) : (
          <PlatformPicker
            platforms={shell.platforms}
            session={shell.session}
            decode={shell.decode}
            globalError={shell.error}
            onLaunch={(id) => void shell.launch(id)}
            onStop={(id) => void shell.stop(id)}
            onRequestClear={(platform) => setPendingClear(platform)}
          />
        )}
      </main>
      <ConfirmDialog
        open={pendingClear !== null}
        title="Clear data"
        body={
          pendingClear
            ? `Clear data for ${pendingClear.name}? You'll need to sign in again. Saved games are not affected.`
            : ''
        }
        confirmLabel="Clear data"
        destructive
        onConfirm={confirmClear}
        onCancel={() => setPendingClear(null)}
      />
    </div>
  )
}
