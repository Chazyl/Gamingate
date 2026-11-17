#!/usr/bin/env bash
# Shell honesty gate (SHL-03/SHL-05), run in the container-only verify image.
#
#  - No user-visible DRM-tier literals (L1/HD/4K) in renderer PRESENTATION files.
#    The EME robustness probe module src/renderer/src/health/drm.ts (and its test)
#    legitimately name HW_SECURE_ALL/SW_SECURE_DECODE as EME `robustness`
#    identifiers, so they are EXEMPT by EXACT PATH — never a broad `health/` skip,
#    and never a repo-wide grep for HW_SECURE_ALL.
#  - No network I/O imports/calls in main/shell or renderer/src.
#  - No electron-store (ESM-only) dependency in package.json.
set -euo pipefail

SRC="${1:?usage: shell-honesty.sh <src-root> [package.json]}"
PKG="${2:-$(dirname "$SRC")/../package.json}"
status=0

# User-visible DRM-tier literals (L1/HD/4K) in renderer PRESENTATION modules.
# Both `.ts` and `.tsx` are scanned: `.ts` modules (format.ts, decode.ts, …) feed
# visible UI copy too, so scanning only `*.tsx` left the invariant unprotected.
# The EME robustness probe src/renderer/src/health/drm.ts and its test legitimately
# name these as EME identifiers, so they are EXEMPT by EXACT PATH — never a broad
# `health/` skip.
scan_drm_literals() {
  local root="$1"
  grep -rnE '\b(L1|HD|4K)\b' "$root/renderer/src" \
    --include='*.ts' --include='*.tsx' 2>/dev/null \
    | grep -vE "renderer/src/health/drm\.test\.ts:" \
    | grep -vE "renderer/src/health/drm\.ts:" \
    | grep -v "^$" || true
}

bad=$(scan_drm_literals "$SRC")
if [ -n "$bad" ]; then
  echo "FAIL: user-visible DRM-tier literal (L1/HD/4K) in renderer:" >&2
  echo "$bad" >&2
  status=1
fi

# Negative control: the scan MUST catch a DRM-tier literal in a presentation
# `.ts` module (the pre-fix `--include='*.tsx'` gate missed it) and MUST exempt
# the exact drm.ts / drm.test.ts paths. The gate passes only when it both finds
# the real tree clean AND polices this shape.
neg="$(mktemp -d)"
mkdir -p "$neg/renderer/src/settings" "$neg/renderer/src/health"
printf "export const tier = 'L1'\n" >"$neg/renderer/src/settings/evil.ts"
printf "export const tier = '4K'\n" >"$neg/renderer/src/health/drm.ts"
printf "expect(value).not.toMatch(/L1|HD|4K/)\n" >"$neg/renderer/src/health/drm.test.ts"
neg_hits=$(scan_drm_literals "$neg")
rm -rf "$neg"
if ! printf '%s\n' "$neg_hits" | grep -q "settings/evil.ts:"; then
  echo "FAIL: negative control (DRM-tier literal in a .ts module) was not caught" >&2
  status=1
fi
if printf '%s\n' "$neg_hits" | grep -qE "health/drm(\.test)?\.ts:"; then
  echo "FAIL: exact-path EME exemption did not suppress the legitimate drm module" >&2
  echo "$neg_hits" >&2
  status=1
fi

# no network I/O in the shell engine or renderer
net=$(grep -rnE "from '(axios|node:http|node:https|node:net)'|[^.]\bfetch\(" \
  "$SRC/main/shell" "$SRC/renderer/src" 2>/dev/null || true)
if [ -n "$net" ]; then
  echo "FAIL: network I/O import/call in main/shell or renderer/src:" >&2
  echo "$net" >&2
  status=1
fi

# no ESM-only electron-store dependency
if grep -q "electron-store" "$PKG" 2>/dev/null; then
  echo "FAIL: package.json declares electron-store (ESM-only, CJS bundle)" >&2
  status=1
fi

[ "$status" -eq 0 ] || exit 1
echo SHELL_HONESTY_OK
