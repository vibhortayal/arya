# 2026-10-29 — Refactor 3: routers for lists, items, expiry, intake, review, home, MCP

Behaviour-preserving move into `api/routes/`: `intake.py` (imports, decode, curator,
transcribe), `review.py`, `home.py` (Today, dashboard), `items.py` (item page, flags,
`_merge_flag`), `lists.py` (list add/remove/qty/move/check, named lists, staple judge),
`expiry.py`, `mcp_connector.py`. `_d_today` moved to `deps.py`.
One test patch target moved: `main.decode_photo` -> `intake.decode_photo`
(test_event_loop). Route table and first-match resolution identical to before.
