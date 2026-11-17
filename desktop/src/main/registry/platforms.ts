import { readFileSync } from 'node:fs'
// electron-vite JSON-as-path import: the registry stays a real bundled file,
// never an object inlined into the bundle (keeps "file-based, never remote").
import registryPath from '../../../platforms.json?commonjs-external&asset'
import { parseRegistry, type Registry } from '../../shared/types'

/**
 * Read + schema-validate the bundled registry synchronously.
 *
 * MUST be called before `app.whenReady()`: any schema failure aborts startup
 * before a single WebContentsView can exist (REG-01, fail closed). On failure
 * the thrown Error carries the z.prettifyError text naming the offending field.
 */
export function readRegistrySync(): Registry {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(registryPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `unable to read bundled registry at ${registryPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
  return parseRegistry(raw)
}
