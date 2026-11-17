const { chmodSync, existsSync } = require('node:fs')
const { join } = require('node:path')

/**
 * electron-builder afterPack hook.
 *
 * Linux packaging norm: the Chromium sandbox helper (`chrome-sandbox`) must be
 * SETUID root (mode 4755), otherwise Chromium refuses to use it and the app is
 * forced to run unsandboxed. electron-builder does not always preserve the
 * setuid bit, so enforce it on the packaged tree here (the .deb preserves file
 * modes; the AppImage cannot — it relies on unprivileged user namespaces, which
 * is why the AppImage must be run on a host that allows them).
 */
module.exports = async function afterPack(context) {
  const sandbox = join(context.appOutDir, 'chrome-sandbox')
  if (existsSync(sandbox)) {
    try {
      chmodSync(sandbox, 0o4755)
    } catch {
      // Best effort: on a filesystem that forbids setuid this is a no-op and the
      // app falls back to the user-namespace sandbox.
    }
  }
}
