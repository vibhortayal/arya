# 2026-10-30 — boot.js revalidates; owner rows only for owners; keyboard and unit wrap

From the 2026-10-30 audit follow-up (owner approved).

- `boot.js` keeps its name across builds, so `api/main.py` serves it
  `no-cache` like `index.html` and `sw.js`; a phone never keeps an old one.
- L7: `/auth/me` now carries `owner` and `waitlist_admin` (false for the
  demo). Settings shows the registration switch and the waitlist row only
  when they are true, so other accounts no longer call the owner-only
  routes and log a 401 or 403.
- L11: the list's add field has `enterKeyHint="done"`.
- L5: `lib/format.keepUnit` joins a number to its unit with a no-break
  space ("6 ct", "10 lb", "1 gal"); list rows use it.
- Tests: `test_auth` (1 new), `test_static_cache` (1 new),
  `format.test.ts` (1 new); also `test_sessions`, `test_developers_page`,
  `test_profile_simple`, `test_waitlist`, `test_list_pass`,
  `test_lists_qa_oct30`, `test_list_first`, `test_small_ux`, vitest
  `src/app`, `signin`, `login` and the list and profile screen tests: green.
