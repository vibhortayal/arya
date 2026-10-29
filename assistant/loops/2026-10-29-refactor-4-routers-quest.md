# 2026-10-29 — Refactor 4: quest routers; main.py is now the composition root

Quest routes moved to `api/routes/`: `quest.py` (plan, sessions, check-off, receipt,
Shop-Off, missing reports, haul photo), `shelf.py` (scan, shelf photo, locate),
`friends.py`, `avatar.py`, `receipts.py`. `api/main.py` is ~60 lines: app, middleware,
the RuntimeError handler, /health, one ordered `include_router` list, and the static mount.
No test changed. Route set identical; first-match resolution identical for every path.
