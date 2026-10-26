# Smart Reply 0.10.7 — review candidate only

[Security-review ZIP](SMART-Reply-0.10.7-review.zip) · [Validation and limitations](VALIDATION-0.10.7-review.md) · [Original Defender report](DEFENDER-REVIEW-0.10.6.txt)

**This candidate is not a confirmed fix for the Defender alert. Do not deploy it, force a blocked download, restore a detected file, add exclusions or disable protection.** An authorised reviewer should assess the exact package in an approved testing environment.

Changes: restrict background messages to the main LiveChat frame and exact local panels; constrain network destinations; reject authenticated redirects; omit ambient cookies; respect PowerShell execution policy; remove old Run anyway advice. No additional browser permissions or backend actions are introduced, and no Knowledge Hub data is reset.

All 14 automated suites passed. These are not antivirus scans. Windows Defender/Microsoft review and installed-extension validation remain pending. The original flagged archive-core.js and withdrawal-rules.js are unchanged; the files were not disguised or renamed to change their signatures.

Normal update metadata and Google Drive are unchanged. This candidate deliberately has no automatic-update version.json.

ZIP SHA-256: `29defe06ef294870daa05f357f26d38f8243d2f5591596649143c884a3e10e12`.
