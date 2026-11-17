## What & why

<!-- What does this change do, and why is it needed? Link the issue it closes. -->

Closes #

## How

<!-- Brief notes on the approach and anything reviewers should focus on. -->

## Verification

<!-- How did you test it? Paste relevant output. All of this runs in Docker. -->

- [ ] `bash desktop/scripts/docker-verify.sh typecheck`
- [ ] `bash desktop/scripts/docker-verify.sh test`
- [ ] Shell gates (`shell-test`, `shell-ipc-gate`, `shell-honesty`) where relevant
- [ ] Manually exercised the affected flow

## Checklist

- [ ] Commits follow Conventional Commits and are focused
- [ ] Tests added/updated for behavior changes
- [ ] Docs updated (`README.md`, `docs/`, `CHANGELOG.md`) where relevant
- [ ] No secrets, keys, or signing material added
- [ ] Provider support (if any) is a registry change, not special-cased engine code
- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md) and agree to the [Code of Conduct](../CODE_OF_CONDUCT.md)
