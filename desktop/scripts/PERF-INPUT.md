# PERF-INPUT — gamepad timestamp-freshness protocol (dev-only, host human-check)

Proves **PERF-03**: the input pipeline is not throttled below 120 Hz in-session.
This is a **host human-check**, not a CI assertion — the headless container has
no display and no controller, so the container lane can only prove the throttling
switches and the focus wiring (see `03-03-SUMMARY.md`, `shell-test`).

## Why timestamp freshness, not frame counting

Chromium's browser-side gamepad state provider polls at ~250 Hz (4 ms interval);
the page reads the latest snapshot from a shared buffer. A synthetic
frame-rate/`requestAnimationFrame` count therefore measures the display refresh
(typically 60 Hz), **not** the input pipeline. The valid measure is the delta
between successive `Gamepad.timestamp` values while the session view is focused.

## Prerequisites

- A display-capable host (Windows or Linux AppImage) with a physical controller.
- A running Gamingate session (Launch a provider; the provider holds focus).
- Keep the window focused and foregrounded for the whole run.

## Procedure

1. Launch a session and wait for it to reach `running`.
2. Open the dev-only harness `desktop/scripts/gamepad-harness.html`
   (e.g. in the same app's DevTools console-free page, or any Chromium instance
   on the host — the harness only observes the OS-visible gamepad).
3. Press a controller button so the gamepad appears, then move both sticks/trigger
   continuously for ~10 seconds so samples accumulate.
4. Read the reported `p50` (median) inter-update interval and the inferred rate.

## Acceptance bar

| Metric | Bar | Meaning |
|--------|-----|---------|
| median inter-update interval | **≤ ~8 ms** | ≥125 Hz at the source, i.e. not throttled below 120 Hz |
| inferred rate | **≥ 125 Hz** | derived as `1000 / p50` |

The harness prints `median: N.NN ms` and colors it green at/below the bar.

## Recording

Record the run in the phase evidence (host, date, controller, p50, inferred rate,
and `chrome://gpu` decode state) alongside the PERF-DECODE record from 03-04.
`PERF-03` is satisfied when the median is ≤ ~8 ms while focused.

## Scope note

The harness is **dev/CI tooling only** — it lives under `scripts/`, is never
imported by app code, and is never shipped in the bundle (`shell-honesty` guards
the app tree). Android gamepad passthrough is native (page Gamepad API); its
parity is verified on-device, not through this desktop harness.
