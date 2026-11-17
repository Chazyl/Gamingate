#!/bin/sh
# Debian postinst (community norm for Electron debs): the Chromium sandbox helper
# MUST be setuid root, or Chromium refuses to use it and the app is forced
# unsandboxed on hosts that restrict unprivileged user namespaces (Ubuntu 24.04+
# via AppArmor). fpm does not preserve setuid bits, so set it here.
set -e
SANDBOX=/opt/Gamingate/chrome-sandbox
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" 2>/dev/null || true
  chmod 4755 "$SANDBOX" 2>/dev/null || true
fi
exit 0
