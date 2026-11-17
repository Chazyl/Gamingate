import { app, components } from 'electron'
import type { ComponentStatus } from 'electron'
import { autoUpdater } from 'electron-updater'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { readRegistrySync } from './registry/platforms'
import {
  resolvePreReady,
  probeDecodeBackend,
  persistDecision,
  getDecodeState,
  type DecodeMode,
  type DecodeState
} from './decode/capability'
import {
  applyDecodeRestart,
  consumeDecodeRestartMarker,
  DECODE_RESTART_FLAG,
  requestRelaunch
} from './shell/restart'
import { writePrefs, codecForcePatch } from './shell/prefs'
import {
  sessionFor,
  configureSession,
  engineSessions,
  flushPersistentSessions
} from './session/session-manager'
import { createPlatformView } from './view/view-manager'
import { createShellWindow } from './shell/window'
import { createEngine } from './shell/engine'
import { registerShellIpc, registerShellView } from './shell/ipc'
import { isTrustedDocument } from './shell/trusted-url'
import { redactUrl } from './shell/redact'
import { applyInputThrottlingFlags } from './shell/input-flags'
import type { PlatformPacket, Registry } from '../shared/types'
import type { SetCodecForceArgs } from '../shared/shell-contract'

// PERF-02: monotonic process-start stamp for the dev-only `--cold-start` lane.
// Captured at module load (before app ready and CLI parsing) so the measured
// elapsed time is process-start -> first forwarded SHELL_READY.
const processStartNs = process.hrtime.bigint()

/**
 * Project Gamingate - gateway engine main process (registry-driven, D-01).
 *
 * Startup order (load-bearing):
 *   module scope: app.setPath('userData', dir)          (before ready)
 *   pre-ready:    readRegistrySync()  -> fail closed, non-zero, no view
 *   pre-ready:    decode decision -> app.disableHardwareAcceleration() if software
 *   app.whenReady() -> components.whenReady() (CDM gate, unchanged) -> probe decode
 *   post-ready:   sessionFor(packet) -> configureSession -> createPlatformView -> loadURL
 *
 * The registry-driven engine path is the ONLY engine path: `--platform=<id>`
 * selects a packet (defaults to the first). `--capture=<dir>` writes headless
 * evidence and exits (container smoke harness); `--keep-open` instead keeps the
 * window open with a ready marker so a human can sign in, with no auto-exit.
 */

// Linux first-install flow marker (RESEARCH.md Pitfall 1): the CDM downloads on
// the first launch but only loads on the next one, so we relaunch exactly once.
const CDM_RESTART_FLAG = '--cdm-restarted'

function argValue(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1)
}

// True only when electron-builder generated a real update feed at release time.
// Absent feed (local/dev build) or the `.invalid` placeholder → false, so the
// updater never runs and never makes a phantom network call.
function updateFeedConfigured(): boolean {
  try {
    const yml = readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const url = yml.match(/^\s*url:\s*(\S+)/m)?.[1] ?? ''
    return url.startsWith('https://') && !url.includes('.invalid')
  } catch {
    return false
  }
}

// Persistent session storage. --user-data points userData at a mounted volume so
// a ONE-TIME sign-in survives container rebuilds; MUST run before app ready.
const userDataDir = argValue('--user-data')
if (userDataDir) {
  app.setPath('userData', userDataDir)
}

// --- Pre-ready: registry (fail closed) -------------------------------------
function loadRegistryOrExit(): Registry {
  try {
    const registry = readRegistrySync()
    console.log(
      `REGISTRY_LOADED schemaVersion=${registry.schemaVersion} platforms=${registry.platforms.length}`
    )
    return registry
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('REGISTRY_INVALID:', message)
    // Exit non-zero before app ready so no view can ever exist (REG-01 SC1).
    process.exit(2)
  }
}

const registry = loadRegistryOrExit()

function selectedPacket(): PlatformPacket {
  const id = argValue('--platform')
  const packet = id ? registry.platforms.find((p) => p.id === id) : registry.platforms[0]
  if (!packet) {
    console.error(`REGISTRY_INVALID: unknown platform id '${id}'`)
    process.exit(2)
  }
  return packet
}

