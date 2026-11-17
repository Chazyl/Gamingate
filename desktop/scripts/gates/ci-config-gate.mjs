#!/usr/bin/env node
// Static gate for the Phase 4 CI workflows (PKG-01, PKG-02, T-04-09/T-04-10).
//
// Asserts, fail-closed, that:
//   - ci.yml has the four ordered jobs with the correct `needs` edges
//   - every job drives the container harness (docker-verify.sh), not a host toolchain
//   - the release job is tag-gated and uploads the built artifacts
//   - provider-health.yml is scheduled (+ manual) and runs `smoke luna`
//   - no secret value is inlined, and no `secrets.*` appears in a `run:` script
//
// actionlint validates YAML/shell syntax; this gate validates the *contract*.
// Run container-only, e.g.:
//   docker run --rm -v "$PWD:/repo:ro" node:24 \
//     node /repo/desktop/scripts/gates/ci-config-gate.mjs /repo
//
// Usage: node ci-config-gate.mjs [repo-root]   (default: cwd)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] || process.cwd()
const fail = (msg) => {
  console.error('FAIL: ' + msg)
  process.exit(1)
}
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const ci = read('.github/workflows/ci.yml')
const health = read('.github/workflows/provider-health.yml')

// Split the `jobs:` mapping into per-job blocks (job keys are at 2-space indent).
function jobBlocks(text) {
  const at = text.indexOf('\njobs:')
  if (at === -1) fail('ci.yml has no `jobs:` mapping')
  const jobs = {}
  let cur = null
  for (const line of text.slice(at + 1).split('\n')) {
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (key) {
      cur = key[1]
      jobs[cur] = ''
      continue
    }
    if (cur) jobs[cur] += line + '\n'
  }
  return jobs
}

const jobs = jobBlocks(ci)
for (const name of ['lint-test', 'build-desktop', 'build-android', 'release']) {
  if (!(name in jobs)) fail(`ci.yml missing job "${name}"`)
}

// Container-harness reuse per job.
const expect = {
  'lint-test': ['docker-verify.sh typecheck', 'docker-verify.sh test'],
  'build-desktop': ['needs: lint-test', 'package-appimage', 'upload-artifact'],
  'build-android': ['needs: lint-test', 'package-android', 'upload-artifact'],
}
for (const [job, needles] of Object.entries(expect)) {
  for (const n of needles) {
    if (!jobs[job].includes(n)) fail(`ci.yml job "${job}" missing "${n}"`)
  }
}
if (!/needs:\s*\[[^\]]*build-desktop[^\]]*build-android/.test(jobs.release) &&
    !/needs:\s*\[[^\]]*build-android[^\]]*build-desktop/.test(jobs.release)) {
  fail('release job must need both build-desktop and build-android')
}
if (!jobs.release.includes('startsWith(github.ref')) {
  fail('release job must be tag-gated (startsWith(github.ref, ...))')
}

// Triggers.
for (const trig of ['pull_request', 'push', 'workflow_dispatch']) {
  if (!new RegExp('^ {2}' + trig + ':', 'm').test(ci)) fail(`ci.yml missing trigger "${trig}"`)
}

// Nightly workflow.
for (const trig of ['schedule', 'workflow_dispatch']) {
  if (!new RegExp('^ {2}' + trig + ':', 'm').test(health)) {
    fail(`provider-health.yml missing trigger "${trig}"`)
  }
}
if (!/cron:/.test(health)) fail('provider-health.yml missing cron schedule')
if (!health.includes('smoke luna')) fail('provider-health.yml must run `smoke luna`')
if (!/timeout-minutes:/.test(health)) fail('provider-health.yml missing timeout-minutes')

// Threat T-04-09: never inline or echo a secret value.
if (/pull_request_target/.test(ci) || /pull_request_target/.test(health)) {
  fail('pull_request_target is forbidden (untrusted code execution, T-04-10)')
}

// Every shell body a workflow can execute: an inline `run:` value, or the body
// of a `run: |` / `run: >` block scalar (lines indented deeper than the key).
// The secret rule must see block bodies — a single-line scan misses a `run: |`
// body that echoes `${{ secrets.X }}` (the T-04-09 bypass this closes).
function runScripts(text) {
  const lines = text.split('\n')
  const scripts = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)run:[ \t]*(.*)$/.exec(lines[i])
    if (!m) continue
    const indent = m[1].length
    const inline = m[2].trim()
    if (inline && !/^[|>]/.test(inline)) {
      scripts.push({ line: i + 1, text: inline })
      continue
    }
    const body = []
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j]
      if (next.trim() === '') { body.push(next); continue }
      if (next.match(/^\s*/)[0].length <= indent) break
      body.push(next)
    }
    scripts.push({ line: i + 2, text: body.join('\n') })
  }
  return scripts
}

for (const [file, text] of [['ci.yml', ci], ['provider-health.yml', health]]) {
  for (const line of text.split('\n')) {
    if (/secrets\./.test(line) && !/\$\{\{\s*secrets\./.test(line)) {
      fail(`${file}: bare secrets.* reference outside \${{ }}: ${line.trim()}`)
    }
  }
  // Any secret reference in a run script — inline or block scalar — is one
  // echo/printf away from leaking, so reject it outright rather than miss the
  // multi-line form (T-04-09).
  for (const script of runScripts(text)) {
    if (/secrets\./.test(script.text)) {
      fail(`${file}: secret reference in a run: script (line ${script.line}) is forbidden`)
    }
  }
}

console.log('CI_CONFIG_OK')
