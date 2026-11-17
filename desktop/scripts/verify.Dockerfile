# Container-only verification image for the desktop engine seed.
#
# AGENTS.md: nothing may be installed or run on the host. This image bakes the
# Electron runtime libraries + Xvfb so the smoke step can boot Chromium
# headlessly. It is DEV/CI tooling only — not part of the shipped app.
FROM node:24

RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      xvfb xauth \
      libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
      libpango-1.0-0 libcairo2 libasound2 libxshmfence1 libgtk-3-0 libxss1 \
      libxtst6 libnotify4 xdg-utils \
      libx11-xcb1 libxcb-dri3-0 libxcb-xfixes0 \
  && rm -rf /var/lib/apt/lists/*
