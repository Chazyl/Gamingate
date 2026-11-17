# PERF-02 — Cold-Start Runbook

Phase 4 / PERF-02. How to measure desktop and Android cold start against the
**<1.5s desktop** and **<1.0s Android** bars — and the honest boundary that only a
human on real hardware can certify either one.

> **Honesty boundary.** The container `cold-start` step below proves the
> *instrumentation* works and emits a real number. It does **not** certify either bar:
> it runs software-rendered under Xvfb on a shared CI host. The `<1.5s` desktop bar is
> a **host** measurement; the `<1.0s` Android bar is a **physical-device** measurement.
> No bar is claimed until a human runs the procedure and fills in the result table.
> A container number is never reported as a PERF-02 pass.

## What is measured

| Surface | Anchor | Stop | Marker |
|---------|--------|------|--------|
| Desktop (`--cold-start`) | Electron main module load (monotonic `process.hrtime.bigint()` at module top) | First forwarded `SHELL_READY` — the React shell reached the trusted bridge and resolved the platform list (first-paint / shell-visible proxy) | `COLD_START_MS=<n> shell` |
| Android | `SystemClock.elapsedRealtime()` at `onCreate` | First `WebViewClient.onPageFinished` | `COLD_START_MS=<n> surface=webview` |

## Automated lane (container-only) — instrumentation proof

```bash
bash desktop/scripts/docker-verify.sh cold-start
```

- Builds the engine, boots it under Xvfb with `--shell-smoke --cold-start`, and asserts a
  real numeric `COLD_START_MS` in a sane range (**1..120000 ms**). It prints
  `COLD_START_OK ms=<n>`.
- A static gate also fails the step if the Android `COLD_START_MS=` marker disappears from
  `MainActivity.kt`, so the device hook cannot silently rot.
- **What it proves:** the timers fire, the marker path works, and a number reaches the
  harness. **What it does NOT prove:** either performance bar. The observed value is
  commonly **1.5–3 s** under software rendering — that is the harness, not the product.
  Do not quote it as a PERF-02 result.

## Desktop procedure (host measurement — the `<1.5s` bar)

Artifact: `desktop/dist/Gamingate-<version>-x86_64.AppImage`, built with
`bash desktop/scripts/docker-verify.sh package-appimage` (see `docs/packaging.md`;
FUSE2 / `--appimage-extract-and-run` notes in `docs/PERF-04-linux-decode.md`).

1. **Warm the CDM first.** The first run provisions Widevine and may relaunch once. Do a
   throwaway launch (or pass `--no-relaunch`) so the timing run is not a CDM install.
2. **Run the timing lane and capture stdout**, wrapping the whole launch for the
   external wall clock:

   ```bash
   /usr/bin/time -v ./Gamingate-<version>-x86_64.AppImage \
     --shell-smoke --cold-start --no-relaunch \
     --user-data="$(mktemp -d)" 2>&1 | tee cold-start.log
   grep COLD_START_MS cold-start.log
   ```

   - `COLD_START_MS=<n> shell` is the **in-app** number: process-start → `SHELL_READY`.
   - `/usr/bin/time -v`'s `Elapsed (wall clock)` is the **full** cold start: it also
     includes the AppImage runtime's mount/extract and OS process spawn. Use the full
     number to judge the bar; the in-app number isolates the shell.
3. **Repeat at least 5 times**, ideally after a fresh (warm) reboot, and report the
   **median** of both numbers. Discard the first run (page cache).
4. Record below. The bar is **<1.5s** on the target host.

> Measure on the host OS, CPU, GPU, and display server you intend to support. A container
> or VM number is not the bar. On Wayland, retry under X11/XWayland before concluding a
> regression (see the `docs/PERF-04-linux-decode.md` Wayland caveat).

## Android procedure (device measurement — the `<1.0s` bar)

Artifact: `android/dist/gamingate-android-release.apk`, built with
`bash desktop/scripts/docker-verify.sh package-android` (dev-signed; release
signing in `docs/SIGNING.md`).

```bash
adb install -r gamingate-android-release.apk
adb logcat -c
adb shell am start -S -W -n com.gamingate.gateway/.MainActivity
adb logcat -d | grep "COLD_START_MS surface=webview"
```

- `-S` force-stops the app first (a true cold start); `-W` prints Android's own
  `TotalTime` for cross-check.
- `COLD_START_MS=<n> surface=webview` is the delta from `onCreate` to the first WebView
  page-finish; the Android bar is **<1.0s**.
- Repeat on each target device (Android 11–15 ARM64). **Physical ARM64 device only** —
  emulators lack real WebView/CDM provisioning and their numbers are inadmissible.

## Result tables (fill in during human UAT)

Leave blank until measured; do not pre-fill a pass.

### Desktop — `<1.5s`

| Host OS | Version | CPU / GPU | Display | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Run 4 (ms) | Run 5 (ms) | Median (ms) | Pass `<1.5s`? |
|---------|---------|-----------|---------|------------|------------|------------|------------|------------|-------------|----------------|
| Windows | 10 / 11 | | | | | | | | | |
| Debian | 12 / 13 / 14 | | | | | | | | | |
| Ubuntu | 22.04+ | | | | | | | | | |
| Fedora | | | | | | | | | | |
| Arch | | | | | | | | | | |

### Android — `<1.0s`

| Device | Android | WebView version | Run 1 (ms) | Run 2 (ms) | Run 3 (ms) | Median (ms) | Pass `<1.0s`? |
|--------|---------|-----------------|------------|------------|------------|-------------|----------------|
| | 11 | | | | | | |
| | 12 | | | | | | |
| | 13 | | | | | | |
| | 14 | | | | | | |
| | 15 | | | | | | |

## Honest limitations

- The container `cold-start` step is instrumentation proof, never a bar.
- The in-app desktop number excludes the AppImage runtime's own mount/extract time; use
  the external wall clock for the full cold start the user actually experiences.
- Emulator Android evidence is inadmissible; only physical ARM64 devices count.
- No number in this document is a measurement until a human records it above.
