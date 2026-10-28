"""MCP (Model Context Protocol) surface for the Arya agent connector.

The connector is generic: any MCP-capable assistant connects with the
account's API token (the same token the REST connector uses) and gets
the tools below. Muse Spark is the showcased client, not a special
case. This module holds the protocol envelopes and the tool catalog;
the handlers live in api/main.py beside the REST routes they mirror.

Transport: streamable HTTP, stateless. One POST of a JSON-RPC 2.0
message to /api/mcp returns one JSON response. Notifications (no id)
are accepted and answered with no body.
"""
import json

PROTOCOL_VERSIONS = ("2024-11-05", "2025-03-26", "2025-06-18")
DEFAULT_PROTOCOL_VERSION = "2025-03-26"
SERVER_INFO = {"name": "arya", "version": "1.0.0"}


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


TOOL_DEFS = [
    {
        "name": "get_snapshot",
        "description": "The household model in brief: what the account "
                       "is running low on, recent spend and returns, "
                       "trip count, and top items. Read-only.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_list",
        "description": "The current shopping list: item names, "
                       "quantities, and which items are checked off. "
                       "Read-only.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "add_items",
        "description": "Add items to the shopping list by name, the "
                       "way a person would say them ('oat milk', "
                       "'eggs'). Each name joins the list as a manual "
                       "item. Returns the items added.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "items": {"type": "array", "items": {"type": "string"},
                          "description": "Item names to add."}},
            "required": ["items"]},
    },
    {
        "name": "check_item",
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
        "description": "Recent filed receipts: merchant, date, and "
                       "total. Read-only.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 10}}},
    },
]
