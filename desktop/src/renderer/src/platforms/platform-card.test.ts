import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  DecodeState,
  PlatformSummary,
  SessionState
} from '../../../shared/shell-contract'
import { PlatformCard } from './PlatformCard'

/**
 * Picker decode badge (IM-02). The card must render the REAL decode state — a
 * hardcoded `deriveDecodeBadge(undefined)` permanently claimed "Unknown (not
 * probed)" even when the engine held evidence, which is itself a honesty
 * violation. Rendered to static markup so no DOM/jsdom harness is needed.
 */

const platform: PlatformSummary = {
  id: 'luna',
  name: 'Amazon Luna',
  signIn: 'unknown',
  codecHints: [],
  thirdPartyCookies: false,
  userAgent: 'Mozilla/5.0'
}
const session: SessionState = { status: 'stopped', platformId: null, error: null }
const noop = (): void => undefined

function render(decode: DecodeState | null): string {
  return renderToStaticMarkup(
    createElement(PlatformCard, {
      platform,
      session,
      decode,
      onLaunch: noop,
      onStop: noop,
      onRequestClear: noop
    })
  )
}

describe('PlatformCard decode badge (IM-02)', () => {
  it('shows the real evidenced decode state, not a hardcoded Unknown', () => {
    const decode: DecodeState = {
      mode: 'hardware',
      backend: 'gpu',
      videoDecodeStatus: 'enabled',
      probedAt: '2026-10-03T00:00:00.000Z',
      source: 'probe'
    }
    const html = render(decode)
    expect(html).toContain('Hardware')
    expect(html).not.toContain('Unknown (not probed)')
  })

  it('reports Unknown honestly when no decode state is loaded', () => {
    expect(render(null)).toContain('Unknown (not probed)')
  })

  it('labels a persisted forced choice as forced after relaunch', () => {
    const decode: DecodeState = {
      mode: 'hardware',
      backend: 'hardware',
      videoDecodeStatus: 'unprobed',
      probedAt: null,
      source: 'pref'
    }
    expect(render(decode)).toContain('Hardware (forced)')
  })
})
