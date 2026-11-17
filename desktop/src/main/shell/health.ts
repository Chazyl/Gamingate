import type { WebContents } from 'electron'
import type { HealthSnapshot } from '../../shared/shell-contract'

/**
 * Out-of-process stream-health sampler (SHL-03, 03-RESEARCH "Stream Health
 * Without Touching Provider DOM").
 *
 * The ONLY data path is Chromium's `Media` CDP domain read over
 * `webContents.debugger`; the provider page is never injected into, executed
 * against, or mutated (prohibition / threat T-03-30). The debugger is read-only
 * and exclusive with DevTools, so an attach failure or a later detach degrades
 * to `statsLive: false` — it never throws.
 *
 * `rttMs` and `droppedFrames` are ALWAYS null: CDP Media exposes no compliant
 * source for either (research A4), and the overlay renders the honest em dash
 * rather than an estimate.
 */

/** The UI-SPEC 1000ms cadence: updates are pushed at most once per second. */
export const HEALTH_THROTTLE_MS = 1000

/** The subset of `Media.playerPropertiesChanged` values we understand. */
export interface ParsedMediaProperties {
  resolution?: string
  decoderName?: string
  hardwareDecoder?: boolean
  framerate?: number
  freezingRatio?: number
}

function decodeValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  // CDP Media values arrive JSON-encoded; an unencoded value is used verbatim.
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

/**
 * Pure decoder for a `Media.playerPropertiesChanged` `properties` array.
 * Unknown or malformed entries are ignored; a missing metric is simply absent
 * (never defaulted to 0 / false).
 */
export function parseMediaProperties(properties: unknown): ParsedMediaProperties {
  const out: ParsedMediaProperties = {}
  if (!Array.isArray(properties)) return out
  for (const entry of properties) {
    if (!entry || typeof entry !== 'object') continue
    const name = (entry as { name?: unknown }).name
    if (typeof name !== 'string') continue
    const value = decodeValue((entry as { value?: unknown }).value)
    switch (name) {
      case 'kResolution': {
        const v = asString(value)
        if (v !== null) out.resolution = v
        break
      }
      case 'kVideoDecoderName': {
        const v = asString(value)
        if (v !== null) out.decoderName = v
        break
      }
      case 'kIsPlatformVideoDecoder': {
        const v = asBoolean(value)
        if (v !== null) out.hardwareDecoder = v
        break
      }
      case 'kFramerate': {
        const v = asNumber(value)
        if (v !== null) out.framerate = v
        break
      }
      case 'kVideoPlaybackFreezingRatio': {
        const v = asNumber(value)
        if (v !== null) out.freezingRatio = v
        break
      }
      default:
        break
    }
  }
  return out
}

/** Build the wire snapshot. Unavailable metrics stay null, never 0. */
export function buildHealthSnapshot(
  props: ParsedMediaProperties,
  statsLive: boolean,
  updatedAt: number
): HealthSnapshot {
  return {
    resolution: props.resolution ?? null,
    // No compliant RTT source in v1 (research A4).
    rttMs: null,
    decoderName: props.decoderName ?? null,
    hardwareDecoder: props.hardwareDecoder ?? null,
    framerate: props.framerate ?? null,
    freezingRatio: props.freezingRatio ?? null,
    // No compliant raw dropped-frame source in v1 (research A4).
    droppedFrames: null,
    // Stamped by the engine that owns the session state machine.
    sessionStatus: null,
    statsLive,
    updatedAt
  }
}

/**
 * Attach the read-only CDP Media sampler to a provider webContents. Pushes a
 * snapshot at most once per `HEALTH_THROTTLE_MS`, plus one final snapshot when
 * the debugger detaches. Returns a teardown function; safe to call on a view
 * that never attached.
 */
export function startHealth(
  webContents: WebContents,
  onUpdate: (snapshot: HealthSnapshot) => void,
  now: () => number = Date.now
): () => void {
  const dbg = webContents.debugger
  let live = false
  let props: ParsedMediaProperties = {}
  let timer: ReturnType<typeof setInterval> | null = null
  let disposed = false

  const stopTimer = (): void => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
  const emit = (): void => {
    if (!disposed) onUpdate(buildHealthSnapshot(props, live, now()))
  }
  const onMessage = (_event: unknown, method: string, params: unknown): void => {
    if (method !== 'Media.playerPropertiesChanged') return
    const parsed = parseMediaProperties((params as { properties?: unknown } | null)?.properties)
    props = { ...props, ...parsed }
    live = true
  }
  const onDetach = (): void => {
    // DevTools opened / view closed: stats can no longer be read. Report the
    // honest unavailable state once; do not crash and do not keep polling.
    live = false
    stopTimer()
    emit()
  }

  try {
    dbg.attach('1.3')
  } catch {
    // Another CDP client (DevTools) already owns this view: nothing to sample.
    onUpdate(buildHealthSnapshot({}, false, now()))
    return () => {}
  }

  dbg.on('message', onMessage)
  dbg.once('detach', onDetach)
  const enabled = dbg.sendCommand('Media.enable') as Promise<unknown> | undefined
  if (enabled && typeof enabled.catch === 'function') {
    // The Media domain is experimental; a rejected enable degrades to dashes.
    void enabled.catch(() => {
      live = false
    })
  }
  timer = setInterval(emit, HEALTH_THROTTLE_MS)

  return () => {
    disposed = true
    stopTimer()
    dbg.removeListener('message', onMessage)
    dbg.removeListener('detach', onDetach)
    if (dbg.isAttached()) dbg.detach()
  }
}
