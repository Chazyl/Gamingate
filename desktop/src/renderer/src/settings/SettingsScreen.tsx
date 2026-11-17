import { useState } from 'react'
import type { ReactElement } from 'react'
import type { CodecForce, PlatformSummary, Prefs } from '../../../shared/shell-contract'
import { Badge, Button, SegmentedControl, type SegmentedOption } from '../ui/primitives'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Toast } from '../ui/Toast'
import { getGamingate } from '../ipc'
import { ShortcutsReference } from './ShortcutsReference'
import { DecodeControl } from './DecodeControl'

/**
 * Settings surface (UI-SPEC Surface 3, SHL-02/SHL-05).
 *
 * Codec force is a persisted, provider-dependent HINT — the provider negotiates
 * the actual codec, so the UI never asserts a codec change. Options outside the
 * packet's `codecHints` are disabled with a reason. Changing codec force (or
 * decode mode) is a real re-init: it persists and restarts Gamingate, confirming
 * only when a session is live. Third-party cookies and UA are read-only facts;
 * Clear data is destructive and gated by ConfirmDialog.
 */
const CODEC_OPTIONS: Array<{ value: CodecForce; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'h264', label: 'H.264' },
  { value: 'vp9', label: 'VP9' },
  { value: 'av1', label: 'AV1' }
]

export interface SettingsScreenProps {
  platforms: PlatformSummary[]
  prefs: Prefs | null
  onRequestClear: (platform: PlatformSummary) => void
  onBack: () => void
  /** True while a session is starting/running: decode/codec changes must confirm. */
  sessionLive?: boolean
}

function codecOptionsFor(platform: PlatformSummary): SegmentedOption[] {
  const hints = platform.codecHints
  return CODEC_OPTIONS.map((option) => {
    // Auto is always offered; a concrete codec is offered only when the packet
    // declares no hints (unknown => do not over-constrain) or the hint includes it.
    const offered =
      option.value === 'auto' || hints.length === 0 || hints.includes(option.value)
    return {
      value: option.value,
      label: option.label,
      disabled: !offered,
      reason: 'not offered by provider'
    }
  })
}

export function SettingsScreen({
  platforms,
  prefs,
  onRequestClear,
  onBack,
  sessionLive = false
}: SettingsScreenProps): ReactElement {
  const [pendingCodec, setPendingCodec] = useState<{
    platformId: string
    value: CodecForce
  } | null>(null)
  const [codecError, setCodecError] = useState<string | null>(null)

  const applyCodec = (platformId: string, codecForce: CodecForce): void => {
    setCodecError(null)
    getGamingate()
      .setCodecForce({ platformId, codecForce })
      .then((outcome) => {
        if (!outcome.relaunched) {
          setCodecError(
            outcome.error ?? 'Restart blocked — the hint applies on the next launch.'
          )
        }
      })
      .catch(() => setCodecError('Gateway engine unreachable. Restart the app.'))
  }

  return (
    <div className="og-settings">
      <div>
        <Button variant="secondary" onClick={onBack}>
          Back to services
        </Button>
      </div>

      {platforms.map((platform) => {
        const codec = prefs?.perPlatform[platform.id]?.codecForce ?? prefs?.codecForce ?? 'auto'
        return (
          <section
            key={platform.id}
            className="og-section"
            aria-labelledby={`og-settings-${platform.id}`}
          >
            <h2 id={`og-settings-${platform.id}`} className="og-section__title">
              {platform.name}
            </h2>

            <div className="og-field">
              <span className="og-field__label">Codec force</span>
              <SegmentedControl
                name={`codec-${platform.id}`}
                ariaLabel={`Codec force for ${platform.name}`}
                options={codecOptionsFor(platform)}
                value={codec}
                onChange={(value) => {
                  const next = value as CodecForce
                  if (next === codec) return
                  if (sessionLive) setPendingCodec({ platformId: platform.id, value: next })
                  else applyCodec(platform.id, next)
                }}
              />
              <p className="og-placeholder">
                Provider-dependent hint — the provider negotiates the actual codec.
              </p>
              <Badge tone="warning">Restarts Gamingate to apply.</Badge>
            </div>

            <div className="og-field">
              <span className="og-field__label">Third-party cookies</span>
              <span className="og-field__value">
                {platform.thirdPartyCookies ? 'Allowed' : 'Blocked'}
              </span>
            </div>

            <div className="og-field">
              <span className="og-field__label">User agent</span>
              <span className="og-field__value" title={platform.userAgent}>
                {platform.userAgent}
              </span>
            </div>

            <div>
              <Button variant="destructive" onClick={() => onRequestClear(platform)}>
                Clear data
              </Button>
            </div>
          </section>
        )
      })}

      <DecodeControl sessionLive={sessionLive} />
      <ShortcutsReference />

      <Toast message={codecError} />
      <ConfirmDialog
        open={pendingCodec !== null}
        title="Restart Gamingate?"
        body="Changing the codec hint restarts Gamingate to apply it. Your session will end."
        confirmLabel="Restart"
        onConfirm={() => {
          const pending = pendingCodec
          setPendingCodec(null)
          if (pending) applyCodec(pending.platformId, pending.value)
        }}
        onCancel={() => setPendingCodec(null)}
      />
    </div>
  )
}
