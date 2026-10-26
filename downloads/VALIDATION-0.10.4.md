# Smart Reply 0.10.4 — validation build

Automated validation: all 12 test suites passed on 26 October 2026.

Coverage includes FIFO execution, per-chat isolation, exact-member lookup, verified missing-member continuation, logout/loading failure pause, retry precedence, skip/resume, queued cancellation, duplicate prevention, timeout and late responses, metadata-only reload recovery, composer preservation, and no automatic sending. Member List tests use browser-rendered fixtures with real form submission/navigation and the backend search/reader implementation. They are not a live backend acceptance test.

The owner's authenticated backend and real LiveChat conversations are not accessible in this development environment. Production acceptance is therefore pending.

Before sharing with colleagues:

1. Keep the working extension folder and Knowledge Hub backup. Install these files into the existing extension folder, reload the extension, then refresh LiveChat.
2. Queue three different chats. Verify names, order and results, including switching back to each chat.
3. Use one deliberately incorrect username. Verify “Username not found”, no transaction searches for that name, and automatic continuation for the next customers. Correct it in its original chat and retry.
4. Log out of the backend during a check. Verify “Loading failed” and that later customers do not run. Log in, then use Retry current. Separately verify that Skip alone leaves the queue paused until Resume queue is clicked.
5. Cancel a waiting task; it must never reach the backend. Refresh during waiting/running work; interrupted tasks must require manual retry.
6. Verify full reply insertion in the correct chat with an empty composer, and preservation of existing typed text. No message should be sent automatically.

Do not treat this build as production-ready until the above live checks pass. Minimal recovery metadata is stored per browser tab; full backend reports and reply text are not retained by queue recovery. Closing the browser tab may end that recovery session.
