# CI Runbook (GitHub Actions)

Phase 4 / PKG-01, PKG-02. The CI surface for Project Gamingate. Every job builds
and tests through `desktop/scripts/docker-verify.sh`, which does all of
its work **inside containers** (AGENTS.md: container-only — the runner host never
runs `npm`/`node`/Gradle against the project). `ubuntu-latest` ships Docker; no
host toolchain is installed by these workflows.

**Status:** this repo currently has no git remote, so the workflows are
**authored and statically verified but not yet enabled**. See
[Enabling CI](#enabling-ci).

## Job graph

`.github/workflows/ci.yml` (`name: ci`), triggered on `push`, `pull_request`, and
`workflow_dispatch`:

```
lint-test ─┬─> build-desktop ─┐
           └─> build-android ─┴─> release   (tags only)
```

| Job | `needs` | Runs | Proves |
|-----|---------|------|--------|
| `lint-test` | — | `docker-verify.sh typecheck`, `docker-verify.sh test` | The engine + shell typecheck and unit tests pass (in the verify image). |
| `build-desktop` | `lint-test` | `docker-verify.sh package-appimage` | A real Linux `AppImage` (>40 MB) + `deb` build on the castlabs ECS runtime via `electron-builder`, with `latest-linux.yml` update metadata. |
| `build-android` | `lint-test` | `docker-verify.sh package-android` | A signed release APK (>1 MB) builds via Gradle in the pinned `android-sdk:36` image (dev keystore, container-local). |
| `release` | `build-desktop`, `build-android` | `download-artifact` + `action-gh-release` | On a `v*` tag: publishes the desktop + Android artifacts as a GitHub Release. |

`build-desktop` and `build-android` run in parallel after `lint-test`.

## Nightly provider health-check

`.github/workflows/provider-health.yml` (`name: provider-health`), triggered by a
nightly `schedule` (`0 6 * * *` UTC) and `workflow_dispatch`:

| Job | Runs | Proves |
|-----|------|--------|
| `luna-smoke` | `docker-verify.sh smoke luna` | The registry-driven engine still loads Luna top-level and is healthy. |

`smoke luna` executes the existing `desktop/scripts/engine-smoke.sh luna`
lane (top-level load, allowed-origin assertion, decode-decision write). A **red
run is the drift signal** for UA drift, EME/Widevine drift, auth/redirect drift
(origin leaves `allowedOrigins`), and registry/schema drift. It never signs in
and uses no provider credentials.

## Artifacts & where they land

Inside each job the artifacts are written to the runner's checkout:

- Desktop: `desktop/dist/*.AppImage`, `*.deb`, `latest-linux.yml`,
  `*.blockmap` — uploaded as the `desktop-linux` artifact.
- Android: `android/dist/*.apk` — uploaded as the `android-release` artifact.
- Release: both artifacts are merged into `release-assets/` and attached to the
  GitHub Release.

`desktop/dist/` and `android/dist/` are gitignored; artifacts are
never committed.

## Container-only rationale & cost

All work goes through `docker-verify.sh`; CI adds no host-side installs. Two
notable costs, both one-time thanks to caching:

- The builder image `electronuserland/builder:22` is **~2 GB** and pulls the
  AppImage/deb tooling (`appimage-*.7z`, `7zip`, `fpm`) into the electron-builder
  cache on first use (`ELECTRON_BUILDER_CACHE`).
- The `android-sdk:36` image pulls the **Gradle 9.4.1** distribution into the
  Gradle cache on first use.

`docker-verify.sh` persists that state in the `gamingate-desktop-cache` Docker
volume. The workflows **bind** that volume to `${{ github.workspace }}/.ci-cache/npm-electron`
(a `docker volume create --driver local --opt type=none --opt o=bind` step) so
`actions/cache` can persist it across runs
(`key: gamingate-cache-${{ runner.os }}-${{ hashFiles('desktop/package.json') }}`).
There is no nested Docker-in-Docker: jobs call the harness, which calls `docker`
on the runner's own daemon.

## Secrets boundary

Nothing in these workflows needs a secret to build: the artifacts are
**unsigned/self-signed by design** (see `docs/SIGNING.md`, Plan 04-05). If a
future signing step is added it **must** read its inputs from the GitHub secret
store as `${{ secrets.* }}` and **must never echo them** (threat T-04-09). The
static `ci-config` gate fails the build if a bare `secrets.*` reference appears
outside `${{ }}` or if any `run:` script (inline or a `run: |` block) references a
secret.

Planned secret names (referenced by name only — never values):

| Secret | Used by | Purpose |
|--------|---------|---------|
| `UPDATE_FEED_TOKEN` | release / future publish | Push update-feed assets (`latest-linux.yml` + blockmaps) to the feed host. |
| `ANDROID_KEYSTORE_BASE64` | `build-android` (future) | Base64 release keystore to sign a production APK. |
| `ANDROID_KEYSTORE_PASSWORD` | `build-android` (future) | Keystore password (passed as a Gradle property, never logged). |
| `WINDOWS_EVS_CERT` | Windows signing (future) | castlabs EVS/VMP signing certificate for production Windows builds. |

## Static verification (container-only)

The workflow contract is asserted by
`desktop/scripts/gates/ci-config-gate.mjs` — the job set, `needs` edges,
tag-gating, triggers, `smoke luna`, and the no-inlined-secret / no-secret-in-`run:`
rule. YAML
+ shell syntax is validated by `actionlint`. Both run in containers:

```bash
# Contract gate (jobs / needs / triggers / secrets)
docker run --rm -v "$PWD:/repo:ro" node:24 \
  node /repo/desktop/scripts/gates/ci-config-gate.mjs /repo
# -> CI_CONFIG_OK

# YAML/shell syntax, both workflows
docker run --rm -v "$PWD:/repo" rhysd/actionlint:latest -color /repo/.github/workflows/ci.yml
docker run --rm -v "$PWD:/repo" rhysd/actionlint:latest -color /repo/.github/workflows/provider-health.yml
```

## Enabling CI

This repo has no git remote and `gh` is not installed here, so nothing is pushed
yet. To enable:

1. Push the repository to GitHub (add a remote and push `master`).
2. GitHub Actions runs on push/PR with no further setup — the unsigned desktop +
   Android builds need **no secrets**.
3. (Optional, release) Create a `v*` tag to publish a GitHub Release. Grant the
   `release` job `contents: write` (already set in `ci.yml`).
4. (Optional, signing) Add the secret names in the table above in
   *Settings → Secrets and variables → Actions* before wiring the signing steps
   from `docs/SIGNING.md`.

## Out of scope (human / hardware)

**PKG-03 hardware lanes are human and intentionally absent from CI.** Windows
`nsis` physical-machine runs, Linux per-distro/per-GPU decode runs, and
Android-on-physical-device runs are not simulated or faked here — see the
release matrix (`docs/RELEASE-MATRIX.md`, Plan 04-05), the PERF-02 cold-start
runbook (`docs/PERF-02-cold-start.md`), and the PERF-04 decode runbook
(`docs/PERF-04-linux-decode.md`). The Windows `nsis` target is config-only in
this repo; only the Linux `AppImage`/`deb` and Android APK are built by CI.
