#!/usr/bin/env bash
# DEV ONLY — launch the gateway SHELL (startup service picker + settings + health
# overlay) on the host's X display for interactive validation. This docker +
# host-X bootstrap is NOT the production mechanism; the packaged app (Phase 4)
# owns its own userData/session. The engine must never depend on docker or X.
#
# Shares the `gamingate-luna-session` volume as --user-data, so the signed-in Luna
# session from luna-auth.sh is reused: pick "Luna" and the provider view opens
# already signed in. Running `electron .` with no --platform/--keep-open starts
# the trusted shell lane (see src/main/index.ts runShell()).
#
# The container keeps /tmp, /work and the package-manager caches on tmpfs: on a
# full host disk Chromium aborts with SIGTRAP when its shared-memory temp dir has
# no free space.
set -euo pipefail

VOLUME="${GAMINGATE_SESSION_VOLUME:-gamingate-luna-session}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DISPLAY_ARG="${DISPLAY:-:0}"

# X cookie (XWayland): rewrite the family to "ffff" so the container agent is
# accepted regardless of hostname (see luna-auth.sh for the full rationale).
XAUTH_SRC="${XAUTHORITY:-$HOME/.Xauthority}"
XAUTH_TMP="$(mktemp /tmp/gamingate-xauth.XXXXXX)"
cleanup() { rm -f "$XAUTH_TMP"; }
trap cleanup EXIT
if [ -f "$XAUTH_SRC" ]; then
  xauth -f "$XAUTH_SRC" nlist "$DISPLAY_ARG" 2>/dev/null \
    | sed -e 's/^..../ffff/' \
    | xauth -f "$XAUTH_TMP" nmerge - 2>/dev/null || true
fi

docker volume create "$VOLUME" >/dev/null

docker run --rm \
  --shm-size=1g \
  --tmpfs /tmp:rw,exec,size=1g \
  --tmpfs /work:rw,exec,size=3g \
  --tmpfs /var/cache/apt:rw,size=512m \
  --tmpfs /var/lib/apt/lists:rw,size=256m \
  -e npm_config_cache=/tmp/npm-cache \
  -e DISPLAY="$DISPLAY_ARG" \
  -e XAUTHORITY=/tmp/.docker.xauth \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  -v "$XAUTH_TMP":/tmp/.docker.xauth:ro \
  -v "${VOLUME}:/session" \
  -v "${ROOT}:/src:ro" \
  -w /work node:24 bash -lc '
    set -e
    cp -r /src/. /work
    apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
      libpango-1.0-0 libcairo2 libasound2 libxshmfence1 libgtk-3-0 libxss1 \
      libxtst6 libnotify4 xdg-utils \
      libx11-xcb1 libxcb-dri3-0 libxcb-xfixes0 >/dev/null
    npm install --no-audit --no-fund >/dev/null 2>&1
    node node_modules/electron/install.js >/dev/null 2>&1 || true
    npm run build >/dev/null 2>&1
    # Shell lane: no --platform / --keep-open -> runShell(). Dev host has no GPU,
    # root in the container: --no-sandbox/--no-zygote/--disable-gpu.
    ./node_modules/.bin/electron . --no-sandbox --disable-dev-shm-usage \
      --no-zygote --disable-gpu --no-relaunch --user-data=/session
  '
