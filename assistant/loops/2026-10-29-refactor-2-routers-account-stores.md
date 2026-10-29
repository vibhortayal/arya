# 2026-10-29 — Refactor 2: routers for auth, eyes, chat, stores, account, store map

Behaviour-preserving move of 70 routes out of `api/main.py` into `api/routes/`:
`auth.py`, `eyes.py`, `chat.py`, `stores.py`, `account.py` (settings, export, feedback, push),
`storemap.py`. `_PWA` now lives in `deps.py`. No test changed. Route table (paths, methods)
identical and first-match resolution checked path by path against the old table.
Interim: the `include_router` lines sit where each block used to be; the last refactor PR
gathers them in one place.
