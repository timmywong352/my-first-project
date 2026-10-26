# Security notice — 0.10.6 detection unresolved

Windows Defender reported Trojan:Script/Ulthar.A!ml in three JavaScript files inside the 0.10.6 ZIP. Do not override the detection or treat the older release instructions below as security clearance. See the [0.10.7 review candidate and limitations](security-review/README.md). No candidate has been promoted to version.json or Google Drive.

## Previous 0.10.6 release information (not cleared for installation)

[Extension ZIP](SMART-Reply-0.10.6.zip) · [version.json](version.json) · [Validation details](VALIDATION-0.10.6.md)

Extract the ZIP into the existing Smart Reply extension folder, reload the extension, and refresh LiveChat. Click Resume queue once if interrupted checks are restored, then retry Promotion with Today and 7 days.

Processing and Submitting use the owner's full processing reply, with English, Malay and Chinese support. Promotion reports without optional currency/status controls can now be searched and read. Present filters, exact-member verification, FIFO processing, explicit resume after failures and draft-only replies remain protected.

All 13 automated suites passed; live authenticated-backend validation remains pending. Google Drive has not been updated; its ZIP and version.json must be replaced with this matching pair before the existing Drive updater can serve this release.

SHA-256: `db2628e65dbf719b5dc88e728a23910e36bd0bb355e7889979ae7ad8d25663df`.
