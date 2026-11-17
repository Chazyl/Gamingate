# Architecture

Gamingate is a shared gateway shell that embeds cloud-gaming web apps. Providers
send `X-Frame-Options: DENY` / restrictive CSP, so a plain `<iframe>` is not
possible. Instead each provider is loaded **top-level** into a dedicated view that
lives in its own browsing-session partition, composited under a trusted shell.

## Desktop (Electron)

```
BaseWindow.contentView
├── shellView      trusted React chrome — service picker, settings, status
│                  preload bridge to ipcMain (privileged)
├── providerView   provider web app, top-level
│                  own persist:<id> partition, INERT preload (no bridge)
└── overlayView    trusted, transparent, on demand — stream health / decode info
```

- **shellView** owns all UI and is the only surface with a privileged preload.
- **providerView** navigates directly to the provider's entry URL. Because it is a
  top-level navigation (not a framed context), `X-Frame-Options`/CSP do not apply.
  It gets an inert preload: no IPC surface, no Node.
- **overlayView** is a second trusted renderer used for the stream-health overlay,
  so diagnostics never have to inject into the provider page.

### Views and layout

`src/main/shell/window.ts` builds the `BaseWindow` and its three views.
`src/main/shell/layout.ts` keeps bounds in sync and toggles the overlay. Views are
created and torn down through the view manager, which closes `webContents`
explicitly to avoid leaks.

### Gateway engine

`src/main/session/*` and `src/main/view/*` implement the engine:

1. Resolve a provider from `platforms.json` (zod-validated at startup and by a
   schema gate in CI).
2. Create/activate a `persist:<id>` partition and its provider view.
3. Navigate top-level to the entry URL; keep navigation inside the provider's
   allowed origins (`trusted-url.ts`).
4. Apply header rules and user agent from the registry (`header-rules.ts`).
5. Persist provider selection and decode preferences (`prefs.ts`).

The **registry** (`src/main/registry/platforms.ts` + `platforms.json`) declares, per
provider: `id`, `entryUrl`, `allowedOrigins`, `userAgent`, `permissions`, header
rules, and an optional `platformSpoof`. Adding a provider is configuration.

### Session & identity

Auth happens **only** on the provider's own origin. The gateway never receives
credentials and never copies cookies between providers. The resulting session jar
persists in `persist:<id>`, so a signed-in user stays signed in across launches and
rebuilds.

### Decode control

`src/main/decode/capability.ts` probes what the runtime actually supports and
reports an honest capability (Widevine L3 / `SW_SECURE` only; metrics the runtime
cannot expose are shown as `—`, never a fabricated number). Toggling hardware decode
persists the choice and relaunches, because GPU flags must be applied before `app`
ready (`src/main/shell/restart.ts`).

### IPC trust boundary

`ipcMain` handlers are registered in `src/main/shell/ipc.ts` and are
**sender-allowlisted** (trusted shell frame + origin). Provider content, which has
an inert preload and cannot construct IPC messages, can never reach a privileged
handler.

### Data

Gateway settings (selected provider, decode toggle, UI prefs) are stored locally in
the app's `userData`. Provider session state lives in the partition. Nothing is
uploaded.

## Android

`android/` is a bare-Kotlin shell over the **system WebView** (`minSdk 30`).

- Hardware-accelerated WebView with WebRTC/media permissions handled through
  `onPermissionRequest`.
- Widevine is **L3** in the system WebView (SD-grade playback); a Chrome Custom Tab
  fallback for full L1 is planned.
- The **same** `platforms.json` contract is validated on JVM by a shared
  `RegistryValidator` and staged into the APK, so provider definitions stay single-
  sourced.
- Gamepad/input comes from the Android input stack into the WebView.

## Packaging

- Desktop: `electron-builder` on the castlabs ECS runtime (`electron@v44.1.0+wvcus`);
  AppImage + `.deb` on Linux, `nsis` on Windows.
- Android: signed release APK; production signing supplied via CI secrets.
- All builds run in Docker against the oldest supported base so packages stay
  portable (see [BUILDING.md](BUILDING.md) and [packaging.md](packaging.md)).

## Security model (summary)

- Provider isolation via per-provider partitions and an inert preload.
- Privileged IPC reachable only from the trusted shell, sender-allowlisted.
- No credential handling or session transplanting in the gateway.
- No secrets in the repository; signing material is supplied at build time.
- See [SECURITY.md](../SECURITY.md) for reporting.
