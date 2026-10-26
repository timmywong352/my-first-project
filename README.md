# Smart Reply — security review pending

Windows Defender reported `Trojan:Script/Ulthar.A!ml` in three JavaScript files in the 0.10.6 ZIP. The detection has not been cleared. Do not bypass warnings or install a detected package.

[0.10.7 security-review candidate](downloads/security-review/README.md) · [Validation and limitations](downloads/security-review/VALIDATION-0.10.7-review.md) · [Original detection review report](downloads/security-review/DEFENDER-REVIEW-0.10.6.txt)

The candidate restricts background request senders and destinations, blocks authenticated redirects and removes execution-policy override advice. Fourteen automated suites passed, but Windows Defender and installed-extension verification remain incomplete. This is not a confirmed antivirus fix or a production release.

The normal update metadata and Google Drive files are unchanged. No Knowledge Hub reset or deletion is required. Old releases sharing flagged files are not certified safe by this review.