// --- Pre-ready: decode decision --------------------------------------------
const decodePref: DecodeMode = (() => {
  const value = argValue('--decode-mode')
  return value === 'hardware' || value === 'software' ? value : 'auto'
})()

const preReadyDecode: DecodeState = resolvePreReady(decodePref)
if (preReadyDecode.mode === 'software') {
  app.disableHardwareAcceleration()
  console.log('DECODE_PRE_READY software hw-accel-disabled')
} else {
  console.log(`DECODE_PRE_READY ${preReadyDecode.mode} source=${preReadyDecode.source}`)
}

// Loop guard (T-03-40): delete any restart marker left by a prior relaunch so a
// stale marker can never re-trigger a relaunch on this boot.
const restartMarker = consumeDecodeRestartMarker(app.getPath('userData'))
if (restartMarker.consumed) console.log('DECODE_RESTART_MARKER_CONSUMED')

// Dev-only lane: print the resolved pre-ready decode state and exit, so the
// two-launch smoke can prove the persisted mode applied BEFORE ready.
if (process.argv.includes('--print-decode-state')) {
  console.log(`DECODE_STATE ${JSON.stringify(preReadyDecode)}`)
  process.exit(0)
}

// --- Pre-ready: input-throughput flags (PERF-03) ---------------------------
// Process-lifetime switches: they MUST be applied before app.whenReady()
// resolves so the ~250Hz gamepad source is never throttled below 120Hz while a
// session is focused. The per-view complement is backgroundThrottling:false.
applyInputThrottlingFlags(app.commandLine)

// --- Pre-ready: GPU-process sandbox compatibility (VM/container) ------------
// On VMs, containers, and AppArmor-restricted hosts (e.g. Ubuntu 24.04 with
// `apparmor_restrict_unprivileged_userns=1`) the GPU-process sandbox cannot
// initialize, and Chromium aborts the whole app:
//   FATAL: gpu_data_manager_impl_private.cc  GPU process isn't usable. Goodbye.
// This is independent of hardware acceleration (it happens even with software
// decode). Disabling ONLY the GPU-process sandbox lets the GPU/software-
// compositing process come up, while the renderer sandbox — the primary
// security boundary — stays enabled. Opt out with GAMINGATE_GPU_SANDBOX=1 on
// bare-metal hosts where the GPU sandbox works.
if (process.env['GAMINGATE_GPU_SANDBOX'] !== '1') {
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}


function linuxNeedsCdmRestart(widevine: ComponentStatus | undefined): boolean {
  return (
    process.platform === 'linux' &&
    // Relaunch ONLY on a genuine first install, when the CDM component is truly
    // absent. On Linux the component status is "new"/"updated" (never
    // "installed") once it is present and usable, so keying on "installed"
    // relaunched on EVERY launch — the parent exited immediately and, under a
    // desktop launcher, the app appeared not to start at all.
    widevine === undefined &&
    !process.argv.includes(CDM_RESTART_FLAG) &&
    !process.argv.includes('--no-relaunch')
  )
}

// --- Dev-only persistence probe lane (engine-smoke.sh persist) --------------
// Writes or reads a SYNTHETIC, engine-named cookie in the packet partition to
// prove the flush-on-quit round-trip under a mounted --user-data dir. The lane
// only runs with `--persist-probe=<write|check>`; it asserts cookie PRESENCE
// only and never logs or inspects real cookie content (privacy prohibition).
const PERSIST_PROBE_COOKIE = 'gamingate-persist-probe'

async function runPersistProbe(packet: PlatformPacket, mode: 'write' | 'check'): Promise<void> {
  const ses = sessionFor(packet)
  if (mode === 'write') {
    await ses.cookies.set({
      url: packet.allowedOrigins[0],
      name: PERSIST_PROBE_COOKIE,
      value: 'probe',
      // Non-session cookie: persists across a relaunch.
      expirationDate: Date.now() / 1000 + 3600
    })
    console.log('PERSIST_PROBE_WRITTEN')
  } else {
    const found = await ses.cookies.get({ name: PERSIST_PROBE_COOKIE })
    if (found.length === 0) {
      console.error('PERSIST_PROBE_MISSING')
      app.exit(1)
      return
    }
    console.log('PERSIST_PROBE_PRESENT')
  }
  // Fast quit: the before-quit handler must flush before the process exits.
  app.quit()
}

