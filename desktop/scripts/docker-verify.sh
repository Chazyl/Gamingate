#!/usr/bin/env bash
# Container-only verification wrapper for the desktop engine seed.
#
# AGENTS.md (locked): EVERY build/test/verify runs in Docker. The host must
# never run npm, node, or Gradle against this project. This script is the only
# supported entry point for typecheck/test/build/smoke/invalid/android-test.
#
#   bash desktop/scripts/docker-verify.sh typecheck
#   bash desktop/scripts/docker-verify.sh test
#   bash desktop/scripts/docker-verify.sh build
#   bash desktop/scripts/docker-verify.sh smoke <platformId>
#   bash desktop/scripts/docker-verify.sh invalid
#   bash desktop/scripts/docker-verify.sh persist
#   bash desktop/scripts/docker-verify.sh keepopen <platformId>
#   bash desktop/scripts/docker-verify.sh reg03-no-branch
#   bash desktop/scripts/docker-verify.sh emb03-cookie-scope
#   bash desktop/scripts/docker-verify.sh shell-smoke
#   bash desktop/scripts/docker-verify.sh cold-start
#   bash desktop/scripts/docker-verify.sh schema
#   bash desktop/scripts/docker-verify.sh android-test
#
# Dev/CI tooling only — never a dependency of the shipped app.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"          # desktop/
NODE_IMAGE="${GAMINGATE_NODE_IMAGE:-node:24}"
ANDROID_IMAGE="${GAMINGATE_ANDROID_IMAGE:-ghcr.io/cirruslabs/android-sdk:36}"
VERIFY_IMAGE="${GAMINGATE_VERIFY_IMAGE:-gamingate-desktop-verify:latest}"
# electron-builder + AppImage/deb tooling. ~2 GB pull; only used by packaging steps.
# Build on the OLDEST supported base (electronuserland/builder:22 == Ubuntu 22.04,
# glibc 2.35 ≈ Debian 12) so the deb's dependency floor and glibc symbols satisfy
# the target floor (Debian 12/13/14, Ubuntu 22.04+). Building on :latest (24.04)
# yields a deb whose deps are too new for the floor. Override with
# GAMINGATE_BUILDER_IMAGE.
BUILDER_IMAGE="${GAMINGATE_BUILDER_IMAGE:-electronuserland/builder:22}"
DIST_DIR="$ROOT/dist"
WORK_VOLUME="${GAMINGATE_WORK_VOLUME:-gamingate-desktop-work}"
CACHE_VOLUME="${GAMINGATE_CACHE_VOLUME:-gamingate-desktop-cache}"
ANDROID_WORK_VOLUME="${GAMINGATE_ANDROID_WORK_VOLUME:-gamingate-android-work}"
GRADLE_VERSION="${GAMINGATE_GRADLE_VERSION:-9.4.1}"

STEP="${1:-}"
ARG="${2:-}"

log() { echo "[docker-verify] $*" >&2; }

ensure_verify_image() {
  if ! docker image inspect "$VERIFY_IMAGE" >/dev/null 2>&1; then
    log "building $VERIFY_IMAGE (one-time)"
    docker build -q -t "$VERIFY_IMAGE" -f "$ROOT/scripts/verify.Dockerfile" "$ROOT/scripts" >/dev/null
  fi
}

if [ -z "$STEP" ]; then
  log "usage: docker-verify.sh {typecheck|test|build|smoke <id>|invalid|persist|keepopen <id>|reg03-no-branch|emb03-cookie-scope|shell-smoke|cold-start|shell-test|ui-build|shell-ipc-gate|shell-honesty|decode-restart|schema|android-test|package-android|package-appimage|package-desktop-config|ci-config}"
  exit 2
fi

docker volume create "$WORK_VOLUME" >/dev/null
docker volume create "$CACHE_VOLUME" >/dev/null

