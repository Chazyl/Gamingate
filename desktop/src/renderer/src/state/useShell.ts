import { useCallback, useEffect, useState } from 'react'
import {
  IDLE_SESSION,
  type DecodeState,
  type PlatformSummary,
  type Prefs,
  type PrefsPatch,
  type SessionState
} from '../../../shared/shell-contract'
import { getGamingate } from '../ipc'

/**
 * Shell bridge subscription hook: registry list, session state, local prefs, and
 * the launch/stop/clear/prefs actions. The `SHELL_READY` marker is logged here
 * so the headless `shell-smoke` proves the registry list crossed the trusted
 * bridge (SHL-01).
 */
export interface Shell {
  platforms: PlatformSummary[] | null
  session: SessionState
  prefs: Prefs | null
  /** Engine-owned decode state for the picker badge; null until loaded. */
  decode: DecodeState | null
  error: string | null
  refreshPlatforms: () => Promise<void>
  launch: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  clear: (id: string) => Promise<void>
  updatePrefs: (patch: PrefsPatch) => Promise<void>
}

export function useShell(): Shell {
  const [platforms, setPlatforms] = useState<PlatformSummary[] | null>(null)
  const [session, setSession] = useState<SessionState>(IDLE_SESSION)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [decode, setDecode] = useState<DecodeState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fail = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause))
  }, [])

  const refreshPlatforms = useCallback(async () => {
    try {
      const list = await getGamingate().listPlatforms()
      console.log(`SHELL_READY platforms=${list.length}`)
      setPlatforms(list)
    } catch (cause) {
      fail(cause)
    }
  }, [fail])

  useEffect(() => {
    let cancelled = false
    const api = getGamingate()
    api
      .listPlatforms()
      .then((list) => {
        if (cancelled) return
        console.log(`SHELL_READY platforms=${list.length}`)
        setPlatforms(list)
      })
      .catch(fail)
    api
      .getPrefs()
      .then((loaded) => !cancelled && setPrefs(loaded))
      .catch(fail)
    api
      .sessionState()
      .then((state) => !cancelled && setSession(state))
      .catch(fail)
    // Evidence-based decode state for the picker badge (IM-02): the card must
    // report what the engine holds, never a hardcoded Unknown.
    api
      .getDecodeState()
      .then((state) => !cancelled && setDecode(state))
      .catch(fail)
    const off = api.onSessionState((state) => setSession(state))
    return () => {
      cancelled = true
      off()
    }
  }, [fail])

  const launch = useCallback(
    async (id: string) => {
      setError(null)
      try {
        setSession(await getGamingate().launch(id))
      } catch (cause) {
        fail(cause)
      }
    },
    [fail]
  )

  const stop = useCallback(
    async (id: string) => {
      setError(null)
      try {
        setSession(await getGamingate().stop(id))
      } catch (cause) {
        fail(cause)
      }
    },
    [fail]
  )

  const clear = useCallback(
    async (id: string) => {
      setError(null)
      try {
        await getGamingate().clearProvider(id)
        await refreshPlatforms()
      } catch (cause) {
        fail(cause)
      }
    },
    [fail, refreshPlatforms]
  )

  const updatePrefs = useCallback(
    async (patch: PrefsPatch) => {
      setError(null)
      try {
        setPrefs(await getGamingate().setPrefs(patch))
      } catch (cause) {
        fail(cause)
      }
    },
    [fail]
  )

  return { platforms, session, prefs, decode, error, refreshPlatforms, launch, stop, clear, updatePrefs }
}
