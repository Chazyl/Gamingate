#!/usr/bin/env bash
# Two-launch decode re-init round-trip (SHL-02).
#
# Runs INSIDE the container-only verify image (invoked by docker-verify.sh);
# never executes on the host. Xvfb provides the display.
#
# Proves the headline finding: a decode-mode change is persisted and applied
# BEFORE app ready on the NEXT launch (a real process re-init, not a cosmetic
# flip). Launch 1 persists `software` under `--no-relaunch` (also exercising the
# loop guard); launch 2 prints the resolved pre-ready state, which must show the
# hardware acceleration disabled.
set -euo pipefail

cd "$(dirname "$0")/.."   # /work

ELECTRON=./node_modules/.bin/electron
ELECTRON_FLAGS=(--no-sandbox --disable-dev-shm-usage --disable-gpu)

npm run build >/dev/null

UA=/tmp/decode-smoke-ua
rm -rf "$UA"
mkdir -p "$UA"

# --- Launch 1: persist the mode; --no-relaunch exercises the loop guard --------
set +e
xvfb-run -a "$ELECTRON" "${ELECTRON_FLAGS[@]}" . \
  --user-data="$UA" --set-decode-mode=software --no-relaunch \
  >/tmp/decode-smoke1.log 2>&1
CODE1=$?
set -e
[ "$CODE1" -eq 0 ] \
  || { echo "FAIL: decode set launch exited non-zero ($CODE1)"; cat /tmp/decode-smoke1.log; exit 1; }

[ -f "$UA/decode-decision.json" ] \
  || { echo "FAIL: decode-decision.json was not persisted"; cat /tmp/decode-smoke1.log; exit 1; }
grep -q '"mode": "software"' "$UA/decode-decision.json" \
  || { echo "FAIL: persisted decision is not software"; cat "$UA/decode-decision.json"; exit 1; }

# --- Launch 2: the persisted mode must apply pre-ready -------------------------
set +e
xvfb-run -a "$ELECTRON" "${ELECTRON_FLAGS[@]}" . \
  --user-data="$UA" --print-decode-state \
  >/tmp/decode-smoke2.log 2>&1
CODE2=$?
set -e
[ "$CODE2" -eq 0 ] \
  || { echo "FAIL: decode state launch exited non-zero ($CODE2)"; cat /tmp/decode-smoke2.log; exit 1; }

grep -q "DECODE_PRE_READY software hw-accel-disabled" /tmp/decode-smoke2.log \
  || { echo "FAIL: persisted software mode was not applied pre-ready"; cat /tmp/decode-smoke2.log; exit 1; }

echo DECODE_RESTART_OK
