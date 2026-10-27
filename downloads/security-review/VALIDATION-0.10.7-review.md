# Smart Reply 0.10.7 — security-review candidate, not a cleared release

Update, 27 October 2026: the user's 8:23 AM Malaysia-time screenshot reports Trojan:Script/Ulthar.A!ml for the 0.10.7 ZIP and status Removed. This candidate is now confirmed still blocked in the user's Defender environment; the security changes did not resolve that detection. The screenshot names the archive and source URL, without identifying an individual file inside it. The exact ZIP remains unchanged and is held for analysis.

The user reported Microsoft Defender `Trojan:Script/Ulthar.A!ml` against three JavaScript files in the 0.10.6 ZIP. That detection has **not** been independently reproduced or cleared. This candidate contains concrete security hardening, not a verified antivirus fix. Do not deploy to colleagues, override warnings or disable protection to install it.

## Changes

- Background messages must come from the main LiveChat frame or the exact packaged Archive/Detached pages. Matching the extension ID alone is no longer sufficient. OCR retains its separate token-bound message handler.
- Background requests are checked against documented HTTPS services or selected packaged configuration files. Credentials in URLs, unexpected destinations and unauthorised local resource paths are rejected. Redirected Google data is checked before being consumed; requests with Authorization headers reject redirects entirely. Ambient cookies are omitted.
- The batch updater no longer uses `ExecutionPolicy Bypass`. README no longer advises `Run anyway`. Existing Windows and organisation policies are respected. Older installed updater scripts have not been changed remotely.
- No browser permissions, host permissions, reply templates, Knowledge Hub schema or queue schema were added or changed. Processing/Submitting and Promotion fixes remain present.
- The flagged `archive-core.js` and `withdrawal-rules.js` are byte-identical to 0.10.6. They were not renamed, obfuscated or rewritten to alter detection signatures. Removing the updater alone would not address the JavaScript detections shown in the screenshot.

## Verification

All 14 automated suites passed on 2026-10-26. These include new tests for sender boundaries, blocked destinations, authenticated redirect policy, preserved OCR separation, malformed requests and absence of execution-policy override commands. Existing browser fixtures exercise reply insertion, languages, Promotion search, queued customers, cancellation and nonempty-composer protection. Manifest permissions were compared against 0.10.6 and are unchanged.

These are functional/security-boundary tests, not antivirus scans. No Windows Defender engine or Windows machine was available. No Microsoft submission or verdict exists. An independent ClamAV scan could not be performed: no scanner/signatures are installed and the official signature download returned HTTP 403. The installed-extension smoke test is blocked by this environment's administrator policy: Chromium's browser-level Extensions.loadUnpacked call returned “Loading of unpacked extensions is disabled by the administrator.” No attempt was made to change that policy. This explains the earlier startup timeouts; it does not validate the installed extension. Authenticated LiveChat/backend integration and Windows updater execution also remain untested here.

## Release handling

This candidate is separate from the normal update feed. The normal `version.json`, existing stable ZIP alias and Google Drive files are unchanged. No automatic-update metadata is supplied for the candidate. Browser data and settings are not reset, and no user file has been removed.

An authorised reviewer must scan the exact ZIP in an approved test environment, record Defender engine/signature versions and the result, request Microsoft analysis if detection persists, and complete an installed-extension smoke test before deciding whether it may be released. Do not restore or allow a detected file on the user's working PC to perform this review.
