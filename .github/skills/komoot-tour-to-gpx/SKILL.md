---
name: komoot-tour-to-gpx
description: 'Build a Firefox and Chrome WebExtension that exports a Komoot tour page to a GPX file. Use when creating or refining a browser extension that listens for page load, finds a Komoot coordinates API URL, fetches track points and tour metadata, injects a fixed export button, generates GPX, and downloads it on mobile and desktop.'
argument-hint: 'Describe the Komoot page behavior, browser targets, and any extension constraints.'
user-invocable: true
disable-model-invocation: false
---

# Komoot Tour To GPX

## What This Skill Produces

This skill guides the implementation of a browser extension that:

- runs on Komoot tour pages in Firefox and Chrome
- waits for the page to load and discovers a URL matching `https://api.komoot.de/v007/${SOMETHING}/:ID/coordinates`
- fetches the coordinates payload and reads `items` as the ordered track points
- fetches the tour metadata from `https://api.komoot.de/v007/${SOMETHING}/:ID/` and uses `name` as the download filename
- injects a fixed button at the bottom of the page
- converts the track to GPX and downloads it directly in the browser
- behaves acceptably on desktop layouts and on Chrome or Firefox on Android

## When To Use

Use this skill when you need to:

- scaffold a Chrome and Firefox compatible WebExtension for Komoot
- extract route coordinates from Komoot API calls visible from the page
- generate GPX output from `{ lat, lng, alt, t }` track items
- add an in-page export control instead of a popup-only flow
- make the export flow work on narrow mobile viewports and desktop browsers

## Inputs To Confirm Early

Before implementing, confirm these constraints:

- use a Chrome and Firefox compatible packaging strategy rather than assuming Chrome-only Manifest V3 behavior
- target pages: exact Komoot URL patterns where the content script should run
- parse page HTML or inline data first when discovering the coordinates URL
- support both responsive desktop layouts and Chrome or Firefox on Android
- timestamp handling: whether `t` is already GPX-safe time data or needs conversion

## Procedure

1. Define the extension surface.
   Decide whether a content script alone is enough or whether a background/service worker is needed for downloads or message passing.

2. Set up packaging for both browsers.
   Start from a shared extension structure, then account for Chrome and Firefox differences in manifest support, downloads behavior, and optional background logic. Include content script matches for Komoot tour pages, the permissions needed for Komoot API fetches and downloads, and any host permissions required for `api.komoot.de`.

3. Choose the URL discovery strategy.
   Start from the simplest local source on the loaded document. Parse page HTML and inline scripts first. If the coordinates URL is not available there, inspect browser performance entries or patch `fetch`/`XMLHttpRequest` early enough to capture matching requests.

4. Match the coordinates endpoint.
   Detect URLs matching the pattern `https://api.komoot.de/v007/${SOMETHING}/:ID/coordinates` where `:ID` is one or more digits. Preserve both `${SOMETHING}` and `:ID` so the metadata endpoint can be derived reliably.

5. Fetch the route coordinates.
   Request the coordinates endpoint, parse JSON, and validate that `items` is an array. Reject empty or malformed payloads with a user-visible error state on the export button.

6. Normalize track points.
   Map each item to a safe internal shape with latitude, longitude, optional elevation, and optional timestamp. Drop invalid points and require at least two valid coordinates before generating GPX.

7. Fetch the tour metadata.
   Request `https://api.komoot.de/v007/${SOMETHING}/:ID/`, parse the response JSON, and read the `name` field. Use that name for the filename after sanitizing invalid filesystem characters and truncating to 255 characters.

8. Generate GPX.
   Build a valid GPX document with metadata and track segments. Include elevation when present. Include time values only if `t` can be converted into a valid timestamp string.

9. Inject the export button.
   Add a single fixed-position button near the bottom of the page. Make it large enough for touch input, avoid blocking important page controls, respect mobile safe areas, and prevent duplicate injection if the page re-renders.

10. Wire the export flow.
    On click or tap, disable the button, fetch missing data if needed, generate the GPX blob, trigger a browser download, then restore the button to a ready state. Show a compact error message if the export fails.

11. Validate cross-browser behavior.
   Verify the injected button, API access, blob creation, and download behavior in Chrome and Firefox on desktop. Confirm the layout remains usable on small screens and that the export path works in Chrome or Firefox on Android where extension support is available.

## Decision Points

### How to discover the API URL

- If the full coordinates URL is present in page HTML or serialized data, parse it directly.
- If only the tour ID is present, derive the endpoint from the closest stable page data source.
- If neither is available after load, capture matching requests through a network interception strategy supported by the extension architecture.

### How to handle timestamps

- If `t` is a Unix timestamp in seconds, convert with second precision.
- If `t` is milliseconds, convert accordingly.
- If the format is unknown or missing, omit GPX `<time>` nodes instead of emitting invalid timestamps.

### How to trigger downloads

- If direct anchor download with a blob works in the content script, use the simpler approach.
- If browser restrictions block it, delegate to background logic using the downloads API.

## Quality Checks

The implementation is complete when all of these are true:

- one button is injected per page view and remains usable after client-side page updates
- the coordinates URL discovery works reliably on target Komoot tour pages
- `items` are converted into a valid GPX track in the correct order
- filename comes from the metadata `name` value, sanitized and truncated to 255 characters
- download works in Chrome and Firefox without manual copy/paste steps
- the button is usable on desktop and mobile-sized layouts, including Android browser use cases
- failures produce clear visible feedback instead of silent no-ops

## Failure Handling

- No matching Komoot API URL found: keep the button disabled or show a retry state.
- Coordinates response missing `items`: show an invalid-data error.
- Metadata response missing `name`: fall back to a deterministic filename such as `komoot-tour-:ID.gpx`.
- Download blocked: switch to the browser downloads API path.

## Suggested Deliverables

- manifest and extension entry points
- content script for page detection and button injection
- GPX generator utility
- filename sanitizer and truncation utility
- browser-specific download adapter if needed
- short test checklist for desktop and Android browser layouts

## Example Prompts

- `/komoot-tour-to-gpx Create a Manifest V3 extension skeleton for Chrome and Firefox using this workflow.`
- `/komoot-tour-to-gpx Implement the URL discovery and GPX export path for a Komoot tour page.`
- `/komoot-tour-to-gpx Add a mobile-safe fixed export button and download flow to the extension.`