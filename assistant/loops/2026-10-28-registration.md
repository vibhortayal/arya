# 2026-10-28 — Public registration opened (Spark session)

Owner's word: "open" (after confirming registration was bootstrap-only).

- `POST /auth/register`: public sign-up through the existing
  `auth.create_user` (same validation: reserved names, duplicates).
  Setup stays bootstrap-only (403 once any account exists). Register
  adds two guards of its own: passwords must be at least 8 characters,
  and creations are capped per IP (10 per 15 minutes, mirroring the
  login-fail limiter). Success signs the new account in immediately.
- Sign-in form gains a mode toggle ("New here? Create account" /
  "Already have an account? Sign in"); bootstrap mode is unchanged
  and shows no toggle. New accounts land on Connect Muse, as before.
- Spend note: registered accounts can use the paid doors; the shared
  daily model budget remains the backstop. A per-account cap is the
  follow-up if sign-ups grow.
- Tests: suite 352 green (new test_register_opens_public_signup).
  Playwright drive on a local instance: bootstrap -> sign out ->
  toggle -> register -> Connect Muse -> sign in again -> duplicate
  refused with "user exists". All pass.
- Service worker arya-v37.
