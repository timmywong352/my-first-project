# Smart Reply — security review pending

Windows Defender reported `Trojan:Script/Ulthar.A!ml` in 0.10.6 and again removed the **0.10.7 review ZIP** on 27 October 2026 at 8:23 AM Malaysia time. Both builds are held. The 0.10.7 changes did not resolve the detection. Do not install a detected package or override protection.

[0.10.7 blocked-build status](downloads/security-review/README.md) · [Latest Microsoft review report](downloads/security-review/DEFENDER-REVIEW-0.10.7.txt) · [Validation and limitations](downloads/security-review/VALIDATION-0.10.7-review.md)

The candidate restricts background request senders and destinations, blocks authenticated redirects and removes execution-policy override advice. Fourteen automated suites passed, but Windows Defender and installed-extension verification remain incomplete. This is not a confirmed antivirus fix or a production release.

The normal update metadata and Google Drive files are unchanged. No Knowledge Hub reset or deletion is required. Old releases sharing flagged files are not certified safe by this review.
