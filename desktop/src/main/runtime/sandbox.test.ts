import { describe, expect, it } from 'vitest'

import { rendererSandboxEnabled } from './sandbox'

describe('rendererSandboxEnabled', () => {
  it('disables the renderer sandbox when --no-sandbox is present (root/container)', () => {
    expect(rendererSandboxEnabled(['/electron', '.', '--no-sandbox', '--platform=example'])).toBe(
      false
    )
  })

  it('keeps the renderer sandbox on by default (production, non-root)', () => {
    expect(rendererSandboxEnabled(['/electron', '.', '--platform=example'])).toBe(true)
  })
})
