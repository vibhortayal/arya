# 2026-10-31 — Developer portal (/developers, /developers/reference)

Owner approved the mockup on 2026-10-31 (research on Stripe, Twilio, GitHub and
Plaid docs; Swagger answer: keep OpenAPI as the source, draw it with Scalar).

- `web/src/screens/Developers.tsx`: quickstart (curl, Python, JavaScript tabs,
  copy), auth, endpoints with search (`/` focuses it), errors table, limits,
  changelog, Not yet. Side list on wide windows, chips on a phone. Words under
  `developers.*` in en.json; styles `.dev*` in styles.css.
- `api/routes/lists_v1.py`: the schema gets plain operation ids, summaries,
  descriptions, tags, the bearer scheme and 401/429 error shapes (`_OPS`).
  Routes are untouched.
- `pwa/developers/reference.html` + `pwa/vendor/scalar/standalone.js`: Scalar
  1.76.4 (MIT, listed in NOTICE.md) vendored, no CDN. No inline script, so the
  app's CSP is unchanged (checked in a browser under the Caddy policy). Settings
  are data attributes; system fonts; Scalar's Developer Tools, Ask AI, MCP and
  Models are off. Route `/developers/reference` in `api/main.py`, public.
- Not built: a status page (needs real monitoring), SDKs, a changelog page.
- Tests: `developers.test.tsx` (+4), `TestSchemaForDevelopers` (3).
- Deploy: `docker compose up -d --build`; no Caddy change.
