# Packaging Runbook (Desktop)

Phase 4 / PKG-01. Desktop packaging for Project Gamingate. All builds run in
Docker (AGENTS.md: container-only; no installs on the dev host).

## Artifacts

| Target | Emitted to | Built here? |
|--------|-----------|-------------|
| Linux `AppImage` | `desktop/dist/Gamingate-<version>-x86_64.AppImage` on the **host** | Yes — load-bearing deliverable |
| Linux `deb` | `desktop/dist/Gamingate-<version>_amd64.deb` on the **host** | Yes |
| Windows `nsis` | `desktop/dist/` in CI (Windows runner) | **Config-only here** |

`desktop/dist/` is gitignored — artifacts are never committed.

**Live-host validation (the point of this phase):** copy
`desktop/dist/Gamingate-*.AppImage` to a real Linux host, `chmod +x` it,
and launch it. That is the surface the Phase 3 input/PERF UAT runs against.

## Build command

```bash
bash desktop/scripts/docker-verify.sh package-appimage
```

This runs the `electronuserland/builder` image (override with
`GAMINGATE_BUILDER_IMAGE`), copies the source into the persistent work volume,
installs deps, runs the castlabs Electron `install.js`, `electron-vite build`,
then `electron-builder --linux --publish never`, and copies `*.AppImage` +
`*.deb` to the host-mounted `dist/`. It prints `APPIMAGE_OK path=... size=...`
(and `DEB_OK ...`) and fails if no `.AppImage` larger than 40 MB exists.

Static config check (fast, no build):

```bash
bash desktop/scripts/docker-verify.sh package-desktop-config
# -> DESKTOP_CONFIG_OK
```

## Disk budget

The `electronuserland/builder` image is ~2 GB, and electron-builder downloads
AppImage/deb tooling (`appimage-*.7z`, `7zip`, `fpm`) into the persistent cache
volume on first use. The builder cache is persisted via
`ELECTRON_BUILDER_CACHE=/cache/electron-builder` (the project's
`gamingate-desktop-cache` volume), so tooling downloads are one-time. Ensure the
Docker host has room before the first packaging run.

## Runtime pin — DO NOT SWAP

The packaged runtime is the **castlabs ECS fork**
(`electron: https://github.com/castlabs/electron-releases#v44.1.0+wvcus`).
Widevine CDM provisioning depends on it; a stock Electron would silently break
DRM-gated playback.

- `electron-builder.yml` sets `electronDist: node_modules/electron/dist` so
  electron-builder packages the ECS binaries fetched by `install.js` instead of
  downloading stock Electron from GitHub.
- `package-desktop-config` fails if the `electron` spec is changed to a stock
  semver version.

## Auto-update

`electron-updater` is wired in the main process behind an `app.isPackaged`
guard; dev/container runs are a no-op. It reads `resources/app-update.yml`,
generated from the `publish` block in `electron-builder.yml`:

```yaml
publish:
  provider: generic
  url: "https://updates.example.invalid/gamingate"
```

The `.invalid` host is a deliberate, non-resolvable placeholder until CI supplies
a real HTTPS feed. Windows `nsis` is `oneClick: true, perMachine: false`.
Production integrity relies on the `sha512` in electron-builder's generated
`latest.yml` / `latest-linux.yml` (threat T-04-01).

## Signing (deferred)

This build is **unsigned**. Windows production VMP/EVS signing requires the
castlabs EVS service and certificates; Android release signing requires a
keystore. Both are external secrets and are documented as a CI/human task in
`docs/SIGNING.md` (Plan 04-05). No key material lives in this repo.
