# 2026-10-30 — Start page paints before the bundle; longer image cache

From the 2026-10-30 audit (owner approved M1 and M7).

- M1: `web/index.html` holds the start page's first lines (`#boot`: logo,
  headline, subhead) in the real app classes, so they paint with the CSS
  instead of after the bundle runs. `pwa/boot.js` (a plain file; the
  CSP allows it) starts `/auth/status` and `/auth/me` while the bundle
  downloads; `app/session.tsx` reads them from `window.__boot` with the
  same meaning as before (null is "no answer", so the offline reopen
  from #294 still works). `boot.js` drops the shell for a returning
  account (`arya.lastUser`) and on `/developers`; `App.tsx` removes it
  in a layout effect when the session is ready. The worker precaches
  `/boot.js`.
- M7: `/assets` and `/icons` cache for a day (was an hour), `/vendor`
  (three.js, 670 KB) for a week.
- Carried over from the first Lighthouse pass (approved then, not
  merged): meta description; width and height on the store badges; the
  landing `beat` animation moves transform and a glow layer's opacity
  instead of box-shadow.
- Local A/B (same static server with gzip, Lighthouse devtools
  throttling, 390x844, 2 runs each): FCP and LCP 4.3 s to 1.7 s, score
  76 to 85. TBT rises (about 0 to 0.5 s) because the bundle's work now
  counts after the first paint; it is the same work.
- Tests: `session.test.tsx` (2 new: boot calls reused, offline via
  boot), `test_static_cache` (updated), `test_csp`, `test_landing`,
  `test_pwa_install`, `test_developers_page`, `test_add_to_home_screen`,
  vitest `src/app`, `signin`, `login`: green. Build checked.
- The shell is English only; other languages swap in when the app loads.
