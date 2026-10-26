# Smart Reply 0.10.5 — member lookup and queue recovery fixes

This build fixes two reproduced 0.10.4 issues: member pre-checks requiring an unavailable Currency All option, and replacement checks waiting behind the paused queue flag. It also preserves multiline username parsing and reports the actual pause reason.

Automated tests cover valid exact-member results on MYR-only lists, absent optional filters, restricted statuses and multiline account cells. Restricted empty searches still fail verification rather than falsely reporting Username not found. Browser queue tests reproduce a paused waiting task with no failed card, and main-button retry with other customers waiting.

After installing, reload the extension and refresh LiveChat. If old interrupted jobs are restored, click Resume queue once. Test the customer that previously stopped at Member List. If it still fails, copy the specific error shown in Check Queue; no live backend access was available in the development environment.

All 12 automated suites passed. Authenticated-backend confirmation remains pending; the screenshot establishes the paused state and the user's report locates the stop at Member List, but neither establishes which exact backend filter/layout caused the failure.
