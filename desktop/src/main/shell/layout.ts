export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ShellLayout {
  shell: Bounds
  provider: Bounds | null
}

/**
 * Multi-view bounds (SHL-01). The shell view is the PRIMARY surface when no
 * provider is live (the startup picker/settings), and only a top chrome bar
 * while a session runs. Getting this wrong leaves the shell at zero height and
 * the window blank — the bug this function exists to pin down.
 */
export function computeShellLayout(opts: {
  width: number
  height: number
  hasProvider: boolean
  chromeVisible: boolean
  htmlFullScreen: boolean
  chromeBarHeight: number
}): ShellLayout {
  const { width, height, hasProvider, chromeVisible, htmlFullScreen, chromeBarHeight } = opts
  if (!hasProvider) {
    return { shell: { x: 0, y: 0, width, height }, provider: null }
  }
  const bar = chromeVisible && !htmlFullScreen ? chromeBarHeight : 0
  return {
    shell: { x: 0, y: 0, width, height: bar },
    provider: { x: 0, y: bar, width, height: height - bar }
  }
}
