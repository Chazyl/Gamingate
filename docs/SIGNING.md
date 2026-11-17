# Signing Runbook (PKG-01) — Production Signing as External Secrets

Phase 4 / PKG-01 (deferred half). The artifacts this phase produces are **unsigned**
(Linux) or **self-signed with a throwaway dev keystore** (Android) by design. They are
**not public-distribution-ready** until the procedures below run with real credentials
that live **outside** the repository.

> **Hard rule.** No keystore, certificate, private key, or password is ever committed.
> CI references secrets **by name** from its secret store; values are never inlined,
> printed, or echoed. `desktop/scripts/docker-verify.sh package-android` enforces
> a find-gate that fails the build if any `*.keystore`, `*.jks`, `keystore.properties`,
> or `signing.properties` file appears under `android/` (tracked or untracked).

## 1. Windows `nsis` — production signing

Windows production signing is **two ordered stages**. Order matters: code signing
invalidates the Widevine VMP signature, so VMP signing must run **after** Authenticode.

### Stage A — Authenticode code signing (publisher identity)

electron-builder signs the `win` target automatically when the standard code-signing
secrets are present. Obtain a Windows Authenticode code-signing certificate (OV/EV) from
a CA, then store it as CI secrets:

| Secret name | Value |
|-------------|-------|
| `WIN_CSC_LINK` | Base64 of the `.pfx` code-signing certificate (or an HTTPS/file link). |
| `WIN_CSC_KEY_PASSWORD` | Password that decrypts the `.pfx`. |

Dev/test: omit both → the build is **unsigned** (the current pipeline builds unsigned and
must not set these unless real credentials exist). Do not enable a `forceCodeSigning`
switch until the secrets are wired, or the build will fail on every push.

### Stage B — Widevine VMP signing (castlabs EVS)

VMP (Verified Media Path) signing is what lets Widevine-gated providers (Luna) accept the
app. It is issued through the **castlabs EVS** service for the castlabs ECS runtime.

1. **Enroll / obtain credentials.** Use the castlabs VMP self-signing portal (free for
   the ECS build, pre-approved by Google) for release credentials:
   <https://castlabs.com/security/widevine-certification>. The canonical tooling docs are
   the castlabs EVS wiki: <https://github.com/castlabs/electron-releases/wiki/EVS>.
2. **Install the EVS client** in the signing runner:
   `python3 -m pip install castlabs-evs`.
3. **Store credentials as CI secrets** (names only — values never in the repo):

   | Secret name | Purpose |
   |-------------|---------|
   | `EVS_ACCOUNT_NAME` | castlabs EVS account name. |
   | `EVS_PASSWD` | castlabs EVS account password. |

4. **Invoke EVS after packaging/signing**, from an electron-builder `afterSign` hook
   (or an explicit post-build step) on the Windows runner:

   ```bash
   python3 -m castlabs_evs.vmp -n sign-pkg "<appOutDir>"
   #   -n / --no-ask : non-interactive
   ```

   The hook runs *after* Authenticode signing so the VMP signature covers the final
   binary. If EVS credentials are unset, the step must be skipped (dev builds) — never
   fall back to a hard-coded or test certificate.

Dev/test VMP: the ECS runtime ships development VMP signing (self-signing portal), which
is enough for UAT against non-production servers. Public distribution requires the EVS
production signing above.

## 2. Android — release keystore

The release `buildType` (`android/app/build.gradle`) already reads signing material
from Gradle properties, so the same build serves the container dev build (throwaway
keystore under `/tmp`) and CI release signing (properties from secrets). With no
`gamingate.keystore.path`, the release build stays **unsigned** (fail-safe).

### Generate the release keystore (once, on a trusted machine)

```bash
keytool -genkeypair -v \
  -keystore gamingate-release.jks \
  -alias gamingate \
  -keyalg RSA -keysize 2048 -validity 10000
```

Keep this file **out of the repo** and out of CI artifacts.

### Store as CI secrets (names only)

| Secret name | Purpose |
|-------------|---------|
| `ANDROID_KEYSTORE_BASE64` | Base64 of `gamingate-release.jks`. |
| `ANDROID_KEYSTORE_PASSWORD` | Store password. |
| `ANDROID_KEY_ALIAS` | Key alias (e.g. `gamingate`). |
| `ANDROID_KEY_PASSWORD` | Key password; omit if identical to the store password. |

### Supply them to the build

CI decodes `ANDROID_KEYSTORE_BASE64` to a temp file **inside the build mount** and passes
the exact Gradle properties the release build consumes (see the comment block in
`android/app/build.gradle`). A password value equal to the literal `env` tells
`build.gradle` to read it from the environment — never from a logged command line:

```bash
export GAMINGATE_KS_STORE_PASS="$ANDROID_KEYSTORE_PASSWORD"
export GAMINGATE_KS_KEY_PASS="${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}"

npx gradle :app:assembleRelease \
  -Pgamingate.keystore.path=/tmp/gamingate-release.jks \
  -Pgamingate.keystore.password="env" \
  -Pgamingate.keystore.alias="$ANDROID_KEY_ALIAS" \
  -Pgamingate.keystore.keyPassword="env"
```

`build.gradle` resolves `password`/`keyPassword` from `GAMINGATE_KS_STORE_PASS` /
`GAMINGATE_KS_KEY_PASS` when the property value is `env` (and falls back to the store
password when `keyPassword` is omitted). Pass password values through the environment
(Gradle `providers.environmentVariable`), never as a literal on a logged command line.
The container step `package-android` already passes `-Pgamingate.keystore.*` literals for
its throwaway `/tmp` keystore; production CI replaces the container path with the decoded
release keystore and uses the `env` indirection above.

### Verify the signature

```bash
apksigner verify --print-certs android/dist/gamingate-probe-release.apk
```

## 3. Secrets summary

| Platform | Secret name | Purpose | Where obtained |
|----------|-------------|---------|----------------|
| Windows | `WIN_CSC_LINK` | Authenticode `.pfx` (base64) | A code-signing CA. |
| Windows | `WIN_CSC_KEY_PASSWORD` | `.pfx` password | CA. |
| Windows | `EVS_ACCOUNT_NAME` | castlabs EVS account | castlabs VMP portal. |
| Windows | `EVS_PASSWD` | castlabs EVS password | castlabs VMP portal. |
| Android | `ANDROID_KEYSTORE_BASE64` | Release `.jks` (base64) | Generated by `keytool` (this runbook). |
| Android | `ANDROID_KEYSTORE_PASSWORD` | Store password | Chosen at key generation. |
| Android | `ANDROID_KEY_ALIAS` | Key alias | Chosen at key generation. |
| Android | `ANDROID_KEY_PASSWORD` | Key password | Chosen at key generation. |

## 4. Rules and failure modes

- **Never commit** a keystore, certificate, private key, or password. **Never `echo`** a
  secret; pass it via environment/stdin (`keytool … -storepass:env VAR`).
- Reference CI secrets by name only (`${{ secrets.NAME }}`); the CI runbook
  (`docs/CI.md`) states this boundary.
- **Rotate immediately** if any signing credential is exposed.
- The update feed's integrity currently relies on the `sha512` recorded in
  electron-builder's `latest.yml` / `latest-linux.yml` (threat T-04-01), **not** on
  publisher identity, until signing is supplied. The `.invalid` feed host is a
  placeholder (`docs/packaging.md`).
- **Artifacts from this phase are unsigned/self-signed by design** and must be signed
  with the procedures above before public distribution. This document is the procedure;
  it embeds **no** key material, certificate block, or password.