// --- Engine path (registry-driven) -----------------------------------------
function runEngine(
  packet: PlatformPacket,
  captureDir: string | undefined,
  keepOpen: boolean
): void {
  const ses = sessionFor(packet)
  configureSession(ses, packet)
  const { view } = createPlatformView(packet, join(__dirname, '../preload/index.js'))

  let httpResponseCode: number | null = null
  let didFinishLoad = false
  let didFailLoad = false
  let errorDescription: string | null = null
  let settled = false
  // Main-world probe of the platform spoof (evidence only).
  let platformSpoofProbe: unknown = null

  const finish = (exitCode: number): void => {
    if (settled) return
    settled = true
    if (timeout) clearTimeout(timeout)
    if (!captureDir) {
      app.exit(exitCode)
      return
    }
    const evidence = {
      platform: packet.id,
      entryUrl: packet.entryUrl,
      finalUrl: view.webContents.getURL(),
      httpResponseCode,
      didFinishLoad,
      didFailLoad,
      errorDescription,
      decode: preReadyDecode,
      platformSpoofProbe
    }
    void writeFile(
      join(captureDir, `engine-${packet.id}.json`),
      JSON.stringify(evidence, null, 2)
    ).then(() => {
      console.log(`ENGINE_EVIDENCE ${join(captureDir, `engine-${packet.id}.json`)}`)
      app.exit(exitCode)
    })
  }

  // Hard ceiling so a hung navigation can never wedge the container smoke.
  // Interactive (keep-open) mode has no ceiling: the window stays open for a
  // human to sign in and is closed by the human, not a timer.
  const timeout = keepOpen
    ? null
    : setTimeout(() => {
        errorDescription = errorDescription ?? 'navigation timeout'
        finish(1)
      }, 60000)

  view.webContents.on('did-navigate', (_event, _url, code) => {
    if (typeof code === 'number') httpResponseCode = code
  })
  view.webContents.on('did-fail-load', (_event, _code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    didFailLoad = true
    errorDescription = `${description} (${redactUrl(validatedURL)})`
    // Interactive mode must not auto-exit on a failed load: a human can retry
    // or sign in. The capture/smoke path keeps its timeout-ceiling behavior.
    if (keepOpen) {
      console.error(`KEEP_OPEN_FAILED url=${redactUrl(validatedURL)} reason=${description}`)
    }
  })
  view.webContents.on('did-finish-load', () => {
    didFinishLoad = true
    if (keepOpen) {
      // Stable ready marker: the window is loaded and stays open for sign-in.
      console.log(`KEEP_OPEN_READY url=${redactUrl(view.webContents.getURL())}`)
      return
    }
    // Read the platform the provider page actually sees (main world), so the
    // engine smoke can assert the packet's spoof was applied.
    const probe = `JSON.stringify({
      navigatorPlatform: navigator.platform || null,
      uaDataPlatform: navigator.userAgentData ? navigator.userAgentData.platform || null : null
    })`
    void view.webContents
      .executeJavaScript(probe)
      .then((raw: unknown) => {
        if (typeof raw === 'string') {
          try {
            platformSpoofProbe = JSON.parse(raw)
          } catch {
            platformSpoofProbe = null
          }
        }
      })
      .catch(() => {
        platformSpoofProbe = null
      })
      .finally(() => finish(0))
  })
}

// --- Shell lane (SHL-01): trusted multi-view shell + trusted IPC -------------
/**
 * Start the interactive shell (the default lane when neither `--capture` nor
 * `--keep-open` is set). Composes the trusted React shell view, the inert
 * provider view, and the read-only overlay on ONE BaseWindow, registers the
 * trusted IPC allowlist, and — under `--shell-smoke` — loads the registry list
 * over that bridge, logs SHELL_READY, and exits non-zero on timeout.
 */
