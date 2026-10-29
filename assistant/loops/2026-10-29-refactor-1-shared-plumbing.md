# 2026-10-29 — Refactor 1: shared plumbing out of main.py

Behaviour-preserving. No route, payload, or screen changed.

- `api/deps.py`: cost ledger path, `_ledger`, `_budget_guard`, the login/register/code
  rate-limit buckets, `_client_ip`, JSON body helpers, session cookie, and the new
  `new_client()` (replaces 30 copies of `MetaClient(ledger=_ledger())`).
- `api/demo_guard.py`: demo sandbox, demo door caps, `_is_demo`, and the `require_login`
  middleware (registered in main with `app.middleware("http")(require_login)`).
- Tests: only the patch targets moved (`main.MetaClient` -> `deps.MetaClient`,
  `main._LEDGER` -> `deps._LEDGER`, and the moved limiter dicts). Route table identical
  before and after (same paths, methods, order).
- Next: routers by area (auth/account, lists, quest, eyes/chat, store map).
