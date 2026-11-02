# 2026-11-02 Offline lists work in the demo

Owner phone test, 2026-11-02: in the demo (Demo Town), adding an item while offline failed with "try again when online". It worked in a real account.

Cause: by design, the phone queue and the saved copies skipped the demo (`offline.account()` returned null for it, "the demo keeps nothing"). But the offline bar tells everyone they can add offline, and the judge steps (TRY-THE-FEATURES, section 4) say to try it in the demo.

Fix (web only):
- `lib/offline.ts`: `account()` now covers the demo too, so the demo keeps saved reads and queues list changes like a real account.
- Both last for the visit only. Saved reads were already deleted on every sign-in and sign-out (`forgetReads`). The demo's queue is dropped when a demo visit starts and when it ends (`listQueue.dropQueue`, called from `session.tsx` enter and leave), because the server-side sandbox of an older visit is gone.
- Server: a queued op in a demo session applies once to that visitor's sandbox (checked by hand: the same op id twice gives "duplicate"). No server change.
- Scan walks (Map my store) are unchanged: `scanQueue` does not use `account()`.

Tests: `listQueue.test.ts` (the demo queues, `dropQueue` forgets) and `api.test.ts` (the demo keeps a copy, and signing out deletes it). Web suite: 536 pass.