function runShell(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  const rendererUrl = devUrl ?? `file://${join(__dirname, '../renderer/index.html')}`

  const shellWindow = createShellWindow({
    shellPreloadPath: join(__dirname, '../preload/shell.js'),
    providerPreloadPath: join(__dirname, '../preload/index.js'),
    rendererUrl
  })

  const trustedShellWc = shellWindow.shellView.webContents
  const broadcast = (channel: string, payload: unknown): void => {
    if (!trustedShellWc.isDestroyed()) trustedShellWc.send(channel, payload)
    const overlay = shellWindow.overlayView
    if (overlay && !overlay.webContents.isDestroyed()) overlay.webContents.send(channel, payload)
  }

  const engine = createEngine({
    registry,
    shellWindow,
    broadcast,
    prefsDir: app.getPath('userData')
  })

  // Sleep must never outlive the app (SHL-04 threat T-03-32): release on quit.
  app.once('will-quit', () => engine.releaseSleep())

  // The shell identity for the IPC allowlist is only known once the trusted
  // renderer has loaded its own URL. Compare the FULL document (not an origin):
  // the built shell is `file://`, whose origin is the opaque 'null' (IM-03).
  registerShellView(trustedShellWc, rendererUrl)
  trustedShellWc.on('will-navigate', (event, url) => {
    if (!isTrustedDocument(url, rendererUrl)) event.preventDefault()
  })

  registerShellIpc({
    registry,
    listPlatforms: engine.listPlatforms,
    launch: engine.launch,
    stop: engine.stop,
    sessionState: engine.sessionState,
    setOverlay: engine.setOverlay,
    getPrefs: engine.getPrefs,
    setPrefs: engine.setPrefs,
    getDecodeState: () => getDecodeState(),
    // A real decode-mode change: persist + relaunch (pre-ready on next boot).
    setDecodeMode: (mode) => applyDecodeRestart(app, app.getPath('userData'), mode),
    // Codec force is a persisted provider-dependent hint, applied on relaunch.
    setCodecForce: (args: SetCodecForceArgs) => {
      writePrefs(app.getPath('userData'), codecForcePatch(args.platformId, args.codecForce))
      return requestRelaunch(app, app.getPath('userData'))
    }
  })

  // Headless proof lane: the shell renderer must reach the TRUSTED BRIDGE and
  // read the registry list over it (not read main-side). The renderer logs a
  // `SHELL_READY` console marker once `window.gamingate.listPlatforms()` resolves;
  // main forwards that console message so the harness can assert it. Exits
  // non-zero on timeout.
  //
  // PERF-02: under `--cold-start` the same forwarded marker is the stopwatch —
  // main prints `COLD_START_MS=<n> shell` (process-start -> SHELL_READY) and then
  // exits 0. This is the reusable marker path; no new IPC/preload/renderer code.
  const coldStart = process.argv.includes('--cold-start')
  if (process.argv.includes('--shell-smoke') || coldStart) {
    const timeout = setTimeout(() => {
      console.error(coldStart ? 'COLD_START_TIMEOUT' : 'SHELL_SMOKE_TIMEOUT')
      app.exit(1)
    }, 60000)
    trustedShellWc.on('console-message', (event) => {
      const message = (event as unknown as { message?: string }).message ?? ''
      if (message.includes('SHELL_READY')) {
        console.log(message)
        if (coldStart) {
          const elapsedMs = Math.round(Number(process.hrtime.bigint() - processStartNs) / 1e6)
          console.log(`COLD_START_MS=${elapsedMs} shell`)
        }
        clearTimeout(timeout)
        setTimeout(() => app.exit(0), 50)
      }
    })
  }
}

