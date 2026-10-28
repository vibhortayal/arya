# Lock new user creation (owner, 2026-10-28)

Owner reversed the same-day open: registration is locked again.

- Server: `POST /auth/register` returns 403 "registration is closed"
  unless the operator sets `ARYA_REGISTRATION_OPEN=1` in the service
  environment (no code change to reopen). `/auth/status` now reports
  `registration_open`. Setup (bootstrap) and login unchanged; existing
  accounts and the demo are unaffected.
- PWA: the sign-in form shows the "New here? Create account" toggle
  only when the server reports registration open; the toggle handler
  also refuses when locked. SW cache bumped to arya-v50.
- Tests: new `test_register_locked_by_default` (403, no account
  created, owner login unaffected); the open-signup test now runs
  under the env flag; test_mcp's isolation test opens the flag for
  its register call.
