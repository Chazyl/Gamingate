/**
 * Honest metric formatting (SHL-03). A value the runtime cannot expose renders
 * an em dash — never `0`, never an estimate. A genuinely measured `0` is a
 * value and passes through (only null / undefined / NaN / blank are missing).
 */

export const DASH = '—'

/** Caption shown beneath a field that has no compliant source. */
export const NOT_EXPOSED = 'Not exposed by this runtime'

/** Fallback when CDP Media exposes no decoder name for the stream. */
export const DECODER_UNKNOWN = 'Unknown (not probed)'

export function formatMetric(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return DASH
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : DASH
  return value.trim() === '' ? DASH : value
}

/**
 * Decoder truth. The name comes from CDP Media; the hardware flag is only added
 * when CDP exposed it. With no name, the honest fallback is "Unknown (not
 * probed)" (the decode-capability badge is a separate surface).
 */
export function formatDecoder(
  decoderName: string | null,
  hardwareDecoder: boolean | null
): string {
  if (!decoderName) return DECODER_UNKNOWN
  if (hardwareDecoder === true) return `${decoderName} (hardware)`
  if (hardwareDecoder === false) return `${decoderName} (software)`
  return decoderName
}
