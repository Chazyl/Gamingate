# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately via GitHub's
[private vulnerability reporting](https://github.com/Chazyl/Gamingate/security/advisories/new)
(the **Security** tab → *Report a vulnerability*). Include:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept if you have one),
- the affected component (desktop, android, or registry/engine) and version,
- any suggested remediation.

You can expect an acknowledgement within a few days and a coordinated disclosure
once a fix is available. Please give us a reasonable window before public disclosure.

## Scope

In scope:

- The gateway engine and shell (IPC trust boundary, provider isolation, header and
  user-agent handling, `platforms.json` validation).
- Session/partition handling and local data storage.
- The Android shell (WebView settings, permission handling, gamepad/input dispatch).
- The container build/test harness and CI workflows.

Out of scope:

- The cloud-gaming providers' own web applications and their vulnerabilities.
- The Widevine CDM and the castlabs Electron runtime (report those upstream).
- Issues that require a compromised local machine or physical access.

## Hardening notes

- Provider pages load in their own `persist:<id>` partition in a view with an
  **inert preload** (no privileged bridge). Only the trusted shell can reach
  `ipcMain` handlers, which are sender-allowlisted.
- The gateway never receives provider credentials and never transplants sessions.
- No secrets, keys, or signing material belong in the repository; CI supplies them
  at build time.
