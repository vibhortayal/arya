# MCP agent connector — build log (2026-10-28)

Trigger: owner — the agent connector must be generic and MCP-ready
for the hackathon, showcased with Muse Spark; Arya is collaborative,
not a competitor to list apps (collect + simplify via the assistant).

Built (branch feat/mcp-agent-connector):
- api/mcp.py: protocol envelopes + tool catalog. api/main.py:
  POST /api/mcp — stateless streamable-HTTP JSON-RPC (initialize,
  ping, tools/list, tools/call, notifications). Auth rides the
  existing middleware: the account's API token (same token as the
  REST connector) or session cookie; demo writes land in the sandbox.
- Tools: get_snapshot, get_list, add_items, check_item, file_receipt,
  get_receipts — each mirrors an existing behavior (Ask's snapshot,
  the shared add path, the flag check, structured intake).
- Found while testing: on an account with no receipts, as_of() is
  None and state.derived() marked every flagged item checked
  (None == None). Guarded: checked_on must be a real date. This hit
  brand-new accounts — the ones registration (PR #19) just enabled.
- Parity verified: MCP file_receipt and REST /api/intake/structured
  produce identical snapshots for the same receipt (spend resolves
  after the staple judge files new items in the dictionary, both
  doors).

Checks: test_mcp.py 6 tests (auth, handshake, add/check/list,
file+reads, protocol edges, account isolation); full suite 358;
over-HTTP drive of a booted server (initialize, add, list) passed.
Docs: assistant/docs/AGENT-CONNECTOR.md; README + SUBMISSION-DRAFT
carry the collaborative positioning.
