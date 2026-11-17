/**
 * Honest DRM capability (SHL-03, UI-SPEC Honesty Constraint 1).
 *
 * The EME robustness ladder (Phase 1) tests two CONFIGS — a high-robustness
 * rung and an SW_SECURE_DECODE rung. A granted config is NOT a displayable tier:
 * Android WebView is L3-only, so the overlay is capped at `L3 (SW_SECURE)` and
 * everything else is `Unknown`. This module is the ONE place EME robustness
 * identifiers live; presentation files only ever see the capped label.
 */

export type DrmCapability = 'L3 (SW_SECURE)' | 'Unknown'

/**
 * Cap an EME ladder outcome. `hwSecure`/`swSecure` are grant booleans from the
 * two robustness configs; a grant on either rung yields the same honest
 * L3/SW_SECURE label, and no grant yields Unknown. Never returns a higher tier.
 */
export function capDrm(hwSecure: boolean, swSecure: boolean): DrmCapability {
  return hwSecure || swSecure ? 'L3 (SW_SECURE)' : 'Unknown'
}

/**
 * Probe the Widevine EME ladder and return the capped capability. Never throws:
 * a host without EME (e.g. the headless test lane) reports Unknown.
 */
export async function probeDrm(): Promise<DrmCapability> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.requestMediaKeySystemAccess !== 'function'
  ) {
    return 'Unknown'
  }

  const rungs: Array<[string, string]> = [
    ['hwSecure', 'HW_SECURE_ALL'],
    ['swSecure', 'SW_SECURE_DECODE']
  ]
  const granted: Record<string, boolean> = { hwSecure: false, swSecure: false }

  for (const [label, robustness] of rungs) {
    try {
      await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
        {
          initDataTypes: ['cenc'],
          videoCapabilities: [{ contentType: 'video/mp4;codecs="avc1.42E01E"', robustness }]
        }
      ])
      granted[label] = true
    } catch {
      granted[label] = false
    }
  }

  return capDrm(granted.hwSecure, granted.swSecure)
}
