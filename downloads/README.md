# Smart Reply 0.10.5

[Extension ZIP](SMART-Reply-0.10.5.zip) · [version.json](version.json) · [Validation details](VALIDATION-0.10.5.md)

Extract the ZIP into the existing Smart Reply extension folder, reload the extension, and refresh LiveChat. Click Resume queue once if interrupted checks are restored, then retry the affected username.

This release fixes a member-precheck dependency on Currency All and the main-button retry path leaving replacement jobs paused. It retains exact-member verification, FIFO processing, explicit resume after failures, and draft-only replies.

All 12 automated suites passed; live authenticated-backend validation remains pending.

SHA-256: `725fcaf02977f0f7ae98be2086e6d9bd2b12ef8aff07a5a01732e65c65c34d5c`.
