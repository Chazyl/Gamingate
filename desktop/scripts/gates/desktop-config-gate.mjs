#!/usr/bin/env node
// Static honesty gate for Phase 4 desktop packaging config (PKG-01, T-04-01).
//
// Asserts, fail-closed:
//   - electron-builder targets AppImage + deb + nsis
//   - electron-updater is a RUNTIME dependency (not dev)
//   - the castlabs ECS runtime is still pinned (NOT swapped for stock Electron),
//     and electronDist points electron-builder at the ECS binaries already on disk
//   - no placeholder publish feed baked in; updater gated at runtime (PKG-01)
//
// Usage: node desktop-config-gate.mjs <app-dir>   (default: cwd)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] || process.cwd()
const fail = (msg) => {
  console.error('FAIL: ' + msg)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const yml = readFileSync(join(root, 'electron-builder.yml'), 'utf8')

if (!(pkg.dependencies || {})['electron-updater']) {
  fail('electron-updater missing from dependencies')
}

const electron = (pkg.devDependencies || {}).electron || ''
// Version-agnostic: accept any castlabs `+wvcus` release tag (a legitimate ECS
// bump must not fail the gate) while still rejecting stock/semver specs.
if (!/castlabs\/electron-releases#v\d+\.\d+\.\d+\+wvcus/.test(electron)) {
  fail(`castlabs ECS runtime not pinned (electron="${electron}")`)
}
// A bare semver spec (e.g. "^44.0.0") means stock Electron was swapped in.
if (/^[\^~]?\d/.test(electron)) {
  fail(`stock Electron spec detected (electron="${electron}")`)
}
// The load-bearing line: without electronDist electron-builder downloads stock
// Electron from GitHub instead of packaging the ECS binaries (docs/packaging.md).
// Removing only this line defeats the pin, so assert it explicitly.
if (!/electronDist:\s*node_modules\/electron\/dist/.test(yml)) {
  fail('electronDist must point at the castlabs ECS dist (node_modules/electron/dist)')
}

for (const target of ['AppImage', 'deb', 'nsis']) {
  if (!yml.includes(target)) fail(`target "${target}" missing from electron-builder.yml`)
}
// Community norm: a local/unsigned build must NOT bake a placeholder update feed
// (that would make the packaged app phone home to a non-existent host). The real
// feed is supplied by release CI via `--publish`; the updater is gated at runtime
// on a real app-update.yml URL.
if (/publish:/.test(yml) && yml.includes('.invalid')) {
  fail('placeholder publish feed must not be baked into the packaged config')
}
// chrome-sandbox must be setuid in the packaged tree (Linux sandbox norm).
if (!/afterPack:\s*build\/after-pack\.cjs/.test(yml)) {
  fail('afterPack setuid hook (build/after-pack.cjs) missing')
}
// The sandbox must never be disabled by a baked-in flag.
if (/--no-sandbox/.test(yml)) fail('--no-sandbox must not be baked into packaging config')

console.log('DESKTOP_CONFIG_OK')