# Copy the read-only source into a container-local work dir (a named volume so
# node_modules survives between steps), install, then run the requested command.
# Every container run is exactly this shape: /src mounted ro, work in /work.
in_container() {
  local script="$1"
  docker run --rm \
    --shm-size=2g \
    --tmpfs /tmp:rw,exec,size=1g \
    -e "GAMINGATE_STEP=$STEP" \
    -e "GAMINGATE_ARG=$ARG" \
    -e npm_config_cache=/cache/npm \
    -e ELECTRON_CACHE=/cache/electron \
    -v "$ROOT:/src:ro" \
    -v "$ROOT/..:/repo:ro" \
    -v "$WORK_VOLUME:/work" \
    -v "$CACHE_VOLUME:/cache" \
    -w /work \
    "$VERIFY_IMAGE" bash -lc "
      set -e
      cp -r /src/. /work/
      cd /work
      npm install --no-audit --no-fund --prefer-offline
      node node_modules/electron/install.js || true
      $script
    "
}

case "$STEP" in
  typecheck)
    ensure_verify_image
    log "typecheck (Docker)"
    in_container "npm run typecheck && echo TYPECHECK_OK"
    ;;
  test)
    ensure_verify_image
    log "unit tests (Docker)"
    in_container "npm test"
    ;;
  build)
    ensure_verify_image
    log "electron-vite build (Docker)"
    in_container "npm run build && echo BUILD_OK"
    ;;
  smoke)
    ensure_verify_image
    log "headless smoke for platform '${ARG:-luna}' (Docker + Xvfb)"
    in_container "bash scripts/engine-smoke.sh ${ARG:-luna}"
    ;;
  invalid)
    ensure_verify_image
    log "fail-closed startup proof (Docker + Xvfb)"
    in_container "bash scripts/engine-smoke.sh invalid"
    ;;
  persist)
    ensure_verify_image
    log "session persistence round-trip: fast quit + relaunch (Docker + Xvfb)"
    in_container "bash scripts/engine-smoke.sh persist"
    ;;
  keepopen)
    ensure_verify_image
    log "interactive keep-open smoke for platform '${ARG:-luna}' (Docker + Xvfb)"
    in_container "bash scripts/engine-smoke.sh keepopen ${ARG:-luna}"
    ;;
  reg03-no-branch)
    ensure_verify_image
    log "REG-03 strict whole-tree provider-branch gate (Docker)"
    # Extensibility invariant (REG-03, T-02-13): provider identities live only in
    # the data packet. This gate mounts the whole engine tree, derives packet ids
    # AND partitions from the mounted platforms.json (no hardcoded allowlist, so
    # a new provider is policed automatically), scans the engine source tree
    # (excluding *.test.ts), and fails on any quoted provider-id literal, any
    # quoted packet-partition literal, or any id-vs-string-literal comparison.
    # A synthetic negative control (one example of each shape) MUST be caught, so
    # the gate passes only when it both finds the real tree clean AND polices all
    # three shapes. Throwaway container, /probe mounted read-only; no host tooling.
    REG03_SCAN="$(cat <<'NODE'
const fs = require('fs')
const path = require('path')

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function scan(root, ids, partitions) {
  const findings = []
  const idRes = ids.map((id) => [id, new RegExp("['\"]" + esc(id) + "['\"]")])
  const partRes = partitions.map((p) => [p, new RegExp("['\"]" + esc(p) + "['\"]")])
  const cmpRe = /\.id\s*(===|==|!==|!=)\s*['"]/
  for (const file of walk(root, [])) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const [id, re] of idRes) {
        if (re.test(line)) findings.push({ file, line: i + 1, kind: 'id', value: id })
      }
      for (const [p, re] of partRes) {
        if (re.test(line)) findings.push({ file, line: i + 1, kind: 'partition', value: p })
      }
      if (cmpRe.test(line)) findings.push({ file, line: i + 1, kind: 'id-comparison' })
    })
  }
  return findings
}

const registry = JSON.parse(fs.readFileSync(process.env.REG03_REGISTRY, 'utf8'))
const ids = registry.platforms.map((p) => p.id)
const partitions = registry.platforms.map((p) => p.partition)

const real = scan(process.env.REG03_SRC, ids, partitions)
if (real.length > 0) {
  console.error('FAIL: provider branch/literal found in engine source:')
  for (const f of real) console.error(`  ${f.file}:${f.line} [${f.kind}] ${f.value || ''}`)
  process.exit(1)
}

