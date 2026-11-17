# Contributing to Gamingate

Thanks for your interest. This project is an independent, unofficial client for
cloud-gaming providers, built as a registry-driven gateway. Contributions of all
kinds are welcome — bug reports, docs, tests, and code.

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ground rules

- **Container-only.** Nothing is installed on the host. All builds and tests run
  in Docker; source is mounted read-only and work happens in a container-local
  directory. The only exception is running a **final packaged build** to test it.
  See [docs/BUILDING.md](docs/BUILDING.md).
- **Keep it registry-driven.** Adding a provider should be a `platforms.json`
  change validated by the schema — not special-cased engine code.
- **Don't break the boundaries.** Provider pages stay in their own partition with
  an inert preload; only the trusted shell may reach privileged IPC handlers, and
  those handlers stay sender-allowlisted.
- **Be honest in the UI.** Report capabilities the runtime actually exposes
  (e.g. Widevine L3, never fabricated metrics).

## Repository layout

| Path | What |
|------|------|
| `desktop/` | Electron (castlabs ECS) app: main, preload, shell, engine, `platforms.json` |
| `android/` | Bare-Kotlin system-WebView shell + registry validator |
| `packaging/` | Packaging index and release assets |
| `branding/` | Logos and icon source |
| `docs/` | Architecture, building, packaging, signing, CI, performance |
| `.github/` | CI workflows, issue/PR templates, dependency updates |

## Development workflow

1. Fork and branch from `main` (e.g. `fix/registry-timeout`).
2. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the relevant `docs/` page.
3. Make a focused change with tests.
4. Run the gates locally (in Docker):

   ```bash
   bash desktop/scripts/docker-verify.sh typecheck
   bash desktop/scripts/docker-verify.sh test
   bash desktop/scripts/docker-verify.sh shell-test
   bash desktop/scripts/docker-verify.sh shell-ipc-gate
   bash desktop/scripts/docker-verify.sh shell-honesty
   ```

5. Open a pull request using the template. Describe the **why**, the change, and
   how you verified it.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`, `ci:`.
Keep each commit a single logical change.

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include your
OS, whether you used a packaged or source build, the provider, and redacted logs.

## Security

Never report security issues publicly. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), and you confirm you have the right to submit them.
