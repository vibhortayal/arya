# 2026-11-13 Public About page and landing link

Owner approved the mockup (2026-11-13, "approved"): an About link first in the landing footer, and a public page at /about that needs no sign-in (like /developers).

- `ui/AboutStory.tsx` holds the note and the credit lines once; About in Settings and the new `screens/PublicAbout.tsx` both use it. The public page leaves out the Settings rows and adds Back and Try Arya (both go to the landing page).
- `lib/paths.ts` isAboutPath, `App.tsx` shows the page before sign-in, `api/main.py` answers /about and /about/ with the app shell.
- Help topic "Who built Arya, and why" gets a note about the landing link; `arya_features.md` matches.

Tests: vitest 609 passed (publicabout.test.tsx new); Python test_developers_page now covers /about, plus the string-reading tests that touch About, all pass. Screenshots at 390x844 from the real build.
