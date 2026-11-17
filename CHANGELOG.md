# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-11-17

First public release. A registry-driven gateway that embeds cloud-gaming web apps
(starting with Amazon Luna) in isolated, privileged containers — no browser plugin,
no iframe.

### Added

- **Desktop (Electron)** — castlabs ECS runtime (`electron@v44.1.0+wvcus`) with
  Widevine CDM provisioning, a `BaseWindow` + `WebContentsView` shell, one
  `persist:<id>` partition per provider, sender-allowlisted IPC, and a trusted
  overlay for stream health.
- **Registry engine** — `platforms.json` (zod-validated on both runtimes) declares
  id, entry URL, allowed origins, user agent, permissions, and header rules. Adding
  a provider is configuration, not engine work.
- **Shell UI** — service picker, per-platform settings, decode-mode control with a
  persist-and-relaunch flow, honest DRM capability reporting (L3/`SW_SECURE` only),
  gaming-mode chord blocking, sleep inhibition, and pointer-lock retention.
- **Android** — bare-Kotlin system-WebView shell (`minSdk 30`) sharing the same
  registry contract, with hardware acceleration and Widevine.
- **Linux packaging** — AppImage and `.deb` (setuid `chrome-sandbox`), verified
  end-to-end on a clean Ubuntu host.
- **Android packaging** — signed release APK via a throwaway container-local dev
  keystore; production signing supplied through CI secrets.
- **CI** — container-only pipeline (lint/test → desktop → android → tag-gated
  release) plus a nightly Luna provider health check.

### Validated

- Sign-in persisted across rebuilds in a dedicated session partition.
- A playable Luna session (video, audio, gamepad, pointer lock) on Linux from the
  packaged `.deb`.

### Known limitations

- Windows installer (`nsis`) is configured but not yet built/signed; production
  Widevine (EVS/VMP) and Authenticode signing require external credentials.
- Android playback is L3 in the system WebView (SD-grade); a Chrome Custom Tab
  fallback for full L1 is planned.
- AppImage on Ubuntu 24.04 / Debian 13+ needs `libfuse2` or
  `--appimage-extract-and-run`; prefer the `.deb` on those distros.
- Hardware video decode is best-effort on Linux and depends on the GPU/driver.

[Unreleased]: https://github.com/Chazyl/Gamingate/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Chazyl/Gamingate/releases/tag/v1.0.0
