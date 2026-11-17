# Documentation

Start here after the [README](../README.md).

| Doc | What it covers |
|-----|----------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Shell/engine/partition model, IPC trust boundary, Android shell, security |
| [BUILDING.md](BUILDING.md) | Container-only build, test, packaging, and dev helpers |
| [RELEASE-MATRIX.md](RELEASE-MATRIX.md) | Installer formats and targets per OS |
| [packaging.md](packaging.md) | Packaging pipeline details |
| [SIGNING.md](SIGNING.md) | Code signing and Widevine (EVS/VMP), Android keystore |
| [CI.md](CI.md) | Workflows, secrets, and the nightly provider health check |
| [PERF-02-cold-start.md](PERF-02-cold-start.md) | Cold-start instrumentation and numbers |
| [PERF-04-linux-decode.md](PERF-04-linux-decode.md) | Linux hardware-decode notes and per-device expectations |

## Conventions

- Everything builds and tests in Docker; nothing is installed on the host
  (see [BUILDING.md](BUILDING.md)).
- The provider registry (`desktop/platforms.json`) is the extension point for new
  services; it is validated by a shared schema on both desktop and Android.
