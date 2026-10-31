# 2026-10-31 — Offline mode (read-only saved copy)

Owner ask: the installed app should open and be navigable with no signal,
keep a local copy of lists and other core data, and say what needs a
connection.

- The service worker already cached the app shell; `/api/*` reads bypass
  it on purpose. Added `web/src/lib/offline.ts`: `get()` in `lib/api.ts`
  keeps the last good body of nine read paths in localStorage
  (`arya.rc:<account>:<path>`) and answers from it when the read fails
  with no connection (TypeError). Server errors (401, 500) never use it.
- Not stored: cookies or tokens (auth is an HttpOnly cookie), the demo
  (keeps nothing), bodies over 400 KB. All copies are deleted by
  `forgetReads()` (sign-in and sign-out).
- boot.js's early `/api/settings` and `/api/today` reads keep a copy too
  (`keepBootRead`).
- A quiet bar (`#offlinebar`, shell) says "You're offline" and what needs
  a connection. Writes offline fail fast with an offline-worded error.
  Read-only on purpose: no write queue (conflicts with group live sync).
- Help upkeep: `prompts/arya_features.md` has an `offline` section.
- Tests: `lib/api.test.ts` (copy used on network failure, not on 500, no
  demo copy, cleared on sign-out); vitest 424 green; tsc clean. Checked in
  Chromium against a stub server: install, go offline, reload, Lists shows
  the saved item with the bar.
- Untested: real iOS PWA, real server. Next: other screens' reads
  (receipts list, stores) if the owner wants more offline.
