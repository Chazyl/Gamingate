#!/usr/bin/env node
/**
 * Trusted-IPC isolation + bridge-coverage static gate (SHL-01).
 *
 * Enforced here (run in the container-only verify image by docker-verify.sh):
 *  (a) raw ipcMain.handle appears ONLY in src/main/shell/ipc.ts
 *  (b) the provider preload (src/preload/index.ts) has no ipcRenderer/ipcMain
 *  (c) the shell preload exposes the named `gamingate` bridge
 *  (d) assertTrustedShell references sender.id, senderFrame and mainFrame
 *  (e) bridge coverage: channels invoked in the shell preload == channels handled
 *      in main == methods declared on GamingateApi; no generic passthrough.
 *
 * Receives the probe src root as argv[2].
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = process.argv[2]
if (!SRC) {
  console.error('usage: shell-ipc-gate.mjs <src-root>')
  process.exit(2)
}

const failures = []
const read = (p) => readFileSync(join(SRC, p), 'utf8')

/** Strip // line comments and block comments so prose about IPC is not scanned. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

// (a) raw ipcMain.handle only in the allowlist module (comments stripped).
const allowlist = join(SRC, 'main/shell/ipc.ts')
for (const file of walk(SRC)) {
  if (file === allowlist) continue
  if (/ipcMain\.handle/.test(stripComments(readFileSync(file, 'utf8')))) {
    failures.push(`raw ipcMain.handle outside src/main/shell/ipc.ts: ${file}`)
  }
}

// (b) provider preload inert (comments stripped).
const provider = stripComments(read('preload/index.ts'))
if (/ipcRenderer|ipcMain/.test(provider)) {
  failures.push('provider preload references IPC (must be inert)')
}

// (c) shell preload exposes the named gamingate bridge.
const preload = read('preload/shell.ts')
if (!/exposeInMainWorld\(\s*'gamingate'/.test(preload)) {
  failures.push('shell preload does not exposeInMainWorld("gamingate")')
}

// (d) allowlist uses identity + frame checks (comments stripped).
const ipc = stripComments(read('main/shell/ipc.ts'))
for (const token of ['sender.id', 'senderFrame', 'mainFrame']) {
  if (!ipc.includes(token)) failures.push(`assertTrustedShell missing ${token}`)
}

// (e) bridge coverage.
const contract = read('shared/shell-contract.ts')
const keyToChannel = {}
for (const m of contract.matchAll(/^\s*(\w+):\s*'([^']+)'/gm)) keyToChannel[m[1]] = m[2]

const invoked = new Set()
for (const m of preload.matchAll(/ipcRenderer\.invoke\(IPC\.(\w+)/g)) invoked.add(keyToChannel[m[1]])
const handled = new Set()
for (const m of ipc.matchAll(/handleTrusted\(IPC\.(\w+)/g)) handled.add(keyToChannel[m[1]])

if (/ipcRenderer\.send\(/.test(preload)) {
  failures.push('shell preload uses ipcRenderer.send (generic passthrough)')
}
if (/ipcRenderer\.invoke\((?!IPC\.)/.test(preload)) {
  failures.push('shell preload invokes a non-IPC.* channel (passthrough)')
}

const iface = contract.match(/interface GamingateApi\s*\{([\s\S]*?)\n\}/)
if (!iface) {
  failures.push('GamingateApi interface not found')
} else {
  const declared = new Set()
  for (const m of iface[1].matchAll(/^\s*(\w+)\s*[:(]/gm)) declared.add(m[1])
  const exposed = new Set()
  for (const m of preload.matchAll(/^\s*(\w+)\s*:/gm)) exposed.add(m[1])
  const missing = [...declared].filter((m) => !exposed.has(m))
  const extra = [...exposed].filter((m) => !declared.has(m))
  if (missing.length) failures.push(`GamingateApi methods not exposed: ${missing.join(', ')}`)
  if (extra.length) failures.push(`shell preload exposes non-API methods: ${extra.join(', ')}`)
}

const onlyInvoked = [...invoked].filter((c) => !handled.has(c))
const onlyHandled = [...handled].filter((c) => !invoked.has(c))
if (onlyInvoked.length) failures.push(`channels invoked with no handler: ${onlyInvoked.join(', ')}`)
if (onlyHandled.length) failures.push(`handlers with no preload bridge: ${onlyHandled.join(', ')}`)

if (failures.length) {
  console.error('FAIL: shell-ipc-gate')
  for (const f of failures) console.error('  - ' + f)
  process.exit(1)
}
console.log(`SHELL_IPC_GATE_OK invoked=${invoked.size} handled=${handled.size}`)
