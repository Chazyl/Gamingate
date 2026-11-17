# PERF-04 — Linux AppImage Decode Runbook

Phase 4 / PERF-04. How to move the packaged desktop app to a real Linux host, run it,
and read the **best-effort** VA-API/NVDEC decode state — plus the honest limits of what
that result means.

> **Honesty boundary.** Every per-distro, per-GPU run below is **human UAT on real
> hardware**. Nothing in this document certifies a decode result until a human runs it
> and fills in the result table. A container run (`--appimage-extract-and-run` under
> Xvfb) proves the app boots and the decode machinery works under **software
> rendering**; it is never reported as a GPU/decode bar. No per-distro result is claimed
> until measured.

## Artifacts

| File | Notes |
|------|-------|
| `desktop/dist/Gamingate-<version>-x86_64.AppImage` | Portable; run on any of the distros below. |
| `desktop/dist/Gamingate-<version>_amd64.deb` | Debian/Ubuntu package; installs into the system. |

Both are built in Docker on `electronuserland/builder:22` (**Ubuntu 22.04**, glibc 2.35),
the oldest supported base, so the dependency and glibc floor satisfies the target matrix:
**Debian 12 / 13 / 14 and Ubuntu 22.04+**. Build them with
`bash desktop/scripts/docker-verify.sh package-appimage` (see `docs/packaging.md`).

## Option A — install the `.deb` (Debian / Ubuntu)

APT resolves the package dependencies; `dpkg -i` alone fails on unmet dependencies.

```bash
# Debian 12/13/14 and Ubuntu 22.04+
sudo apt install ./Gamingate-<version>_amd64.deb
```

If `apt install ./file.deb` is unavailable, resolve dependencies in two steps:

```bash
sudo dpkg -i ./Gamingate-<version>_amd64.deb   # may report unmet deps
sudo apt-get -f install                       # fixes them
```

Launch from the application menu or run the `gamingate` binary. The deb installed on
Debian 12/13/14 and Ubuntu 22.04+ by design — the builder:22 floor is why.

## Option B — run the AppImage (any distro)

```bash
chmod +x Gamingate-<version>-x86_64.AppImage
./Gamingate-<version>-x86_64.AppImage
```

### FUSE note — the AppImage runtime needs FUSE2, which newer releases dropped

The AppImage runtime mounts itself through **FUSE2**. If FUSE2 is absent you get
`dlopen(): error loading libfuse.so.2` / "AppImages require FUSE to run". Two fixes:

1. **Install FUSE2**, or
2. **Bypass FUSE entirely** with `--appimage-extract-and-run` (no root, no install).

| Distro | Install FUSE2 | Or bypass |
|--------|---------------|-----------|
| Debian 12 (bookworm) / Ubuntu 22.04+ | `sudo apt install libfuse2` | `./Gamingate-*.AppImage --appimage-extract-and-run` |
| **Debian 13 / 14** (FUSE2 dropped from base) | `sudo apt install libfuse2t64` | `./Gamingate-*.AppImage --appimage-extract-and-run` |
| Fedora | `sudo dnf install fuse-libs` | `./Gamingate-*.AppImage --appimage-extract-and-run` |
| Arch | `sudo pacman -S fuse2` | `./Gamingate-*.AppImage --appimage-extract-and-run` |

`--appimage-extract-and-run` unpacks to a temp dir and executes there; `--appimage-extract`
unpacks in place and you run `squashfs-root/AppRun` yourself. electron-builder **v27**'s
static runtime removes the FUSE requirement, but v1 ships on the electron-builder **26**
runtime, so FUSE2 or extract-and-run is required on Debian 13/14 and similarly minimal
systems.

## Reading the decode state

Once the app is running, sign in and the shell shows its decode state in **Settings**:

- **Decode badge** — evidence-based, never inventing a value:
  - `Hardware` (green) — real evidence only (`backend === 'gpu'`, `accelerated`, or an
    `enabled*` video-decode status).
  - `Software` (warning) — no usable hardware decoder; automatic fallback.
  - `Software (forced)` / `Hardware (forced)` — the user forced the mode; unproven.
  - `Unknown (not probed)` — no probe has run yet.
- **Decode status line** — `backend <b> · video <status> · probed <time> · source <src>`.

For the raw Chromium view, open `chrome://gpu` inside the app and read the
`Video Decode:` / VA-API lines. On the host, probe the driver stack directly:

```bash
vainfo                 # Intel / AMD Mesa VA-API (iHD/iris, radeonsi/RADV)
nvidia-smi             # NVIDIA presence (see the NVIDIA caveat below)
```

## Per-GPU expectations (best-effort)

| Vendor | Expected | Notes |
|--------|----------|-------|
| **Intel** (Mesa iHD/iris) | Hardware VA-API decode when `libva` + driver are present. | Best-effort; validate on the actual host. |
| **AMD** (Mesa radeonsi / RADV) | Hardware VA-API decode when `libva` + driver are present. | Best-effort; validate on the actual host. |
| **NVIDIA** (proprietary) | **Software fallback expected.** | Chromium disables VA-API on NVIDIA (crbug.com/1492880); the Chromium decode path does not use NVDEC. Do **not** record this as passing hardware decode. |

## Software fallback

When no usable hardware decoder is present the app **automatically** falls back to
software decode and the badge reads `Software` (or `Software (forced)` if the user chose
it). Software decode is fully functional but consumes more CPU. This is the expected,
supported path on NVIDIA.

**Wayland caveat:** Electron on Wayland can spawn the GPU process via the zygote such
that GPU feature flags are dropped, silently forcing software decode (electron issues
#50455 / #36633). If a known-good Intel/AMD host reports software unexpectedly, retry
under an **X11 / XWayland** session, or launch with `--no-zygote`, before concluding the
GPU is unsupported.

## Honest limitations

- NVIDIA VA-API is disabled in Chromium — software fallback is the expected, documented
  result, not a bug.
- Per-distro results are not claimed until a human measures them on that distro.
- The AppImage on **Debian 13/14** (and other FUSE2-less systems) needs `libfuse2t64` or
  `--appimage-extract-and-run`; this is a packaging-runtime requirement, not an app bug.

## Result table (fill in during human UAT)

Leave blank until measured; do not pre-fill a pass.

| Distro | Version | Session (Wayland/X11) | GPU | Package | Decode badge | `chrome://gpu` video decode | Result |
|--------|---------|-----------------------|-----|---------|--------------|-----------------------------|--------|
| Debian | 12 | | | AppImage / deb | | | |
| Debian | 13 | | | AppImage / deb | | | |
| Debian | 14 | | | AppImage / deb | | | |
| Ubuntu | 22.04+ | | | AppImage / deb | | | |
| Fedora | | | | AppImage | | | |
| Arch | | | | AppImage | | | |
