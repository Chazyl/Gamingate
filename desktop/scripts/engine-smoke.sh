#!/usr/bin/env bash
# Headless E2E smoke for the registry-driven gateway engine.
#
# Runs INSIDE the container-only verify image (invoked by docker-verify.sh);
# never executes on the host. Xvfb provides the display; Chromium runs with the
# standard dev flags (none of which are production flags).
#
#   engine-smoke.sh <platformId>   valid registry: boot, top-level load, assert
#   engine-smoke.sh invalid        overlay the bad fixture, assert fail-closed
#   engine-smoke.sh persist        fast-quit + relaunch cookie round-trip
#   engine-smoke.sh keepopen <id>  interactive mode: stays alive + ready marker
set -euo pipefail

MODE="${1:-luna}"
PLATFORM="${2:-luna}"
cd "$(dirname "$0")/.."   # /work

ELECTRON=./node_modules/.bin/electron
# Container/Xvfb dev flags. Flags go BEFORE the app path so Chromium sees them;
# --no-zygote (an XWayland workaround) is intentionally omitted: under Xvfb as
# root it makes a child process abort with a sandbox FATAL, failing the run.
ELECTRON_FLAGS=(--no-sandbox --disable-dev-shm-usage --disable-gpu --no-relaunch)

npm run build >/dev/null

