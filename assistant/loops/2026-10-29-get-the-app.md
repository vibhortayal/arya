# 2026-10-29 — "Get the app" pill on the landing

What changed (owner-approved mockup, "make it jiggle"):
- `screens/Login.tsx`: a "Get the app" pill in the landing header, before
  Sign in. It shows only on a phone where `ui/A2hs.tsx` says installing is
  possible (not standalone; iPhone, or a captured install prompt). The demo
  rule does not apply (logged out). Tap: Android runs the install prompt,
  iPhone opens the shared steps sheet.
- Jiggle 0.6 s of every 8 s, from 1.2 s after load (CSS `getjiggle`);
  reduced motion gets a glow (`getglow`) at the same beat. The first tap
  stops it for good (`arya.landing.getapp`).
- `ui/A2hs.tsx`: exports `useA2hs`, `A2hsSteps`, `isIOS`. The steps sheet
  is now "Get the Arya app" with an intro line and a sign-in tip, in all
  three places (landing, Today, Settings). Today's card shows from the
  first visit (the list rule and the 30-day dismiss stay).

Tests: vitest 273 (6 new in `screens/getapp.test.tsx`), Python pins updated
(`test_landing.py`, `test_add_to_home_screen.py`), e2e 44 files green;
`login.e2e.mjs` checks the pill on an iPhone UA (one-line header at 390
and 360, both buttons in 390x664, the steps sheet opens). No model spend.

Next: owner review of the branch.
