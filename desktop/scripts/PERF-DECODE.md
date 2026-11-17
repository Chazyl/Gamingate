# PERF-01 — Decode-overhead protocol (host measurement)

PERF-01 requires that gateway decode overhead stays within **≤ 2 ms/frame**
versus native Chrome on the same machine — a *measured host bar*, not a CI
assertion. The container lane cannot measure this: it has no display, no signed-in
Luna session, and no real decode pipeline. This document defines the honest,
reproducible protocol and the decoder-truth anchor it must be read against.

## Why the container lane cannot run it

- No display / GPU: the headless Docker lane proves the sampler, the honest
  em-dash fallbacks, and the power lifecycle — nothing about real decode timing.
- No true decoder: without a real session, CDP `Media` reports nothing, so there
  is no decoder truth to anchor a measurement to.

## The decoder truth anchor

The overlay's **Decoder** field is the evidence for the measurement. It must show
a *real* decoder name from CDP `Media.playerPropertiesChanged` (e.g. a
`VDAVideoDecoder` / `*PlatformVideoDecoder` = hardware, `FFmpegVideoDecoder` =
software). If it shows `Unknown (not probed)` there is no real decode path and the
measurement is meaningless — fix the session first, do not record a number.

## Protocol

Run on a display-capable host signed into Luna (the `user_setup` human step).

1. **Native-Chrome baseline**
   - Open `https://luna.amazon.com` in an installed Google Chrome (same machine,
     same GPU driver, same OS power plan).
   - Start a session and play a scene with motion for at least 60 s.
   - Record frames-per-second and decode time from `chrome://media-internals`
     (the active `video_decoder` entry) or an equivalent frame-timing capture.

2. **Gamingate measurement**
   - Launch the same Luna session in the packaged/gateway shell.
   - Toggle the overlay (`Ctrl+Shift+S`) and record the **Decoder** value and
     **Resolution** verbatim — this is the decoder truth the number is anchored to.
   - Capture decode time per frame over the same 60 s scene, same capture method.

3. **Overhead**
   - `overhead_ms_per_frame = decode_ms(frame)_gateway − decode_ms(frame)_chrome`
     over matched frames (median over the run; report the p95 too).

4. **Pass bar**
   - **≤ 2 ms/frame** median overhead, decoder truth showing a real decoder.

## Recording location

Append the result to `.planning/phases/03-shell-input-stream-health/03-VERIFICATION.md`
(or the phase evidence dir) as: date, host (GPU + driver + OS), Chrome version,
Gamingate build, overlay Decoder/Resolution values, median + p95 overhead, and the
pass/fail verdict. A bare number with no decoder-truth line is not valid evidence.

## Honesty notes

- Do **not** record overhead from a run whose overlay shows `—` / `Unknown (not
  probed)`; that means the runtime exposed no decoder and the metric is absent.
- Software fallback (no HW decode) is a legitimate outcome — record it as such
  with the software decoder name; it is not a pass at ≤ 2 ms.
