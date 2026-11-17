import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

type Ladder = Record<string, string>

/**
 * EME config ladder (RESEARCH.md Pattern 3). Presence of the Widevine key system
 * proves nothing; the probe tests CONFIGS. hwSecure/HW_SECURE_ALL and
 * swSecure/SW_SECURE_DECODE outcomes are committed verbatim into the lane
 * evidence. A green Rung-1 Shaka demo plus a red Rung-2 Luna session points at
 * entitlement/auth, not CDM failure (D-05 is the pass bar, not this readout).
 */
async function probeWidevine(): Promise<Ladder> {
  const out: Ladder = {}
  const configs: Array<[string, string]> = [
    ['hwSecure', 'HW_SECURE_ALL'],
    ['swSecure', 'SW_SECURE_DECODE']
  ]

  for (const [label, robustness] of configs) {
    try {
      const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [
        {
          initDataTypes: ['cenc'],
          videoCapabilities: [{ contentType: 'video/mp4;codecs="avc1.42E01E"', robustness }]
        }
      ])
      const capability = access.getConfiguration().videoCapabilities?.[0]
      out[label] = capability?.robustness ?? 'granted'
    } catch (error) {
      out[label] = `rejected: ${(error as DOMException).name}`
    }
  }
  return out
}

export function Probe(): ReactElement {
  const [ladder, setLadder] = useState<Ladder | null>(null)

  useEffect(() => {
    let cancelled = false
    probeWidevine().then((result) => {
      if (!cancelled) setLadder(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main>
      <h1>Gamingate DRM probe</h1>
      <p>MediaKeySystemAccess ladder (com.widevine.alpha):</p>
      <pre id="eme-ladder">{JSON.stringify(ladder, null, 2)}</pre>
      <p>
        Rung 1: <a href="https://shaka-player-demo.appspot.com/">hosted Shaka demo</a>
        {' | '}
        Rung 2: <a href="https://luna.amazon.com/">licensed Luna title</a>
      </p>
    </main>
  )
}
