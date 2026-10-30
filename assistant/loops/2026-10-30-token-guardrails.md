# 2026-10-30 — API token guardrails (the cheap way)

Owner chose to keep one token for agents and scripts (agents are a real door
into the app) and close the biggest holes without changing Settings.

- Every route a token reaches now shares one hourly allowance (600, `ARYA_MCP_RATE`),
  with 429 and Retry-After. `/api/mcp` and `/api/v1` still count their own calls into
  the same bucket (`demo_guard._token_hits`), so nothing counts twice.
- A short blocked list answers 403 for a token: bulk model spend (chat, photo and
  shelf reads, avatars, judge, curator), groups, friends, push, feedback, settings
  changes, price sharing, account export, receipt delete through the app. The app
  (cookie) is unaffected. `ARYA_TOKEN_GUARDS=off` in deploy/.env lifts the list.
- Not done (after Nov 4): two key types in Settings (developer key for `/api/v1`,
  agent key for the connector), which needs a mockup first.

Tests: `tests/test_token_guards.py`.
