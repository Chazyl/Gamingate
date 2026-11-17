import type { GamingateApi } from '../../shared/shell-contract'

/**
 * Typed wrapper around the trusted shell bridge exposed by src/preload/shell.ts.
 * Fails loudly if the bridge is absent (e.g. the page loaded without the shell
 * preload) rather than letting callers hit an undefined method.
 */
export function getGamingate(): GamingateApi {
  const api = (window as unknown as { gamingate?: GamingateApi }).gamingate
  if (!api) throw new Error('gamingate bridge unavailable — not the trusted shell surface')
  return api
}