# --- fail-closed proof ------------------------------------------------------
if [ "$MODE" = "invalid" ]; then
  UA=/tmp/engine-invalid-ua
  EA=/tmp/engine-invalid-evidence
  rm -rf "$UA" "$EA"
  mkdir -p "$UA" "$EA"

  # Overlay the invalid packet as the bundled registry, then rebuild so the
  # asset import resolves to the bad file — an honest invalid-bundle run.
  cp test/fixtures/invalid-platforms.json platforms.json
  npm run build >/dev/null

  set +e
  OUT=$(xvfb-run -a "$ELECTRON" "${ELECTRON_FLAGS[@]}" . \
    --user-data="$UA" --platform=luna --capture="$EA" 2>&1)
  CODE=$?
  set -e

  echo "$OUT" | grep -q "REGISTRY_INVALID" \
    || { echo "FAIL: startup did not report REGISTRY_INVALID"; echo "$OUT"; exit 1; }
  echo "$OUT" | grep -qi "entryUrl" \
    || { echo "FAIL: abort did not name the offending field (entryUrl)"; echo "$OUT"; exit 1; }
  [ "$CODE" -ne 0 ] \
    || { echo "FAIL: invalid registry exited 0"; echo "$OUT"; exit 1; }
  if ls "$EA"/*.json >/dev/null 2>&1; then
    echo "FAIL: evidence JSON produced for an invalid registry"
    ls -la "$EA"
    exit 1
  fi
  echo INVALID_FAIL_CLOSED_OK
  exit 0
fi

# --- interactive keep-open (no auto-exit) -----------------------------------
# Proves the engine's interactive mode: the selected packet loads, the process
# reports the stable ready marker, and it stays ALIVE (does not auto-exit) until
# the harness terminates it. Xvfb is started directly so the electron PID is
# tracked exactly (xvfb-run would background a wrapper we cannot cleanly kill).
if [ "$MODE" = "keepopen" ]; then
  UA=/tmp/engine-keepopen-ua
  LOG=/tmp/engine-keepopen.log
  XVFB_LOG=/tmp/engine-keepopen-xvfb.log
  rm -rf "$UA"
  mkdir -p "$UA"

  Xvfb :99 -screen 0 1280x800x24 >"$XVFB_LOG" 2>&1 &
  XVFB_PID=$!
  export DISPLAY=:99

  "$ELECTRON" "${ELECTRON_FLAGS[@]}" . \
    --user-data="$UA" --platform="$PLATFORM" --keep-open >"$LOG" 2>&1 &
  APP_PID=$!

  READY=0
  for _ in $(seq 1 50); do
    if grep -q "KEEP_OPEN_READY" "$LOG" 2>/dev/null; then READY=1; break; fi
    if ! kill -0 "$APP_PID" 2>/dev/null; then break; fi
    sleep 0.5
  done

  ALIVE=0
  kill -0 "$APP_PID" 2>/dev/null && ALIVE=1
  kill "$APP_PID" 2>/dev/null || true
  kill "$XVFB_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  wait "$XVFB_PID" 2>/dev/null || true

  [ "$ALIVE" -eq 1 ] \
    || { echo "FAIL: keep-open process auto-exited (interactive mode did not stay alive)"; cat "$LOG"; exit 1; }
  [ "$READY" -eq 1 ] \
    || { echo "FAIL: keep-open ready marker (KEEP_OPEN_READY) not observed"; cat "$LOG"; exit 1; }

  echo KEEP_OPEN_OK
  exit 0
fi

# --- persistence round-trip (fast quit + relaunch) --------------------------
# EMB-02: a synthetic persistent cookie written, then IMMEDIATELY quit, must be
# flushed by before-quit and restored on the next launch with the same
# --user-data. Asserts cookie PRESENCE only; never reads cookie contents.
if [ "$MODE" = "persist" ]; then
  UA=/tmp/engine-persist-ua
  rm -rf "$UA"
  mkdir -p "$UA"

  xvfb-run -a "$ELECTRON" "${ELECTRON_FLAGS[@]}" . \
    --user-data="$UA" --platform=luna --persist-probe=write >/tmp/engine-persist1.log 2>&1 \
    || { echo "FAIL: persist write launch exited non-zero"; cat /tmp/engine-persist1.log; exit 1; }
  grep -q "PERSIST_PROBE_WRITTEN" /tmp/engine-persist1.log \
    || { echo "FAIL: persist probe cookie was not written"; cat /tmp/engine-persist1.log; exit 1; }

  xvfb-run -a "$ELECTRON" "${ELECTRON_FLAGS[@]}" . \
    --user-data="$UA" --platform=luna --persist-probe=check >/tmp/engine-persist2.log 2>&1 \
    || { echo "FAIL: cookie missing after relaunch"; cat /tmp/engine-persist2.log; exit 1; }
  grep -q "PERSIST_PROBE_PRESENT" /tmp/engine-persist2.log \
    || { echo "FAIL: persist probe cookie was not restored"; cat /tmp/engine-persist2.log; exit 1; }

  echo PERSISTENCE_OK
  exit 0
fi

# --- valid smoke ------------------------------------------------------------
UA=/tmp/engine-ua-$MODE
EA=/tmp/engine-evidence-$MODE
rm -rf "$UA" "$EA"
mkdir -p "$UA" "$EA"

xvfb-run -a "$ELECTRON" "${ELECTRON_FLAGS[@]}" . \
  --user-data="$UA" --platform="$MODE" --capture="$EA" >/tmp/engine-run1.log 2>&1 \
  || { echo "FAIL: engine run 1 exited non-zero"; cat /tmp/engine-run1.log; exit 1; }

node - "$EA" "$MODE" <<'NODE'
const fs = require('fs')
const path = require('path')
const [dir, id] = process.argv.slice(2)
const file = path.join(dir, `engine-${id}.json`)
if (!fs.existsSync(file)) { console.error('FAIL: no evidence at ' + file); process.exit(1) }
const e = JSON.parse(fs.readFileSync(file, 'utf8'))
if (e.didFinishLoad !== true) { console.error('FAIL: did-finish-load not reached', e); process.exit(1) }
if (e.didFailLoad === true) { console.error('FAIL: did-fail-load fired:', e.errorDescription); process.exit(1) }
if (!(typeof e.httpResponseCode === 'number' && e.httpResponseCode > 0 && e.httpResponseCode < 400)) {
  console.error('FAIL: httpResponseCode not < 400:', e.httpResponseCode); process.exit(1)
}
// Ruling: Luna geo-redirects luna.amazon.com -> a locale host (observed .fr in
// CI). Exact entry-origin equality is therefore not achievable; the
// security-meaningful invariant is that the final top-level origin is one the
// packet explicitly declares in allowedOrigins (no hijack off-provider).
const registry = JSON.parse(fs.readFileSync('platforms.json', 'utf8'))
const packet = registry.platforms.find((p) => p.id === id)
if (!packet) { console.error('FAIL: packet not found: ' + id); process.exit(1) }
const allowed = new Set(packet.allowedOrigins)
const entryOrigin = new URL(e.entryUrl).origin
const finalOrigin = new URL(e.finalUrl).origin
if (!allowed.has(entryOrigin)) {
  console.error(`FAIL: entry origin ${entryOrigin} not in allowedOrigins`); process.exit(1)
}
if (!allowed.has(finalOrigin)) {
  console.error(`FAIL: final origin ${finalOrigin} not in allowedOrigins`); process.exit(1)
}
// OS spoof (opt-in): the provider page must report the packet's platform
// CONSISTENTLY, not the real Linux one. Asserted only when the packet opts in.
if (packet.platformSpoof) {
  const probe = e.platformSpoofProbe
  if (!probe || probe.uaDataPlatform !== packet.platformSpoof.platform) {
    console.error('FAIL: provider userAgentData.platform not spoofed:', JSON.stringify(probe))
    process.exit(1)
  }
  if (probe.navigatorPlatform !== 'Win32') {
    console.error('FAIL: provider navigator.platform not spoofed:', JSON.stringify(probe))
    process.exit(1)
  }
  console.log('PLATFORM_SPOOF_PROBE_OK', JSON.stringify(probe))
}
console.log('SMOKE_EVIDENCE_OK', JSON.stringify({ url: e.finalUrl, code: e.httpResponseCode }))
NODE

# The first launch must persist the decode decision (one representative probe).
[ -f "$UA/decode-decision.json" ] \
  || { echo "FAIL: decode-decision.json was not written under userData"; exit 1; }
echo "DECODE_DECISION_WRITTEN $(tr -d '\n' < "$UA/decode-decision.json")"

# --- subsequent-launch software fallback proof ------------------------------
# Seed a persisted software decision and prove it disables HW acceleration
# BEFORE app ready on the next launch.
UA2=/tmp/engine-ua2-$MODE
EA2=/tmp/engine-evidence2-$MODE
rm -rf "$UA2" "$EA2"
mkdir -p "$UA2" "$EA2"
echo '{"mode":"software","backend":"swiftshader","videoDecodeStatus":"disabled","probedAt":null}' \
  > "$UA2/decode-decision.json"

xvfb-run -a "$ELECTRON" "${ELECTRON_FLAGS[@]}" . \
  --user-data="$UA2" --platform="$MODE" --capture="$EA2" >/tmp/engine-run2.log 2>&1 \
  || { echo "FAIL: engine run 2 exited non-zero"; cat /tmp/engine-run2.log; exit 1; }

grep -q "DECODE_PRE_READY software hw-accel-disabled" /tmp/engine-run2.log \
  || { echo "FAIL: persisted software decision did not disable HW accel pre-ready"; cat /tmp/engine-run2.log; exit 1; }

echo ENGINE_SMOKE_OK