const negRoot = process.env.REG03_NEG
fs.rmSync(negRoot, { recursive: true, force: true })
fs.mkdirSync(path.join(negRoot, 'nested'), { recursive: true })
fs.writeFileSync(
  path.join(negRoot, 'a.ts'),
  "const a = '" + ids[0] + "'\nconst b = '" + partitions[0] + "'\nif (x.id === '" + ids[0] + "') {}\n"
)
fs.writeFileSync(path.join(negRoot, 'nested', 'b.ts'), 'export const ok = 1\n')
const negKinds = new Set(scan(negRoot, ids, partitions).map((f) => f.kind))
for (const kind of ['id', 'partition', 'id-comparison']) {
  if (!negKinds.has(kind)) {
    console.error(`FAIL: negative control not caught for '${kind}' (gate does not police it)`)
    process.exit(1)
  }
}
console.log(`REG03_NO_BRANCH_OK ids=${ids.length} partitions=${partitions.length} negative=caught`)
NODE
)"
    docker run --rm \
      -e REG03_SRC=/probe/src \
      -e REG03_REGISTRY=/probe/platforms.json \
      -e REG03_NEG=/tmp/reg03-negative \
      -e REG03_SCAN="$REG03_SCAN" \
      -v "$ROOT:/probe:ro" \
      "$VERIFY_IMAGE" bash -c 'node -e "$REG03_SCAN"'
    ;;
  emb03-cookie-scope)
    ensure_verify_image
    log "EMB-03 de-scope guard: declared-intent boolean, no fabricated recorder (Docker)"
    # EMB-03 narrowed to the validated thirdPartyCookies boolean (02-VERIFICATION
    # gap 2, documented API-less de-scope). Locks the narrowing: (1) the packet
    # field has no consumer outside its shared type declaration in engine source,
    # so a fabricated per-origin recorder cannot silently appear; (2) the decision
    # record carries the narrowed wording and the superseded per-origin-recording
    # claim is gone. Repo mounted read-only; no host tooling.
    docker run --rm -v "$ROOT/..:/repo:ro" "$VERIFY_IMAGE" bash -c '
      set -e
      status=0
      hits=$(grep -rn --exclude="*.test.ts" "thirdPartyCookies" /repo/desktop/src || true)
      bad=$(printf "%s\n" "$hits" | grep -v "src/shared/types.ts" | grep -v "^$" || true)
      if [ -n "$bad" ]; then
        echo "FAIL: thirdPartyCookies has a non-declaration consumer in engine source:" >&2
        echo "$bad" >&2
        status=1
      fi
      ctx=/repo/.planning/phases/02-gateway-engine/02-CONTEXT.md
      if ! grep -q "declared intent only" "$ctx"; then
        echo "FAIL: narrowed EMB-03 wording (declared intent only) missing from 02-CONTEXT.md" >&2
        status=1
      fi
      if grep -q "records cookie state per" "$ctx"; then
        echo "FAIL: superseded per-origin cookie-recording claim still present in 02-CONTEXT.md" >&2
        status=1
      fi
      [ "$status" -eq 0 ] || exit 1
      echo EMB03_COOKIE_SCOPE_OK
    '
    ;;
  shell-smoke)
    ensure_verify_image
    log "trusted-shell boot smoke: registry list over the trusted bridge (Docker + Xvfb)"
    in_container "bash scripts/shell-smoke.sh"
    ;;
  cold-start)
    ensure_verify_image
    log "cold-start timing lane: process-start -> SHELL_READY, numeric (Docker + Xvfb)"
    # INSTRUMENTATION proof only. The <1.5s desktop / <1.0s Android bars are
    # host/device human measurements; a software-rendered container number is NOT
    # the bar (docs/PERF-02-cold-start.md). Asserts a real, sane number only.
    in_container "bash scripts/cold-start.sh"
    ;;
  shell-test)
    ensure_verify_image
    log "shell typecheck + unit tests (Docker)"
    in_container "npm run typecheck && npm test && echo SHELL_TEST_OK"
    ;;
  ui-build)
    ensure_verify_image
    log "build + assert both preloads and the renderer emit (Docker)"
    in_container '
      npm run build >/dev/null
      for f in out/preload/index.js out/preload/shell.js out/renderer/index.html; do
        [ -f "$f" ] || { echo "FAIL: missing build artifact $f" >&2; exit 1; }
      done
      echo UI_BUILD_OK
    '
    ;;
  schema)
    ensure_verify_image
    log "regenerate platforms.schema.json from the zod Registry schema (Docker)"
    # Single source of truth: the committed platforms.schema.json is the exact
    # z.toJSONSchema(Registry) output. The vitest drift guard fails if it goes
    # stale; run this step and write its JSON to the file to refresh it.
    in_container "node scripts/generate-schema.ts"
    ;;
  shell-ipc-gate)
    ensure_verify_image
    log "trusted-IPC isolation + bridge-coverage static gate (Docker)"
    # SHL-01 enforcement:
    #  (a) raw ipcMain.handle appears ONLY in src/main/shell/ipc.ts
    #  (b) the provider preload (src/preload/index.ts) has no ipcRenderer/ipcMain
    #  (c) the shell preload uses contextBridge.exposeInMainWorld('gamingate')
    #  (d) assertTrustedShell references sender.id, senderFrame and mainFrame
    #  (e) bridge coverage: the IPC channels invoked in src/preload/shell.ts, the
    #      channels handled in src/main/shell/ipc.ts, and the methods declared on
    #      GamingateApi are the SAME set — no generic send/invoke(channel) passthrough.
    in_container "node scripts/gates/shell-ipc-gate.mjs /work/src"
    ;;
  shell-honesty)
    ensure_verify_image
    log "shell honesty gate: no DRM-tier literals, no network, no ESM dep (Docker)"
    # Honesty constraints (SHL-03/SHL-05):
    #  - No user-visible DRM-tier literals (L1/HD/4K) in renderer PRESENTATION
    #    files. The EME robustness probe module src/renderer/src/health/drm.ts and
    #    its test legitimately name HW_SECURE_ALL/SW_SECURE_DECODE as EME
    #    `robustness` identifiers, so they are EXEMPT by exact path (never a
    #    broad `health/` skip, never a repo-wide grep for HW_SECURE_ALL).
    #  - No network I/O imports in main/shell or renderer/src.
    #  - No electron-store (ESM-only) in package.json.
    in_container "bash scripts/gates/shell-honesty.sh /work/src /work/package.json"
    ;;
  decode-restart)
    ensure_verify_image
    log "decode re-init round-trip: persist + apply pre-ready on next launch (Docker + Xvfb)"
    # SHL-02 headline finding: a decode-mode change cannot happen at runtime —
    # it persists + relaunches. Two launches against one --user-data prove the
    # persisted mode disables HW acceleration BEFORE app ready, with a loop guard.
    in_container "bash scripts/decode-smoke.sh"
    ;;
  android-test)
    log "Android RegistryValidator JVM test ($ANDROID_IMAGE; Gradle $GRADLE_VERSION pinned)"
    # android commits no gradlew. The cirruslabs image ships the SDK but NO
    # Gradle, so the pinned distribution is fetched into the cache volume once.
    # The whole repo is staged into /work so the app's stageRegistryAssets task
    # can read ../desktop (one source of truth).
    docker run --rm \
      -v "$ROOT/..:/src:ro" \
      -v "$ANDROID_WORK_VOLUME:/work" \
      -v "$CACHE_VOLUME:/cache" \
      -e GRADLE_USER_HOME=/cache/gradle \
      -w /work \
      "$ANDROID_IMAGE" bash -lc '
        set -e
        DIST=/cache/gradle-dist/gradle-'"$GRADLE_VERSION"'/bin/gradle
        if [ ! -x "$DIST" ]; then
          mkdir -p /cache/gradle-dist
          curl -sSL -o /cache/gradle-dist/gradle.zip \
            https://services.gradle.org/distributions/gradle-'"$GRADLE_VERSION"'-bin.zip
          (cd /cache/gradle-dist && unzip -q gradle.zip && rm gradle.zip)
        fi
        export PATH="/cache/gradle-dist/gradle-'"$GRADLE_VERSION"'/bin:$PATH"
        rm -rf /work/android /work/desktop
        cp -r /src/android /work/android
        mkdir -p /work/desktop/test/fixtures
        cp /src/desktop/platforms.json /src/desktop/platforms.schema.json /work/desktop/
        cp /src/desktop/test/fixtures/invalid-platforms.json /work/desktop/test/fixtures/
        cd /work/android
        gradle :app:testDebugUnitTest --no-daemon --console=plain
      '
    ;;
  package-android)
    # Release APK: build + sign with a THROWAWAY dev keystore generated inside
    # the container under /tmp (never committed, never staged into the repo),
    # then emit the signed APK to the HOST-mounted android/dist/. The same
    # buildType serves production signing: CI passes the same Gradle properties
    # from secrets (docs/SIGNING.md, Plan 04-05) — no key material in the repo.
    log "Android release APK (assembleRelease, dev keystore) ($ANDROID_IMAGE; Gradle $GRADLE_VERSION pinned)"
    APK_OUT="$ROOT/../android/dist"
    mkdir -p "$APK_OUT"
    rm -f "$APK_OUT"/*.apk
    docker run --rm \
      -v "$ROOT/..:/src:ro" \
      -v "$ANDROID_WORK_VOLUME:/work" \
      -v "$CACHE_VOLUME:/cache" \
      -v "$APK_OUT:/out" \
      -e GRADLE_USER_HOME=/cache/gradle \
      -w /work \
      "$ANDROID_IMAGE" bash -lc '
        set -e
        DIST=/cache/gradle-dist/gradle-'"$GRADLE_VERSION"'/bin/gradle
        if [ ! -x "$DIST" ]; then
          mkdir -p /cache/gradle-dist
          curl -sSL -o /cache/gradle-dist/gradle.zip \
            https://services.gradle.org/distributions/gradle-'"$GRADLE_VERSION"'-bin.zip
          (cd /cache/gradle-dist && unzip -q gradle.zip && rm gradle.zip)
        fi
        export PATH="/cache/gradle-dist/gradle-'"$GRADLE_VERSION"'/bin:$PATH"
        rm -rf /work/android /work/desktop
        cp -r /src/android /work/android
        mkdir -p /work/desktop
        cp /src/desktop/platforms.json /src/desktop/platforms.schema.json /work/desktop/

        # Keystore hygiene gate (T-04-04/T-04-05): no signing material may live
        # under android/ at all — tracked or untracked. The dev keystore is
        # generated into the container /tmp, and a real release keystore is
        # supplied externally at build time (never checked in).
        SIGNING_HITS=$(find /work/android -type f \
          \( -name "*.keystore" -o -name "*.jks" \
             -o -name "keystore.properties" -o -name "signing.properties" \) || true)
        if [ -n "$SIGNING_HITS" ]; then
          echo "FAIL: signing material present under android/:" >&2
          echo "$SIGNING_HITS" >&2
          exit 1
        fi
        echo ANDROID_KEYSTORE_HYGIENE_OK

        # Throwaway dev signing key, container-local only. The password is read
        # from the environment by keytool (:env) and passed to Gradle as a build
        # property; it is never echoed and no key material enters the repo.
        KS=/tmp/gamingate-dev.keystore
        GAMINGATE_KS_PASS=gamingate-dev-throwaway
        export GAMINGATE_KS_PASS
        rm -f "$KS"
        keytool -genkeypair -keystore "$KS" \
          -storepass:env GAMINGATE_KS_PASS -keypass:env GAMINGATE_KS_PASS \
          -keyalg RSA -keysize 2048 -validity 10000 \
          -alias gamingate -dname "CN=Gamingate Dev"

        cd /work/android
        gradle :app:assembleRelease --no-daemon --console=plain \
          -Pgamingate.keystore.path="$KS" \
          -Pgamingate.keystore.password="$GAMINGATE_KS_PASS" \
          -Pgamingate.keystore.alias=gamingate

        rm -f /out/*.apk
        shopt -s nullglob
        apks=(app/build/outputs/apk/release/*.apk)
        if [ "${#apks[@]}" -ne 1 ]; then
          echo "FAIL: expected exactly one release APK, found ${#apks[@]}" >&2
          ls -la app/build/outputs/apk/release >&2 || true
          exit 1
        fi
        bytes=$(stat -c%s "${apks[0]}")
        if [ "$bytes" -le 1048576 ]; then
          echo "FAIL: release APK is not larger than 1 MB ($bytes bytes): ${apks[0]}" >&2
          exit 1
        fi
        cp "${apks[0]}" /out/gamingate-android-release.apk
        echo "ANDROID_APK_OK path=/out/gamingate-android-release.apk size=$bytes"
      '
    ;;
  package-appimage)
    # Real packaging: build the Linux AppImage with electron-builder on the
    # castlabs ECS runtime and emit it to the HOST-mounted $ROOT/dist/ (gitignored).
    # This does NOT use the verify image (no AppImage tooling); it runs the
    # electronuserland/builder image, which ships appimagetool/fpm.
    log "package Linux AppImage via electron-builder ($BUILDER_IMAGE; Docker)"
    mkdir -p "$DIST_DIR"
    rm -f "$DIST_DIR"/*.AppImage
    docker run --rm \
      --shm-size=2g \
      -e "ELECTRON_CACHE=/cache/electron" \
      -e "ELECTRON_BUILDER_CACHE=/cache/electron-builder" \
      -e "npm_config_cache=/cache/npm" \
      -v "$ROOT:/src:ro" \
      -v "$WORK_VOLUME:/work" \
      -v "$CACHE_VOLUME:/cache" \
      -v "$DIST_DIR:/out" \
      -w /work \
      "$BUILDER_IMAGE" bash -lc '
        set -e
        cp -r /src/. /work/
        rm -rf /work/dist
        cd /work
        # --legacy-peer-deps: builder:22 ships npm 10.9.7 (arborist crashes with
        # "Cannot read properties of null (reading edgesOut)") resolving vitest
        # 4.x optional peers (@vitejs/devtools) on a clean install.
        npm install --no-audit --no-fund --prefer-offline --legacy-peer-deps
        # The castlabs fork ships its own install.js; npm may skip the postinstall,
        # leaving node_modules/electron/dist empty and breaking electronDist.
        node node_modules/electron/install.js
        npm run build
        # Build every linux target in config (AppImage + deb).
        npx electron-builder --linux --publish never
        mkdir -p /out
        rm -f /out/*.AppImage /out/*.deb
        cp /work/dist/*.AppImage /out/
        if ls /work/dist/*.deb >/dev/null 2>&1; then cp /work/dist/*.deb /out/; fi
        shopt -s nullglob
        files=(/out/*.AppImage)
        if [ "${#files[@]}" -ne 1 ]; then
          echo "FAIL: expected exactly one AppImage in /out, found ${#files[@]}" >&2
          ls -la /out >&2 || true
          exit 1
        fi
        bytes=$(stat -c%s "${files[0]}")
        if [ "$bytes" -le 41943040 ]; then
          echo "FAIL: AppImage is not larger than 40 MB ($bytes bytes): ${files[0]}" >&2
          exit 1
        fi
        echo "APPIMAGE_OK path=${files[0]} size=$bytes"
        for deb in /out/*.deb; do
          echo "DEB_OK path=$deb size=$(stat -c%s "$deb")"
        done
      '
    ;;
  ci-config)
    # Static contract gate for the Phase 4 workflows (PKG-01/PKG-02,
    # T-04-09/T-04-10): the four-job graph + needs edges, tag-gating, the nightly
    # `smoke luna`, and the no-inlined / no-secret-in-run rule. Docs/CI.md advertises
    # that this gate "fails the build", so it MUST run in the lint-test job. Reads the
    # workflow YAML from /repo (the whole checkout, read-only); no install needed.
    ensure_verify_image
    log "CI workflow contract gate (Docker)"
    docker run --rm \
      -v "$ROOT/..:/repo:ro" \
      "$VERIFY_IMAGE" \
      node /repo/desktop/scripts/gates/ci-config-gate.mjs /repo
    ;;
  package-desktop-config)
    # Static honesty gate: AppImage + deb + nsis targets, electron-updater as a
    # runtime dependency, the castlabs ECS runtime pinned (NOT stock Electron),
    # and a generic publish feed present. Read-only mount; no install needed.
    ensure_verify_image
    log "static desktop packaging config gate (Docker)"
    docker run --rm \
      -v "$ROOT:/probe:ro" \
      "$VERIFY_IMAGE" node /probe/scripts/gates/desktop-config-gate.mjs /probe
    ;;
  *)
    log "unknown step: $STEP"
    exit 2
    ;;
esac
