# 2026-10-29 — Email code and Google sign-in via Supabase Auth

Owner's word: "lets add supabase auth. That way we can capture real users"
(project khelo-staging-us, same project as the arya schema).

- `api/supabase_auth.py`: thin GoTrue REST client (httpx). Supabase only
  proves an email address; Arya keeps its own accounts and cookie.
- Endpoints: `POST /auth/email/start` and `/auth/email/verify` (code),
  `GET /auth/google` + `/auth/callback` + `POST /auth/supabase` (Google,
  token in the URL fragment handed to the server by the callback page).
  `/auth/status` reports `email_signin`.
- Account = the verified email, lowercased. An existing account with that
  name is reused; a new one has no password (`hash: null`, `verify`
  refuses it). `ARYA_SUPABASE_SIGNUP=0` limits it to existing accounts.
  Password sign-in and the registration lock are unchanged.
- Per-IP caps: 5 code requests and 10 verifies per 15 minutes.
- Feature flag `ARYA_SUPABASE_AUTH=1` (default off, also in compose as 0).
  Keys alone do nothing; it also needs `SUPABASE_URL` and `SUPABASE_ANON_KEY`
  (VM env only).
- Known gap: an existing password account named like an email is claimed
  by whoever proves that email. Fine while registration is locked.
- Owner steps in the Supabase dashboard: enable Email and Google
  providers; add `https://arya-pilot.duckdns.org/auth/callback` to the
  redirect allow-list; edit the Magic Link email template to include
  `{{ .Token }}` so the code shows.
- Tests: suite green (6 new). SW arya-v74.
