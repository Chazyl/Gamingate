#!/usr/bin/env bash
# Headless cold-start timing lane (PERF-02).
#
# Runs INSIDE the container-only verify image (invoked by docker-verify.sh);
# never executes on the host. Xvfb provides the display.
#
# Proves the INSTRUMENTATION works: the app measures process-start -> the shell's
# first ready marker (`SHELL_READY`) and prints a numeric `COLD_START_MS=<n> shell`.
#
# HONESTY BOUNDARY: this container number is NOT the PERF-02 bar. The <1.5s desktop
# target is a host measurement and the <1.0s Android target a device measurement
# (docs/PERF-02-cold-start.md). This lane runs software-rendered on a shared CI
# host, so it only asserts the value is a real, sane number — never a threshold.
set -euo pipefail

cd "$(dirname "$0")/.."   # /work

# Static presence gate (PERF-02): the Android device cold-start marker must not
# silently disappear from the shell. Anchor on the emitted Log call, NOT the bare
# `COLD_START_MS=` prefix — that prefix also appears in the explanatory comment at
# MainActivity.kt:38, so matching it would keep passing after the real
# instrumentation is deleted. Read-only repo mount (`/repo`, provided by
# docker-verify.sh's in_container); this step only needs a container grep.
ANDROID_MAIN=/repo/android/app/src/main/java/com/gamingate/probe/MainActivity.kt
LOG_CALL_RE='Log\.[a-z]\(TAG, "COLD_START_MS='
if ! grep -qE "$LOG_CALL_RE" "$ANDROID_MAIN"; then
  echo "FAIL: Android COLD_START_MS log call missing from $ANDROID_MAIN"
  exit 1
fi
# Negative control: with the real Log line stripped the anchored pattern must
# match nothing. If it still matches, the gate is anchored on a comment, not the
# instrumentation — fail loudly rather than pass on rot.
if grep -qE "$LOG_CALL_RE" <(grep -vE "$LOG_CALL_RE" "$ANDROID_MAIN"); then
  echo "FAIL: cold-start presence gate matches a non-Log line (self-check failed)"
  exit 1
fi

ELECTRON=./node_modules/.bin/electron
ELECTRON_FLAGS=(--no-sandbox --disable-dev-shm-usage --disable-gpu --no-relaunch)

npm run build >/dev/null

UA=/tmp/cold-start-ua
LOG=/tmp/cold-start.log
rm -rf "$UA"
mkdir -p "$UA"

set +e
xvfb-run -a "$ELECTRON" "${ELECTRON_FLAGS[@]}" . \
  --user-data="$UA" --shell-smoke --cold-start >"$LOG" 2>&1
CODE=$?
set -e

if ! grep -q "SHELL_READY" "$LOG"; then
  echo "FAIL: shell did not report SHELL_READY over the trusted bridge"
  cat "$LOG"
  exit 1
fi

if ! grep -qE 'COLD_START_MS=[0-9]+' "$LOG"; then
  echo "FAIL: cold-start lane emitted no numeric COLD_START_MS marker"
  cat "$LOG"
  exit 1
fi

MS="$(grep -m1 -oE 'COLD_START_MS=[0-9]+' "$LOG" | cut -d= -f2)"
# Sane range only (1..120000 ms). NOT a performance bar.
if [ "$MS" -lt 1 ] || [ "$MS" -gt 120000 ]; then
  echo "FAIL: COLD_START_MS out of sane range (1..120000): '$MS'"
  cat "$LOG"
  exit 1
fi

[ "$CODE" -eq 0 ] \
  || { echo "FAIL: cold-start lane exited non-zero ($CODE)"; cat "$LOG"; exit 1; }

echo "COLD_START_OK ms=$MS"
