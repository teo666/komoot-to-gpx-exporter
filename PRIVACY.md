# Privacy Policy — Komoot GPX Export

**Last updated:** June 2, 2026

## Overview

Komoot GPX Export is a browser extension that lets you export tour data from the Komoot website as GPX files. Your privacy is important — this extension is designed to work entirely on your device.

## Data Collection

This extension **does not collect, store, transmit, or share any personal data**. Specifically:

- **No analytics or telemetry** — No usage data, crash reports, or statistics are gathered.
- **No external servers** — The extension does not communicate with any server other than `api.komoot.de`, which is Komoot's own public API, and only to fetch tour coordinate and metadata that you explicitly request.
- **No cookies or tracking** — The extension does not read, write, or track cookies.
- **No user accounts** — The extension has no login, registration, or account system.

## Data Processing

All data processing happens **locally in your browser**:

1. The extension reads tour coordinate data from the Komoot page you are viewing.
2. It converts that data into a GPX file entirely on your device.
3. The GPX file is saved to your local downloads folder via the browser's built-in download manager.

No tour data, filenames, or any other information ever leaves your browser.

## Permissions

The extension requests the following browser permissions:

| Permission | Purpose |
|---|---|
| `downloads` | Save generated GPX files to your device via the browser's download manager. |
| `host_permissions` (`api.komoot.de`) | Fetch tour coordinates and metadata from Komoot's API when you request a download. |
| Content script on `komoot.com` | Detect tour data on the page and inject the export UI. |

## Third-Party Services

This extension does not integrate with any third-party analytics, advertising, or data-processing services.

## Changes to This Policy

If this policy is updated, the new version will be published alongside the extension update. The "Last updated" date at the top will reflect the most recent revision.

## Contact

If you have questions about this privacy policy, please open an issue on the project's GitHub repository.
