
# Product Requirements Document (PRD)

**Project Name:** Project Gamingate (Multiplatform Cloud Gaming Gateway)  
**Author:** Lead Systems Architect  
**Targets:** Windows (`.exe` / `.msi`), Linux (`.AppImage`), Android (`.apk`)  
**Primary Integration (v1.0):** Amazon Luna  
**Planned Integrations (v1.x+):** Xbox Cloud Gaming, NVIDIA GeForce NOW  

---

## 1. Technical Study: Platform Embedding Requirements

| Requirement | Amazon Luna | Xbox Cloud Gaming (xCloud) | NVIDIA GeForce NOW (Web) | Gateway Implication |
| :--- | :--- | :--- | :--- | :--- |
| **Target URL** | `luna.amazon.com` | `xbox.com/play` | `play.geforcenow.com` | Isolated partition per platform |
| **Rendering Engine** | Chromium (Blink) preferred | Chromium / WebKit (PWA) | Strict Google Chrome (Blink) check | Must present Blink runtime + spoof exact Chrome Desktop/Mobile UA |
| **Streaming Protocol** | WebRTC + VP9/H.264 | WebRTC (Custom SCTP data channels) | WebRTC / WebCodecs (AV1/H.265/H.264) | Hardware video acceleration flag passthrough required |
| **DRM / Protection** | Widevine L3 (Desktop), L1/L3 (Android) | Widevine / PlayReady | Widevine L3 | CDM (Content Decryption Module) required |
| **Security Headers** | `X-Frame-Options: DENY`, strict CSP | Strict `frame-ancestors`, CORS origin locks | Strict origin checking, CSP `child-src 'none'` | **Direct `<iframe>` is impossible.** Requires privileged BrowserView / native WebView wrapper with header interception |
| **Input Capture** | Gamepad API, Pointer Lock | Gamepad API with haptics extensions | Gamepad API, raw mouse movement (`unadjustedMovement`) | Raw input capture and window focus retention required |

---

## 2. Architecture & Runtime Strategy

Because the deployment matrix includes **Windows, Linux (AppImage), and Android**, a single runtime cannot be used:
* **Desktop (Windows & Linux AppImage):** **Electron**. Bundles Chromium (providing identical WebRTC, Widevine CDM, and GPU acceleration flags across Windows and Linux).
* **Mobile (Android):** **Native Android Shell (Kotlin) or Capacitor/Tauri Android wrapper** utilizing `android.webkit.WebView` with hardware acceleration and Widevine L1/L3 enabled.
* **Shared Layer:** A shared TypeScript frontend client (Store/Gateway Shell UI) and standard IPC contract.

```
                    ┌──────────────────────────────┐
                    │ Gateway Shell (UI / Config)  │
                    │ React / Svelte / TypeScript  │
                    └──────────────┬───────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              ▼                                         ▼
   [ Desktop: Electron Runtime ]             [ Android: Native Runtime ]
   ├─ Windows (.exe / .msi)                  └─ Android (.apk)
   ├─ Linux (.AppImage)                         ├─ Android System WebView
   ├─ WebContentsView Embedder                  ├─ WebSettings (Widevine / Media)
   └─ Custom Session / Header Interceptor       └─ Android Gamepad / Input Dispatch
```

---

## 3. Product Specifications

### 3.1. Phase 1: Deep Research & Documentation (Weeks 1–2)
1. **DRM Validation:**
   * Verify Widevine CDM provisioning across Linux distributions via Electron.
   * Verify Android System WebView CDM compatibility with Luna's DRM endpoint.
2. **Network & Session Reverse-Engineering:**
   * Map authentication redirect flows (`amazon.com/ap/signin`, token storage, cross-domain cookies).
   * Map required header modifications to bypass `X-Frame-Options` and `Content-Security-Policy`.
3. **GPU Profile Baseline:**
   * Benchmark decode latency for WebRTC under VA-API (Linux), DXVA/D3D11 (Windows), and MediaCodec (Android).

### 3.2. Phase 2: Technical Specifications & Planning (Weeks 3–4)

#### Functional Requirements (FR)
* **FR-01 (Luna Shell):** Render `luna.amazon.com` within an isolated security partition (`persist:luna`).
* **FR-02 (Modular Gateway Architecture):** Maintain a registry configuration (`platforms.json`) enabling new platforms to be appended via URL, User-Agent, permissions, and header-rewrite rules without core engine refactoring.
* **FR-03 (Input Passthrough):** Pass standard XInput, DirectInput, and DualShock/DualSense controllers directly to the embedded web app with zero synthetic latency.
* **FR-04 (Pointer Lock):** Capture, hide, and lock the cursor for FPS games running inside the embedded view.
* **FR-05 (Session Persistence):** Retain login tokens and user sessions across app restarts.
* **FR-06 (Hardware Acceleration Toggle):** Provide user settings to toggle hardware decoding and force codec profiles (H.264 vs. VP9/AV1).

#### Non-Functional Requirements (NFR)
* **NFR-01 (Decode Overhead):** Video decoding overhead must introduce $<2\text{ms}$ frame latency compared to native Chrome.
* **NFR-02 (Cold Start):** Desktop gateway launches in $<1.5\text{s}$; Android shell in $<1.0\text{s}$.
* **NFR-03 (Linux Portability):** Linux AppImage must run out-of-the-box on Ubuntu LTS, Fedora, and Arch with automatic VA-API/NVDEC detection.

