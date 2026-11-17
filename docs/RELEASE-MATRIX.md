# Release Matrix (PKG-03)

Phase 4 / PKG-03. Every lane Project Gamingate v1 must be installable, cold-startable,
and playable on — and an honest split of what CI proves versus what only a human on
real hardware can certify.

> **Hardware, OS, GPU, and physical-device lanes are MANUAL.** They are **not**
> simulated, emulated, or faked in CI. No lane is marked AUTOMATED here unless a real
> pipeline job or verification step actually exercises it. A container run under Xvfb
> (software rendering) proves the build and the shell boot; it never certifies a GPU,
> a display server, or a device.

## Legend

| Mark | Meaning |
|------|---------|
| **✅ AUTOMATED** | A CI job or `docker-verify.sh` step exercises it on every push/tag. The named proof is the evidence. |
| **✋ MANUAL** | A human on real hardware/OS/GPU/device runs the procedure. **Never reported green from CI.** |

CI jobs and verify steps referenced below are the pipeline from Plan 04-04
(`.github/workflows/ci.yml`: `lint-test` → `build-desktop` → `build-android` → `release`)
and the container harness `desktop/scripts/docker-verify.sh`.

## 1. Windows desktop (x64)

Deliverable: `Gamingate-<version>-setup.exe` (electron-builder `nsis`, per-user
`oneClick: true, perMachine: false`).

| Lane | Deliverable | Build | Install / launch / playback / input |
|------|-------------|-------|-------------------------------------|
| Windows 10 x64 (22H2) | nsis `.exe` | ✋ **MANUAL** — config is statically validated by `package-desktop-config` (✅ AUTOMATED); the `.exe` itself needs a Windows runner, which the current pipeline does not have. | ✋ **MANUAL** — install, cold start, sign in once, start a Luna session, verify video/audio, gamepad + pointer-lock input, relaunch for session retention. |
| Windows 11 x64 | nsis `.exe` | ✋ **MANUAL** (same as above) | ✋ **MANUAL** — same procedure as Windows 10. |

See `docs/packaging.md` for the build command and the ECS runtime pin. The unsigned
artifact must be signed before public distribution (`docs/SIGNING.md`).

## 2. Linux desktop

Deliverable: `Gamingate-<version>-x86_64.AppImage` and `Gamingate-<version>_amd64.deb`.
Built in Docker on `electronuserland/builder:22` (Ubuntu 22.04, glibc 2.35) so the
dependency/glibc floor satisfies **Debian 12/13/14 and Ubuntu 22.04+**.

| Lane | Deliverable | Build | Run |
|------|-------------|-------|-----|
| Debian 12 / 13 / 14 x86_64 | AppImage + deb | ✅ **AUTOMATED** — `build-desktop` → `docker-verify.sh package-appimage` builds both and asserts the AppImage > 40 MB. | ✋ **MANUAL** — run per `docs/PERF-04-linux-decode.md`; the AppImage on Debian 13/14 needs `libfuse2`/`libfuse2t64` or `--appimage-extract-and-run`. |
| Ubuntu 22.04 LTS+ x86_64 | AppImage + deb | ✅ **AUTOMATED** (same job) | ✋ **MANUAL** — `sudo apt install ./Gamingate-*.deb` or run the AppImage. |
| Fedora (current) x86_64 | AppImage | ✅ **AUTOMATED** (same AppImage) | ✋ **MANUAL** — AppImage best-effort; `fuse-libs` or `--appimage-extract-and-run`. |
| Arch (rolling) x86_64 | AppImage | ✅ **AUTOMATED** (same AppImage) | ✋ **MANUAL** — AppImage best-effort; `fuse2` or `--appimage-extract-and-run`. |

Container boot/decode proof: `docker-verify.sh shell-smoke` and `decode-restart` show the
shell boots and the decode-pref persistence works under Xvfb — **instrumentation proof,
not a GPU or display-server bar.**

### Display server × GPU vendor (best-effort, representative probe per vendor)

This is **not** a required exhaustive matrix: one representative probe per vendor. Every
cell below is **✋ MANUAL** on physical hardware.

| Display | Intel (Mesa) | AMD (Mesa) | NVIDIA (proprietary) |
|---------|--------------|------------|----------------------|
| Wayland | ✋ MANUAL | ✋ MANUAL | ✋ MANUAL (software fallback expected) |
| XWayland | ✋ MANUAL | ✋ MANUAL | ✋ MANUAL (software fallback expected) |
| X11 | ✋ MANUAL | ✋ MANUAL | ✋ MANUAL (software fallback expected) |

On **NVIDIA**, VA-API is disabled in Chromium — software decode is the expected result and
must not be recorded as a passing hardware-decode lane. Details and the fill-in result
table are in `docs/PERF-04-linux-decode.md`.

## 3. Android (ARM64, physical devices)

Deliverable: `gamingate-android-release.apk` (bare-Kotlin shell, hardware-accelerated
system WebView). `minSdk 30` / `compileSdk 36` covers Android 11–15.

| Lane | Deliverable | Build | Install / playback / input |
|------|-------------|-------|----------------------------|
| Android 11 ARM64 | release `.apk` | ✅ **AUTOMATED** — `build-android` → `docker-verify.sh package-android`; registry validator proven by `android-test`. | ✋ **MANUAL** — `adb install`, cold start, sign in, start a session, gamepad, pointer/focus. |
| Android 12 ARM64 | release `.apk` | ✅ **AUTOMATED** (same job) | ✋ **MANUAL** (same procedure) |
| Android 13 ARM64 | release `.apk` | ✅ **AUTOMATED** (same job) | ✋ **MANUAL** (same procedure) |
| Android 14 ARM64 | release `.apk` | ✅ **AUTOMATED** (same job) | ✋ **MANUAL** (same procedure) |
| Android 15 ARM64 | release `.apk` | ✅ **AUTOMATED** (same job) | ✋ **MANUAL** (same procedure) |

Android system WebView is **L3-only** (Google "Won't Fix"): SD-grade playback is the bar;
do not claim L1/HD in WebView. The APK from this phase is dev-signed and must be signed
with a real release keystore before public distribution (`docs/SIGNING.md`).

## 4. What CI does not claim

- No hardware, OS, display server, GPU, or physical-device lane is exercised by CI.
- No cold-start bar (PERF-02) and no decode/HW-acceleration result (PERF-04) is certified
  by a container run; those are human UAT.
- `build-desktop` produces the Linux AppImage + deb. The Windows `nsis` binary and the
  Android release APK signing are external/CI-runner tasks, not proven here.

## 5. Related docs

| Doc | Covers |
|-----|--------|
| `docs/PERF-02-cold-start.md` | Cold-start measurement (desktop `<1.5s`, Android `<1.0s`) — human/host bars. |
| `docs/PERF-04-linux-decode.md` | Per-distro AppImage run + decode state (PERF-04). |
| `docs/packaging.md` | Desktop artifact build (PKG-01). |
| `docs/CI.md` | Pipeline jobs, container-only rule, secrets boundary. |
| `docs/SIGNING.md` | Production VMP/EVS + Android release-keystore procedures. |
