import { contextBridge } from 'electron'
import { decodePlatformSpoof, PLATFORM_SPOOF_ARG } from '../shared/platform-spoof'

/**
 * INERT provider preload (SHL-01).
 *
 * This is the bridge handed to the provider `WebContentsView`. It carries NO
 * IPC surface at all — nothing that can reach a privileged handler. Provider
 * content must never be able to touch the trusted shell bridge (threat
 * T-03-01); `shell-ipc-gate` asserts this file is inert.
 */
const providerBridge = Object.freeze({
  phase: 'provider-isolated'
})

contextBridge.exposeInMainWorld('gamingateProbe', providerBridge)

/**
 * Per-platform OS spoof (opt-in). Some providers block Linux outright, so when
 * the packet declares `platformSpoof`, main passes it as an
 * `additionalArguments` entry. We decode it and inject the overrides into the
 * MAIN world at preload time, BEFORE any page script runs, so
 * `navigator.platform`, `navigator.userAgentData`, and the Client Hints stay
 * mutually consistent. `executeInMainWorld` only executes code — it adds no IPC
 * surface, so this preload stays inert.
 */
const spoofArg = process.argv.find((arg) => arg.startsWith(PLATFORM_SPOOF_ARG))
const spoof = spoofArg ? decodePlatformSpoof(spoofArg) : null

if (spoof) {
  contextBridge.executeInMainWorld({
    // Serialized and run in the main world: self-contained, references only its
    // argument and standard globals.
    func: (payload: { platform: string; platformVersion: string }): void => {
      const { platform, platformVersion } = payload
      const major = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? '152'
      const brands = [
        { brand: 'Not_A Brand', version: '24' },
        { brand: 'Chromium', version: major },
        { brand: 'Google Chrome', version: major }
      ]
      const define = (target: object, key: string, value: unknown): void => {
        Object.defineProperty(target, key, { configurable: true, enumerable: true, value })
      }
      define(navigator, 'platform', 'Win32')
      define(navigator, 'userAgentData', {
        brands,
        mobile: false,
        platform,
        platformVersion,
        getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> {
          const high: Record<string, unknown> = {
            architecture: 'x86',
            bitness: '64',
            brands,
            fullVersionList: brands.map((brand) => ({
              brand: brand.brand,
              version: brand.brand === 'Not_A Brand' ? '24.0.0.0' : `${major}.0.0.0`
            })),
            mobile: false,
            model: '',
            platform,
            platformVersion,
            uaFullVersion: `${major}.0.0.0`,
            wow64: false
          }
          const values: Record<string, unknown> = {}
          for (const hint of hints) {
            if (hint in high) values[hint] = high[hint]
          }
          return Promise.resolve(values)
        },
        toJSON(): Record<string, unknown> {
          return { brands, mobile: false, platform }
        }
      })
    },
    args: [spoof]
  })
}
