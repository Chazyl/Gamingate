# Lane evidence — <LANE NAME>

> Reused by every lane (Windows, Linux per-GPU, Android, GPU matrix). Copy this
> file to `.planning/phases/01-drm-validation-spikes/evidence/lane-<x>.md` and
> fill every section. Redaction is mandatory before commit (D-04, Pitfall 7).

- **ECS tag:** <e.g. v44.1.0+wvcus>
- **Host:** <OS + version, compositor (Wayland/X11 or N/A)>
- **Hardware:** <GPU vendor/model or device model>
- **Probe target:** <shaka (Rung 1) | luna (Rung 2)>
- **First-install CDM run?:** <yes/no>

## 1. Titles + account tier (D-02)

- Titles attempted: <list 1-2 titles>
- Account tier: <tier name>
- (Android) WebView package + version: <from WebView.getCurrentWebViewPackage()>

## 2. EME ladder output (verbatim)

```
<paste the hwSecure / swSecure JSON from the probe page, unedited>
```

## 3. components.status() (verbatim, desktop)

```
<paste `components.status()` and `components.updatesEnabled` from stdout, unedited>
```

- `WIDEVINE_CDM_ID` state: <installed / not-installed / other>
- `MEDIA_FOUNDATION_WIDEVINE_CDM_ID`: informational only, never the pass signal (Pitfall 5)
- Linux only: pre-restart status and post-restart status (Pitfall 1)

## 4. chrome://gpu dump (GPU lanes)

- Reference: <path or paste of the dumped feature status>
- Active decoder asserted from the dump: <e.g. VDAVideoDecoder / software>
- Default flags first: <yes>
- Measured lane variations (annotations only, never baked into the scaffold):
  <e.g. --no-zygote required on this Wayland host — measured, not committed>

## 5. Playback capture (D-04 / A5)

- Capture: <path to cropped capture of the player surface>
- Fallback (A5): if the compositor blacks out captures, record the EME status +
  gpu dump + a witness log here instead:
  <witness log or N/A>

## 6. Verdict (D-05)

- Rung 1 (Shaka demo) result: <PASS / FAIL>
- Rung 2 (real licensed Luna title) result: <PASS / FAIL / NOT RUN>
- Session duration observed: <minutes>
- Provider-served resolution: <e.g. 1080p / SD>
- Auth loops or session drops: <none / describe>
- **PASS requires a 5+ minute stable licensed-title session. CDM presence or
  Shaka-demo playback alone is never pass evidence.**

## 7. Redaction checklist (mandatory before commit)

- [ ] No passwords, tokens, cookies, or session data
- [ ] No account email or personal identifiers
- [ ] Captures cropped to the player surface / status readouts only
- [ ] Host identifiers limited to model + OS + GPU
