#!/usr/bin/env bash
# DEV ONLY — development convenience for capturing a one-time Luna sign-in on a
# dev machine. This docker + host-X-forward bootstrap is NOT the production
# session mechanism; the packaged app (Phase 4) owns its own userData/session
# directory. The engine must never depend on docker or X forwarding.
#
# One-time Luna sign-in, run by the HUMAN (the gateway never sees the password).
#
# Opens the probe on the host's X display and points Electron's userData at the
# `gamingate-luna-session` docker volume. Sign in to Luna in the window, then
# close it. The session jar lives in that volume, so it survives every future
# container rebuild:
#
#   docker run -v gamingate-luna-session:/session ... electron --user-data=/session
#
# To use it later, mount the SAME volume at --user-data and load the packet
# through the gateway engine with --platform=<id>.
#
# The container keeps /tmp, /work and the package-manager caches on tmpfs. This
# is required on a full host disk: Chromium aborts with SIGTRAP when its
# shared-memory temp directory has no free space.
set -euo pipefail

VOLUME="${GAMINGATE_SESSION_VOLUME:-gamingate-luna-session}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DISPLAY_ARG="${DISPLAY:-:0}"
# Real sign-in uses the Luna packet; override to smoke-test another packet,
# e.g. GAMINGATE_AUTH_PLATFORM=geforce-now-spike.
PLATFORM="${GAMINGATE_AUTH_PLATFORM:-luna}"

# X cookie. This host runs XWayland: the real cookie is in $XAUTHORITY (a
# per-session mutter file at /run/user/<uid>/.mutter-Xwaylandauth.*), and
# ~/.Xauthority may not exist (or be a directory). Rewrite the cookie family to
# "ffff" (FamilyWild, the standard Docker X-forwarding trick) so the container
# agent is accepted regardless of hostname. If this still fails, the fallback is
# a one-time `xhost +si:localuser:root` on the host.
XAUTH_SRC="${XAUTHORITY:-$HOME/.Xauthority}"
XAUTH_TMP="$(mktemp /tmp/gamingate-xauth.XXXXXX)"
cleanup() { rm -f "$XAUTH_TMP"; }
trap cleanup EXIT
if [ -f "$XAUTH_SRC" ]; then
  xauth -f "$XAUTH_SRC" nlist "$DISPLAY_ARG" 2>/dev/null \
    | sed -e 's/^..../ffff/' \
    | xauth -f "$XAUTH_TMP" nmerge - 2>/dev/null || true
fi

# Ensure the persistent session volume exists (idempotent).
docker volume create "$VOLUME" >/dev/null

docker run --rm \
  --shm-size=1g \
  --tmpfs /tmp:rw,exec,size=1g \
  --tmpfs /work:rw,exec,size=3g \
  --tmpfs /var/cache/apt:rw,size=512m \
  --tmpfs /var/lib/apt/lists:rw,size=256m \
  -e npm_config_cache=/tmp/npm-cache \
  -e PLATFORM="$PLATFORM" \
  -e DISPLAY="$DISPLAY_ARG" \
  -e XAUTHORITY=/tmp/.docker.xauth \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  -v "$XAUTH_TMP":/tmp/.docker.xauth:ro \
  -v "${VOLUME}:/session" \
  -v "${ROOT}:/src:ro" \
  -w /work node:24 bash -lc '
    set -e
    cp -r /src/. /work
    # Electron runtime libraries (node:24 has none of these). libnspr4 is the
    # one that fails first; the rest are needed for a real GTK window.
    apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
      libpango-1.0-0 libcairo2 libasound2 libxshmfence1 libgtk-3-0 libxss1 \
      libxtst6 libnotify4 xdg-utils \
      libx11-xcb1 libxcb-dri3-0 libxcb-xfixes0 >/dev/null
    npm install --no-audit --no-fund >/dev/null 2>&1
    # npm can skip the Electron postinstall, leaving no binary; install.js is
    # idempotent (a no-op once the binary is present).
    node node_modules/electron/install.js >/dev/null 2>&1 || true
    npm run build >/dev/null 2>&1
    # --no-relaunch keeps the window in-process: the engine Linux CDM first-install
    # path calls app.relaunch() then app.exit(0), which under "docker run --rm"
    # tears the container down and kills the relaunched window. The CDM loads
    # fine without it (status new). --no-zygote works around the Electron
    # XWayland zygote/GPU crash; --disable-gpu because the dev VM has only
    # software GL. None of these are production flags. --keep-open makes the
    # engine keep the window open for an interactive sign-in (no auto-exit).
    ./node_modules/.bin/electron . --no-sandbox --disable-dev-shm-usage \
      --no-zygote --disable-gpu --no-relaunch --user-data=/session \
      --platform="$PLATFORM" --keep-open
  '
