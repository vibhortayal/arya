# 2026-11-01 Agent connector (MCP): review fixes

From the MCP code review (/mnt/project-files/mcp-review/MCP-REVIEW.md); owner said "MCP fix".

- High 1: file_receipt files the receipt, then runs the item judging only if `_budget_guard()` allows (daily budget, hourly freeze, monthly ceiling, reading off); otherwise the result says "Filed. Arya will sort these items later: <reason>".
- High 2: get_list and check_item use only items on the list (`on_list`), not Arya's suggestions; get_list returns qty, unit and list name.
- Medium 3: HTTPException and unexpected errors in a tool become tool errors (logged), not bare 500/503; subtotal/tax/total must be numbers.
- Medium 4: 401 on /api/mcp sends `WWW-Authenticate: Bearer`; initialize returns `instructions`.
- Medium 5: tokens are blocked from /api/receipts/jobs and /api/usage/unfreeze.
- Medium 6: demo calls to /api/mcp share the per-IP live-door cap; a demo list holds at most 200 items.
- Low 9: one log line per tool call. Low 11: AGENT-CONNECTOR.md path fixed.

Tests: tests/test_mcp.py (8 new). Python suite: 20 failures, same as main.