---

## 4. Implementation Details

### Desktop (Electron Core)
* **View Mechanism:** Implement `WebContentsView` (superseding deprecated `BrowserView` and `<webview>`).
* **Header Interceptor:**
  ```typescript
  session.fromPartition('persist:luna').webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    delete responseHeaders['x-frame-options'];
    delete responseHeaders['content-security-policy'];
    callback({ cancel: false, responseHeaders });
  });
  ```
* **GPU Passthrough Flags:**
  ```typescript
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  ```

### Android Shell
* Enable hardware acceleration at the application level (`android:hardwareAccelerated="true"` in manifest).
* Enable WebRTC and DOM Storage:
  ```kotlin
  webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      mediaPlaybackRequiresUserGesture = false
      userAgentString = CHROME_MOBILE_UA
  }
  ```
* Handle WebRTC permissions explicitly via `WebChromeClient.onPermissionRequest()`.

---

## 5. Testing & Quality Assurance Plan

1. **Automation Test Suite:**
   * **Playwright:** End-to-end tests for gateway navigation, authentication state retention, and menu overlays.
   * **Input Verification:** Synthetic Gamepad API assertion tests to verify analog stick and trigger polling rate ($>120\text{Hz}$).
2. **Matrix Compatibility Testing:**
   * **Windows:** Windows 10/11 (DirectX 11/12 decode).
   * **Linux (AppImage):** Wayland native vs. XWayland vs. pure X11; Intel (Mesa), AMD (RADV), and NVIDIA (Proprietary) drivers.
   * **Android:** Android 11 through Android 15 (ARM64 physical devices).
3. **Network Stress:**
   * In-stream jitter and frame loss testing using `clumsy` / `tc-netem` under artificial 20ms–100ms ping and 1–5% packet loss.

---

## 6. GitLab CI/CD Pipeline

The `.gitlab-ci.yml` orchestrates automated testing, compilation, signing, and multiplatform asset publication.

```yaml
stages:
  - lint-test
  - build-desktop
  - build-android
  - release

variables:
  NODE_VERSION: "20"
  ELECTRON_BUILDER_CACHE: "$CI_PROJECT_DIR/.cache/electron-builder"

cache:
  paths:
    - node_modules/
    - .cache/

# Stage: Lint & Test
test:unit:
  stage: lint-test
  image: node:20
  script:
    - npm ci
    - npm run lint
    - npm run test:unit

# Stage: Build Linux AppImage
build:linux:
  stage: build-desktop
  image: electronuserland/builder:wine
  script:
    - npm ci
    - npm run build
    - npx electron-builder --linux appimage --x64
  artifacts:
    name: "linux-appimage-$CI_COMMIT_REF_NAME"
    paths:
      - dist/*.AppImage
    expire_in: 14 days

# Stage: Build Windows Executable
build:windows:
  stage: build-desktop
  image: electronuserland/builder:wine
  script:
    - npm ci
    - npm run build
    - npx electron-builder --windows nsis --x64
  artifacts:
    name: "windows-exe-$CI_COMMIT_REF_NAME"
    paths:
      - dist/*.exe
    expire_in: 14 days

# Stage: Build Android APK
build:android:
  stage: build-android
  image: runmymind/docker-android-sdk:latest
  before_script:
    - cd android
    - chmod +x gradlew
  script:
    - ./gradlew assembleRelease
  artifacts:
    name: "android-apk-$CI_COMMIT_REF_NAME"
    paths:
      - android/app/build/outputs/apk/release/*.apk
    expire_in: 14 days

# Stage: GitLab Release
publish-release:
  stage: release
  image: registry.gitlab.com/gitlab-org/release-cli:latest
  only:
    - tags
  script:
    - echo "Publishing release $CI_COMMIT_TAG"
  release:
    name: "Release $CI_COMMIT_TAG"
    description: "Automated multiplatform release for Project Gamingate."
    tag_name: "$CI_COMMIT_TAG"
    assets:
      links:
        - name: "Linux AppImage"
          url: "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic/gamingate/${CI_COMMIT_TAG}/gamingate-${CI_COMMIT_TAG}.AppImage"
        - name: "Windows Installer"
          url: "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic/gamingate/${CI_COMMIT_TAG}/gamingate-Setup-${CI_COMMIT_TAG}.exe"
        - name: "Android APK"
          url: "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic/gamingate/${CI_COMMIT_TAG}/gamingate-${CI_COMMIT_TAG}.apk"
```

---

## 7. Deliverables & Milestones

* **Milestone 1 (End of Week 2):** Research documentation complete. Widevine, WebRTC, and header-interception prototypes validated on all 3 target OSs.
* **Milestone 2 (End of Week 4):** Core architecture and Gateway configuration schema finalized. PRD sign-off.
* **Milestone 3 (End of Week 7):** Functional alpha build (Luna streaming functional with audio, video, and gamepad on Windows, AppImage, and Android).
* **Milestone 4 (End of Week 9):** Performance tuning (zero-drop WebRTC decoding) and CI/CD automated pipeline active in GitLab.
* **Milestone 5 (End of Week 10):** v1.0 Production Release. Gateway architecture prepared for subsequent platform integrations (xCloud / GeForce NOW).
