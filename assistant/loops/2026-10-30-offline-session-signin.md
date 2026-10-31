# 2026-10-30 — Offline reload keeps you signed in; sign-in form fixes

From the 2026-10-30 audit (owner approved H1, M5, M6).

- H1: a reload with no signal opened the sign-in page, because `/auth/me`
  failing read as "signed out". `app/session.tsx` now keeps the last
  account's name (`localStorage arya.lastUser`, name and demo flag only).
  No answer from `/auth/me` opens the app as that account. An explicit
  `{ user: null }` drops it, as does sign out. When the signal comes
  back, a session that ended meanwhile signs out.
- M6: signing in on `/team` replaces the address with `/`, so a bookmark
  or Home Screen icon does not keep the team door.
- M5: the password form posts (`method="post"`) and names its fields
  (`username`, `password`), so a submit before the app takes over can
  never put a password in a URL.
- Tests: `web/src/app/session.test.tsx` (new, 6) and one in
  `web/src/screens/signin.test.tsx`. Ran: `session`, `signin`, `login`,
  `nav` (vitest) and `test_landing`, `test_list_first`, `test_fun_pass`,
  `test_pwa_install`, `test_small_ux`, `test_no_connect_first_run`,
  `test_csp`, `test_auth`, `test_sessions` (all green, as on main).
  `nav.test.tsx` prints jsdom "window.scrollTo not implemented" noise
  on main too.
- Not verified on a phone. Screens still need signal for their data:
  this keeps the app and the hunt's offline outbox reachable.
