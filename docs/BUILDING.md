# Building & Testing

Everything builds and tests in **Docker**. Nothing is installed on the host
(see [CONTRIBUTING](../CONTRIBUTING.md)); the only thing you may install on a host
is a **final packaged build**, to test it.

The single entry point is `desktop/scripts/docker-verify.sh`. It mounts the source
read-only into a container, does the work in a container-local directory, and keeps
caches in Docker volumes.

## Requirements

- Docker with the ability to pull `electronuserland/builder:22` and
  `node:24`-based images.
- Linux host recommended for Linux packaging.
- For Android builds: network access to fetch the pinned Gradle distribution the
  first time (cached afterwards).

## Quick loop (desktop)

```bash
bash desktop/scripts/docker-verify.sh typecheck     # tsc --noEmit
bash desktop/scripts/docker-verify.sh test          # vitest
bash desktop/scripts/docker-verify.sh shell-test    # shell unit tests
bash desktop/scripts/docker-verify.sh shell-ipc-gate
bash desktop/scripts/docker-verify.sh shell-honesty
```

Other useful steps:

```bash
bash desktop/scripts/docker-verify.sh schema              # regenerate/verify platforms.schema.json
bash desktop/scripts/docker-verify.sh ci-config           # workflow contract gate
bash desktop/scripts/docker-verify.sh package-desktop-config
bash desktop/scripts/docker-verify.sh smoke luna          # headless provider smoke
bash desktop/scripts/docker-verify.sh persist             # session persistence probe
bash desktop/scripts/docker-verify.sh decode-restart      # decode toggle relaunch
```

## Packaging

```bash
# Linux AppImage + .deb  -> desktop/dist/
bash desktop/scripts/docker-verify.sh package-appimage

# Android release APK   -> android/dist/
bash desktop/scripts/docker-verify.sh package-android
```

Both run in Docker. The Linux packaging step uses `electronuserland/builder:22`
(the oldest supported base) so artifacts run on Debian 12/13/14 and Ubuntu 22.04+.
The `deb` sets the `chrome-sandbox` helper setuid root; the AppImage needs
`libfuse2` on Ubuntu 24.04 / Debian 13+ (or `--appimage-extract-and-run`).

## Running a packaged build

- **Linux `.deb`:** `sudo apt install ./desktop/dist/Gamingate-*.deb`, then launch
  **Gamingate** from your applications menu.
- **Linux AppImage:** `chmod +x Gamingate-*.AppImage && ./Gamingate-*.AppImage`.
- **Android APK:** `adb install -r android/dist/gamingate-android-release.apk`.

## Dev-only helpers

These exist to build, test, and capture a one-time provider sign-in on a dev
machine. They are **not** part of the shipped app, which owns its own `userData`
and does not depend on Docker or X forwarding:

- `desktop/scripts/luna-auth.sh` — one-time Luna sign-in on a dev display, persisting
  the session into a Docker volume.
- `desktop/scripts/shell-dev.sh` — launch the shell against a dev display.

## Troubleshooting

- **Disk pressure:** the largest caches are Docker images/volumes and the Electron
  download cache. Prune your own artifacts with
  `docker builder prune -af && docker image prune -f`. Do not delete unrelated
  volumes.
- **AppImage won't start on a new distro:** install `libfuse2` or run
  `./Gamingate-*.AppImage --appimage-extract-and-run`.
- **Black window / GPU process abort:** the app appends `--disable-gpu-sandbox`
  before ready on Linux (opt out with `GAMINGATE_GPU_SANDBOX=1`); the renderer
  sandbox stays on.

For packaging, signing, and CI specifics see [packaging.md](packaging.md),
[SIGNING.md](SIGNING.md), and [CI.md](CI.md).
