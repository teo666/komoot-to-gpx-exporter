# Komoot GPX Extension

This repository contains a minimal scaffold for a Chrome and Firefox extension that exports Komoot tours to GPX.

## What is included

- content script that scans the loaded page for a Komoot coordinates API URL
- fixed bottom export button with mobile-safe styling
- GPX generation and filename sanitization in the content script
- background download bridge using the browser downloads API
- build script that emits separate `dist/chrome` and `dist/firefox` extension folders

## Project layout

```text
manifests/
  chrome.json
  firefox.json
scripts/
  build.mjs
src/
  background.js
  content.css
  content.js
```

## Build

```bash
npm run build
```

This creates:

- `dist/chrome`
- `dist/firefox`

## Load the extension

### Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select `dist/chrome`.

### Firefox

1. Open `about:debugging`.
2. Choose This Firefox.
3. Click Load Temporary Add-on.
4. Select `dist/firefox/manifest.json`.

## Current assumptions

- content scripts run on `https://www.komoot.com/*`
- the coordinates URL can be found in the loaded HTML or inline script payloads
- Komoot coordinate items follow `{ lat, lng, alt, t }`
- timestamps are optional and emitted only when they can be converted safely

Adjust the manifest match patterns and the discovery logic once you verify the exact Komoot page variants you want to support.
