"""MCP (Model Context Protocol) surface for the Arya agent connector.

The connector is generic: any MCP-capable assistant connects with the
account's API token (the same token the REST connector uses) and gets
the tools below. Muse Spark is the showcased client, not a special
case. This module holds the protocol envelopes and the tool catalog;
the handlers live in api/routes/mcp_connector.py beside the REST
routes they mirror.

Transport: streamable HTTP, stateless. One POST of a JSON-RPC 2.0
message to /api/mcp returns one JSON response. Notifications (no id)
are accepted and answered with no body.
"""
import json

PROTOCOL_VERSIONS = ("2024-11-05", "2025-03-26", "2025-06-18")
DEFAULT_PROTOCOL_VERSION = "2025-03-26"
SERVER_INFO = {"name": "arya", "version": "1.0.0"}
INSTRUCTIONS = ("Arya is this person's grocery list and receipt history. Use get_list for what is on "
                "their list (only what they added; Arya's suggestions are not included), add_items to add "
                "by name, check_item to tick one off, get_snapshot for spending and what runs low, "
                "get_receipts for recent receipts, and file_receipt to file a receipt you have read "
                "(merchant, purchased_at, and lines with decoded_name and line_total). "
                "Every item goes on a named list: when they have more than one list and did not say which, "
                "ask them once, then call add_items with list. add_items returns that list as it stands "
                "after the add, so there is no need to call get_list again.")


def lists_line(names):
    """This account's list names, said up front so an agent asks
    "which list?" once instead of learning them from a failed add
    (owner, 2026-11-04: Muse took 5-6 calls for one add)."""
    if not names:
        return "They have no lists yet: ask them to make one in Arya (Lists, New list) before adding."
    if len(names) == 1:
        return f"Their one list is {names[0]}; adds go there."
    return "Their lists: " + ", ".join(names) + "."


def instructions(names):
    return INSTRUCTIONS + " " + lists_line(names)


def tool_defs(names):
    """TOOL_DEFS with this account's list names in add_items, so the
    agent knows them before its first call."""
    out = []
    for t in TOOL_DEFS:
        if t["name"] == "add_items":
            t = json.loads(json.dumps(t))
            t["description"] += " " + lists_line(names)
            if names:
                t["inputSchema"]["properties"]["list"]["description"] += " One of: " + ", ".join(names) + "."
        out.append(t)
    return out


def result(rid, value):
    return {"jsonrpc": "2.0", "id": rid, "result": value}


def error(rid, code, message):
    return {"jsonrpc": "2.0", "id": rid,
            "error": {"code": code, "message": message}}


def tool_result(data):
    """A successful tools/call result: the data as structured content
    plus a text rendering for clients that only read content."""
    return {"content": [{"type": "text", "text": json.dumps(data)}],
            "structuredContent": data, "isError": False}


def tool_error(message):
    return {"content": [{"type": "text", "text": message}],
            "isError": True}


READ_ONLY = {"readOnlyHint": True}
ADDITIVE = {"readOnlyHint": False, "destructiveHint": False}

TOOL_DEFS = [
    {
        "name": "get_snapshot",
        "annotations": READ_ONLY,
        "description": "The household model in brief: what the account "
                       "is running low on, recent spend and returns, "
                       "trip count, and top items. Read-only.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_list",
        "annotations": READ_ONLY,
        "description": "The current shopping list: item names, "
                       "quantities, which list each is on, and which "
                       "items are checked off; plus the names of all "
                       "their lists. Read-only.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "add_items",
        "annotations": ADDITIVE,
        "description": "Add items to the shopping list by name, the "
                       "way a person would say them ('oat milk', "
                       "'eggs'). Each name joins a named list as a "
                       "manual item. Pass `list` (a list's name or id) "
                       "when the user has more than one list; if you "
                       "leave it out and Arya cannot tell which list, "
                       "nothing is added and the error names the lists "
                       "to ask the user about. Returns the items added and "
                       "that list's items after the add.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "items": {"type": "array", "items": {"type": "string"},
                          "description": "Item names to add."},
                "list": {"type": "string",
                         "description": "The list to add to, by name or id (e.g. 'Costco')."}},
            "required": ["items"]},
    },
    {
        "name": "check_item",
        "annotations": ADDITIVE,
        "description": "Check an item off the list (or uncheck it) by "
                       "name — for 'I bought the milk' updates. The "
                       "item must be on the list.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "checked": {"type": "boolean", "default": True}},
            "required": ["name"]},
    },
    {
        "name": "file_receipt",
        "annotations": ADDITIVE,
        "description": "File a receipt the agent has already read "
                       "(from a photo, an email, or an order page). "
                       "Arya verifies the arithmetic, files the lines, "
                       "and learns from them; it spends no perception "
                       "tokens of its own. Returns the receipt id and "
                       "whether the totals reconcile.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "merchant": {"type": "string"},
                "purchased_at": {"type": "string",
                                 "description": "ISO date, e.g. 2026-10-28."},
                "lines": {"type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "decoded_name": {"type": "string"},
                        "line_total": {"type": "number"},
                        "qty": {"type": "number"},
                        "unit_price": {"type": "number"}},
                    "required": ["decoded_name", "line_total"]}},
                "subtotal": {"type": "number"},
                "total": {"type": "number"}},
            "required": ["merchant", "purchased_at", "lines"]},
    },
    {
        "name": "get_receipts",
        "annotations": READ_ONLY,
        "description": "Recent filed receipts: merchant, date, and "
                       "total. Read-only.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 10}}},
    },
]
