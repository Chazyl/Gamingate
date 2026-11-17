/**
 * Renderer sandbox gate.
 *
 * Chromium aborts a SANDBOXED renderer with
 *   FATAL:electron_main_delegate.cc  Running as root without --no-sandbox is not supported
 * when the process runs as root and the renderer requests the OS sandbox. In the
 * dev/container lane we run as root and pass `--no-sandbox` (which disables the
 * sandbox for the browser and its children), so the renderer must not also ask
 * for the sandbox or it aborts and the page renders blank.
 *
 * Production runs as a normal user without `--no-sandbox`, so the renderer
 * sandbox stays on.
 */
export function rendererSandboxEnabled(argv: readonly string[] = process.argv): boolean {
  return !argv.includes('--no-sandbox')
}
