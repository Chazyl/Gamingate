import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    // Preloads are bundled (only `electron` stays external): a SANDBOXED
    // renderer preload cannot `require()` node_modules, so leaving deps external
    // (e.g. zod via the shared shell contract) makes the preload fail to load in
    // the packaged app and the renderer shows a blank/black window. Bundling
    // inlines those pure-JS deps; `electron` is provided by the runtime.
    build: {
      rollupOptions: {
        external: ['electron'],
        input: {
          // Two distinct preloads: the INERT provider bridge and the trusted
          // shell bridge. The provider view is handed `index.js`; the shell
          // view is handed `shell.js` (SHL-01).
          index: resolve(__dirname, 'src/preload/index.ts'),
          shell: resolve(__dirname, 'src/preload/shell.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
