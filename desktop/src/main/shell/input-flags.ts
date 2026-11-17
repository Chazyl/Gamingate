/**
 * Pre-ready input-throughput flags (PERF-03, 03-RESEARCH "Gamepad Passthrough
 * >120Hz").
 *
 * Chromium's browser-side gamepad provider polls at ~250 Hz; renderer/occlusion
 * throttling can starve it. These switches are process-lifetime and MUST be
 * appended before `app.whenReady()` resolves. `backgroundThrottling:false` on
 * the provider view is the per-view complement (view-manager.ts, at creation).
 *
 * Idempotent: a switch already present on the command line is not re-appended.
 */
export interface CommandLineLike {
  appendSwitch: (key: string, value?: string) => void
  hasSwitch?: (key: string) => boolean
}

export const INPUT_THROTTLING_SWITCHES = [
  'disable-background-timer-throttling',
  'disable-renderer-backgrounding',
  'disable-backgrounding-occluded-windows'
] as const

/** Windows-only: stop the OS from treating an occluded window as hidden. */
export const WINDOWS_OCCLUSION_FEATURE = 'CalculateNativeWinOcclusion'

export function applyInputThrottlingFlags(
  commandLine: CommandLineLike,
  platform: NodeJS.Platform = process.platform
): void {
  for (const flag of INPUT_THROTTLING_SWITCHES) {
    if (commandLine.hasSwitch?.(flag) !== true) commandLine.appendSwitch(flag)
  }
  if (platform === 'win32' && commandLine.hasSwitch?.('disable-features') !== true) {
    commandLine.appendSwitch('disable-features', WINDOWS_OCCLUSION_FEATURE)
  }
}
