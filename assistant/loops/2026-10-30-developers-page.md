# 2026-10-30 — Developer page (/developers)

Owner approved the mockup (option A, a simple public page) on 2026-10-30.

- `web/src/screens/Developers.tsx`: a public React screen. The app shows it
  before sign-in when the path is `/developers` (`App.tsx` Root). Words are in
  `en.json` under `developers.*`; styles are `.dev*` at the end of `styles.css`.
- `api/main.py`: `/developers` and `/developers/` answer the app shell (no login).
- Settings line (Use Arya in another AI app) now points to `/developers`.
- Phone order: hero, steps, endpoints, Not yet, Good to know, links. The mockup had
  Good to know before Not yet; the one grid keeps both columns on a wide window.
- Tests: `developers.test.tsx` (vitest, 6), `tests/test_developers_page.py`.
- The pre-launch line stays "Your lists, your data. Export anytime." The page does
  not say "open platform".