app.whenReady().then(async () => {
  // Dev-only decode lane: `--set-decode-mode=<mode>` persists the decision and
  // relaunches so the next boot applies it pre-ready. Under `--no-relaunch` (or
  // when the restart flag is already present) it persists and exits without a
  // relaunch — the two-launch smoke drives exactly this.
  const setMode = argValue('--set-decode-mode')
  if (setMode === 'auto' || setMode === 'hardware' || setMode === 'software') {
    if (process.argv.includes(DECODE_RESTART_FLAG)) {
      console.log('DECODE_RESTART_APPLIED', setMode)
    } else {
      const outcome = applyDecodeRestart(app, app.getPath('userData'), setMode)
      if (outcome.relaunched) return
      console.log('DECODE_SET_PERSISTED', setMode, outcome.error ?? '')
      app.exit(0)
      return
    }
  }

  await components.whenReady()

  const status = components.status()
  const widevineId = components.WIDEVINE_CDM_ID
  const widevine = status[widevineId]

  console.log('components.updatesEnabled:', components.updatesEnabled)
  console.log('components.status:', JSON.stringify(status))
  console.log('WIDEVINE_CDM_ID:', widevineId, '->', JSON.stringify(widevine))

  if (linuxNeedsCdmRestart(widevine)) {
    console.log('CDM not installed on cold launch; relaunching once for Linux first-install')
    app.relaunch({ args: process.argv.slice(1).concat(CDM_RESTART_FLAG) })
    app.exit(0)
    return
  }

  if (components.updatesEnabled !== true) {
    console.error('component updates are disabled; a freshly installed CDM may not load')
  }
  if (widevine?.status !== 'installed') {
    console.error(
      'Widevine CDM state:',
      widevine?.status ?? 'absent',
      '- playback cannot proceed on this run'
    )
  }

  // Auto-update (PKG-01): packaged builds with a REAL, configured feed only.
  // electron-builder generates resources/app-update.yml from its `publish` block
  // at release time. A local/unsigned build has no feed (or a placeholder), so
  // this is a silent no-op — a packaged app must not make phantom DNS/network
  // calls when updates were never configured (Linux packaging norm).
  if (app.isPackaged && updateFeedConfigured()) {
    autoUpdater.on('error', (err) => {
      console.error('UPDATER_ERROR', err instanceof Error ? err.message : String(err))
    })
    void autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.error('UPDATER_CHECK_FAILED', err instanceof Error ? err.message : String(err))
    })
  }

  // Dev-only persistence round-trip lane (engine-smoke.sh persist).
  const persistProbe = argValue('--persist-probe')
  if (persistProbe === 'write' || persistProbe === 'check') {
    await runPersistProbe(selectedPacket(), persistProbe)
    return
  }

  // Warm-up pass: install the CDM and exit so the driver can relaunch cleanly.
  if (process.argv.includes('--exit-after-ready')) {
    app.quit()
    return
  }

  // One representative decode probe, after ready, only on first run.
  if (preReadyDecode.source === 'default') {
    const probed = probeDecodeBackend()
    const finalState: DecodeState = {
      ...probed,
      probedAt: new Date().toISOString(),
      source: 'probe'
    }
    persistDecision(finalState)
    console.log('DECODE_PROBED', JSON.stringify(finalState))
  } else {
    console.log('DECODE_STATE', JSON.stringify(preReadyDecode))
  }

  // The registry-driven engine path is the only engine path. `--platform=<id>`
  // selects a packet (defaults to the first); `--keep-open` keeps the window
  // open for an interactive sign-in instead of exiting after capture. With
  // neither flag (or under `--shell-smoke`) we start the trusted shell lane.
  const captureDir = argValue('--capture')
  const keepOpen = process.argv.includes('--keep-open')
  if (captureDir || keepOpen) {
    runEngine(selectedPacket(), captureDir, keepOpen)
  } else {
    runShell()
  }
})

// --- Bounded flush-on-quit (EMB-02, fast-quit gap) --------------------------
// preventDefault once behind a re-entry guard, await the bounded flush over the
// engine-owned persistent sessions, then app.quit() in a finally so a rejecting
// or slow flush can never leave the app hung in prevented-quit.
let flushingOnQuit = false
app.on('before-quit', (event) => {
  if (flushingOnQuit) return
  const sessions = engineSessions()
  if (sessions.length === 0) return
  event.preventDefault()
  flushingOnQuit = true
  void flushPersistentSessions(sessions).finally(() => {
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
