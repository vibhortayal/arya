# 2026-11-02 API tokens blocked from the Kroger routes

Owner go, 2026-11-02. Kroger's Developer Terms 5.e.2 forbid passing Kroger content to third parties. An API token (MCP or REST connector) could still call `/api/stores/kroger-aisle` and `/api/stores/kroger-trip`; only the hourly token cap applied (gap noted in docs/DECISIONS.md).

- `api/demo_guard.py`: `("/api/stores/kroger", None)` joins `_TOKEN_BLOCKED`. A token gets 403 "an API token cannot do this; use the app". The prefix matches only those two routes.
- The signed-in app (cookie) is unaffected: the quest's aisle hints call the same routes and still get 200.
- The MCP connector tools never call Kroger (no Kroger import or route in `api/mcp.py` or `api/routes/mcp_connector.py`), so nothing there changes.
- Test: `tests/test_kroger.py::test_api_token_cannot_reach_kroger_routes`; it fails without the guard line.
- Docs: ARCHITECTURE.md `ARYA_TOKEN_GUARDS` row, DECISIONS.md Kroger row (gap closed).
