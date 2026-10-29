# Owner registration toggle (2026-10-29)

Owner ask: flipping registration via ARYA_REGISTRATION_OPEN took an
.env edit + container recreate (three flips by hand on 2026-10-29).
He asked for an owner-only in-app switch instead.

Built:
- `api/deps.py`: the gate now reads a stored override first
  (`site.json` in the data root, `registration_open` bool), falling
  back to the env flag as the bootstrap default. `_is_owner` names
  the owner from ARYA_OWNER_USERNAME (operator-set; unset fails
  closed — nobody can flip).
- `api/routes/auth.py`: GET /auth/registration returns
  {registration_open, can_manage} for a signed-in account; POST
  {open: bool} flips it, owner only. /auth/* sits outside the login
  middleware's prefixes, so the handlers resolve the session cookie
  themselves (the /auth/me pattern); demo sessions are refused.
  Note: feedback.is_owner (first account wins) was deliberately NOT
  reused — on today's data the first account is a test account, so
  the toggle would belong to the wrong person.
- `api/chat_service.py`: the Ask feature sheet's registration_open
  flag now reads the same gate instead of the raw env var.
- Web: Profile's Account group gains a Registration switch row,
  rendered only when the server says can_manage; strings in en.json
  (settings.registration / registrationOn / registrationOff).
- Deploy wiring: compose passes ARYA_OWNER_USERNAME; .env.example
  documents it. The VM .env gains the owner's account name at
  deploy time.

Proof: Python suite 1260 OK (3 new tests in test_auth: owner flips
open/closed end-to-end, toggle overrides env, login+owner gating
with 401/403/400). Web: tsc clean, vitest 250/250.
