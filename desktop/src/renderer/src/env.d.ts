/// <reference types="vite/client" />
import type { GamingateApi } from '../../shared/shell-contract'

/**
 * Renderer ambient types: Vite client (CSS imports, `import.meta.env`) and the
 * trusted shell bridge exposed by src/preload/shell.ts.
 */
declare global {
  interface Window {
    gamingate?: GamingateApi
  }
}

export {}
