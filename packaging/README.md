# Packaging

Packaging is driven from the app directories so builds stay self-contained in
Docker:

- **Desktop (Linux/Windows):** [`desktop/electron-builder.yml`](../desktop/electron-builder.yml)
  with hooks in [`desktop/build/`](../desktop/build/) (`after-pack.cjs` sets the
  sandbox helper setuid; `deb-after-install.sh` does it at install time).
- **Android:** built by `desktop/scripts/docker-verify.sh package-android`
  (Gradle `assembleRelease`, signed with a container-local dev keystore; production
  signing via CI secrets).

The single entry point is `desktop/scripts/docker-verify.sh`. See
[docs/BUILDING.md](../docs/BUILDING.md) for commands and
[docs/packaging.md](../docs/packaging.md), [docs/SIGNING.md](../docs/SIGNING.md),
and [docs/CI.md](../docs/CI.md) for the pipeline, signing, and release details.

## Outputs

| Artifact | Path |
|----------|------|
| Linux AppImage | `desktop/dist/Gamingate-<version>-<arch>.AppImage` |
| Linux deb | `desktop/dist/Gamingate-<version>-amd64.deb` |
| Windows installer (CI) | `desktop/dist/Gamingate Setup <version>.exe` |
| Android APK | `android/dist/gamingate-android-release.apk` |

These build outputs are gitignored and are never committed.
