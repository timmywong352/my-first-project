# Smart Reply 0.10.6 — Promotion searches and Submitting replies

## Changes

- `Submitting` now maps to the same owner-approved full reply as `Processing`, in English, Malay and Chinese. Clicking the highlighted result inserts the prepared sentence into an empty LiveChat composer. It never sends a message.
- Promotion search no longer requires currency/status controls when the report has none. Present controls must still support MYR/All. Duplicate controls, restrictive unknown filters and login pages remain errors. Deposit and Withdrawal filter requirements are unchanged.
- Exact-member matching, queue isolation, report freshness, promotion credit verification and protection of existing composer text remain in place.

## Automated verification

All 13 test suites in `SMART-enhanced/tests/*.test.cjs` passed on 2026-10-26.

The new Promotion browser test executes the real search, reader and background report code against local fixtures. It reproduces the pre-fix error `Report MYR filter label is not verified. Use manual search.` on a Promotion form without Currency. It verifies successful navigation/readback with missing optional controls or MYR/All controls, repeated searches for different members, Today/7-day ranges, manual rereads, rejection of changed/duplicate filters, logout handling and retained Deposit/Withdrawal restrictions.

The Quick Check browser test also verifies the full Processing/Submitting reply is inserted into the LiveChat composer in English, Malay and Chinese, rather than the waiting reply, with no send action. Existing tests cover queue order, failed searches, cancellation/retry, chat switching, untouched nonempty composers, stale results and promotion-only report selection.

## Live acceptance still required

No authenticated backend was accessible during development. The reproduced optional-filter bug may explain the reported Loading failed, but the user's exact live page layout and technical error were not available.

After replacing files in the existing extension folder, reload the extension and refresh LiveChat. Test Promotion alone with Today and 7 days. Then test a Processing/Submitting withdrawal and click its result in the selected language. Confirm that only the empty LiveChat composer is filled, and send manually after review. If Promotion still fails, copy the detailed error beneath Loading failed.

Google Drive has not been updated. The existing Drive updater configuration is unchanged. To distribute through that updater, replace its existing ZIP and version.json with this matching release pair.
