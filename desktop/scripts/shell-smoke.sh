#!/usr/bin/env bash
# Headless trusted-shell boot smoke (SHL-01).
#
# Runs INSIDE the container-only verify image (invoked by docker-verify.sh);
# never executes on the host. Xvfb provides the display; Chromium runs with the
# standard dev flags (none of which are production flags).
#
# Proves the load-bearing path: the shell renderer boots, reaches the TRUSTED
# bridge, reads the registry platform list, and reports SHELL_READY (which main
# forwards and then exits). Non-zero on timeout.
set -euo pipefail

cd "$(dirname "$0")/.."   # /work

ELECTRON=./node_modules/.bin/electron
ELECTRON_FLAGS=(--no-sandbox --disable-dev-shm-usage --disable-gpu --no-relaunch)

npm run build >/dev/null

UA=/tmp/shell-smoke-ua
LOG=/tmp/shell-smoke.log
rm -rf "$UA"
mkdir -p "$UA"

set +e
xvfb-run -a "$ELECTRON" "${ELECTRON_FLAGS[@]}" . \
  --user-data="$UA" --shell-smoke >"$LOG" 2>&1
CODE=$?
set -e

if ! grep -q "SHELL_READY" "$LOG"; then
  echo "FAIL: shell did not report SHELL_READY over the trusted bridge"
  cat "$LOG"
  exit 1
fi

# The marker must also show a non-zero platform count (registry crossed bridge).
if ! grep -Eq "SHELL_READY platforms=[1-9][0-9]*" "$LOG"; then
  echo "FAIL: SHELL_READY did not report a non-empty platform list"
  cat "$LOG"
  exit 1
fi

[ "$CODE" -eq 0 ] \
  || { echo "FAIL: shell smoke exited non-zero ($CODE)"; cat "$LOG"; exit 1; }

echo SHELL_SMOKE_OK
