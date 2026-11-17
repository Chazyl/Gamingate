/**
 * Trusted-shell IPC channel names (SHL-01).
 *
 * Deliberately zod-free and dependency-free: the sandboxed shell PRELOAD imports
 * these VALUES, and a sandboxed preload cannot `require()` node_modules. Keeping
 * the channel constants out of `shell-contract.ts` (which imports zod) means the
 * preload bundle stays self-contained. `shell-contract.ts` re-exports this for
 * main/renderer callers.
 */
export const IPC = {
  listPlatforms: 'gamingate:list-platforms',
  launch: 'gamingate:launch',
  stop: 'gamingate:stop',
  clearProvider: 'gamingate:clear-provider',
  sessionState: 'gamingate:session-state',
  setOverlay: 'gamingate:set-overlay',
  getPrefs: 'gamingate:get-prefs',
  setPrefs: 'gamingate:set-prefs',
  // Decode mode / codec force are real re-inits (SHL-02): persist + relaunch.
  getDecodeState: 'gamingate:decode-state',
  setDecodeMode: 'gamingate:set-decode-mode',
  setCodecForce: 'gamingate:set-codec-force',
  // Main -> trusted-renderer push: a gaming-mode chord was blocked (INP-03).
  chordBlocked: 'gamingate:chord-blocked',
  // Main -> trusted-renderer push: the latest honest stream-health snapshot (SHL-03).
  health: 'gamingate:health'
} as const
