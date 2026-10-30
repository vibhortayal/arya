"""Agent connector (MCP): any MCP-capable assistant, one token."""
import datetime
import json
import math

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from api import state
from api.demo_guard import _demo_rate, _is_demo
from api.deps import _json_body, new_client
from api.routes.items import _merge_flag
from api.routes.lists import _add_name_to_list

router = APIRouter()

MCP_MAX_BODY = 256 * 1024     # bytes; a receipt with 200 lines is ~40 KB
MCP_MAX_RECEIPT_LINES = 200
_mcp_hits = {}                # username -> tools/call timestamps (rolling hour)


# --- Agent connector (MCP): any MCP-capable assistant, one token ---
# The connector is generic by design (owner, 2026-10-28): the account's
# API token authenticates /api/mcp through the same middleware as the
# REST doors, and each tool mirrors an existing REST behavior — the
# snapshot Ask reads, the shared add path, the flag check, and the
# structured intake (the agent reads the receipt; Arya verifies and
# files it). Muse Spark is the showcased client, not a special case.

def _mcp_get_snapshot(args):
    from api.chat_service import snapshot
    s = snapshot()
    return {"as_of": s["as_of"], "running_low": s["running_low"],
            "spend_total": s["spend_total"],
            "returns_total": s["returns_total"], "trips": s["trips"],
            "top_items": s["top_items"]}


def _mcp_get_list(args):
    d = state.derived()
    nm = state.names()
    return {"as_of": state.as_of(), "items": [
        {"name": i.get("name") or nm.get(i["item_id"], i["item_id"]),
         "item_id": i["item_id"], "checked": bool(i.get("checked"))}
        for i in d["smart_list"]["items"]]}


def _mcp_str(v):
    return v.strip() if isinstance(v, str) else ""


def _mcp_add_items(args):
    items = args.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("items must be a non-empty array of names")
    if len(items) > 50:
        raise ValueError("add at most 50 items per call")
    added = [_add_name_to_list(_mcp_str(n)[:120]) for n in items
             if _mcp_str(n)]
    if not added:
        raise ValueError("items must be a non-empty array of names")
    return {"added": added}


def _mcp_check_item(args):
    name = _mcp_str(args.get("name"))
    if not name:
        raise ValueError("name is required")
    d = state.derived()
    nm = state.names()
    checked = args.get("checked", True)
    if not isinstance(checked, bool):
        raise ValueError("checked must be true or false")
    want = name.lower()
    for i in d["smart_list"]["items"]:
        iname = i.get("name") or nm.get(i["item_id"], i["item_id"])
        if iname.lower() == want:
            _merge_flag(i["item_id"],
                        {"checked_on": state.cycle() if checked else None})
            return {"name": iname, "checked": checked}
    raise ValueError(f"{name} is not on the list")


def _mcp_file_receipt(args):
    merchant = _mcp_str(args.get("merchant"))
    purchased_at = _mcp_str(args.get("purchased_at"))
    try:
        day = datetime.date.fromisoformat(purchased_at)
    except ValueError:
        day = None
    if purchased_at and (day is None or day > datetime.date.today()):
        raise ValueError("purchased_at must be a real ISO date (YYYY-MM-DD) "
                         "that is not in the future")
    raw_lines = args.get("lines")
    if not merchant or not purchased_at or not isinstance(raw_lines, list) or not raw_lines:
        raise ValueError("a receipt needs merchant, purchased_at, and lines")
    if len(raw_lines) > MCP_MAX_RECEIPT_LINES:
        raise ValueError(f"a receipt can have at most {MCP_MAX_RECEIPT_LINES} lines")
    from api.decode.service import _finish
    lines = []
    for ln in raw_lines:
        if not isinstance(ln, dict) or not _mcp_str(ln.get("decoded_name")) \
                or isinstance(ln.get("line_total"), bool) \
                or not isinstance(ln.get("line_total"), (int, float)) \
                or not math.isfinite(ln["line_total"]):
            raise ValueError("every line needs decoded_name and a numeric line_total")
        lt = ln.get("line_type") or "item"
        lines.append({
            "raw": ln.get("raw") or ln["decoded_name"],
            "decoded_name": ln["decoded_name"],
            "qty": ln.get("qty") if isinstance(ln.get("qty"), (int, float)) else 1,
            "unit_price": ln.get("unit_price"),
            "line_total": float(ln["line_total"]),
            "line_type": lt if lt in ("item", "discount", "return") else "item",
            "sku": ln.get("sku"), "discount_parent_sku": ln.get("discount_parent_sku"),
            "confidence": ln.get("confidence") if isinstance(ln.get("confidence"), (int, float)) else 0.5,
            "alternatives": []})
    lines, reconcile = _finish(lines, args.get("subtotal"))
    rid = args.get("receipt_id")
    if not isinstance(rid, str) or not rid:
        import hashlib as _h
        rid = "ext-" + _h.sha1(json.dumps(args, sort_keys=True).encode()).hexdigest()[:10]
    dec = {"receipt_id": rid, "source_type": "muse",
           "merchant": merchant, "purchased_at": purchased_at,
           "lines": lines, "subtotal": args.get("subtotal"),
           "tax": args.get("tax"), "total": args.get("total"),
           "totals_reconcile": reconcile, "image_ref": None}
    added = state.add_receipts([dec])
    state.judge_pending(new_client())
    return {"receipt_id": rid, "merchant": merchant, "added": added,
            "lines": len(lines), "totals_reconcile": reconcile}


def _mcp_get_receipts(args):
    limit = args.get("limit")
    if isinstance(limit, bool) or not isinstance(limit, int):
        limit = 10
    limit = min(max(limit, 1), 100)
    out = []
    for r in state.receipts():
        total = r.get("total")
        if total is None:
            total = round(sum(ln.get("line_total") or 0 for ln in r.get("lines", [])), 2)
        out.append({"receipt_id": r["receipt_id"], "merchant": r.get("merchant"),
                    "purchased_at": r.get("purchased_at"), "total": total})
    out.sort(key=lambda x: x["purchased_at"] or "", reverse=True)
    return {"receipts": out[:limit]}


_MCP_HANDLERS = {
    "get_snapshot": _mcp_get_snapshot,
    "get_list": _mcp_get_list,
    "add_items": _mcp_add_items,
    "check_item": _mcp_check_item,
    "file_receipt": _mcp_file_receipt,
    "get_receipts": _mcp_get_receipts,
}


def _mcp_dispatch(msg, demo=False):
    """One JSON-RPC message in, one response dict out (None for a
    notification). Runs in a threadpool: tool handlers block on the
    file store and, for file_receipt, on the staple judge."""
    from api import mcp
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or "method" not in msg:
        return mcp.error(msg.get("id") if isinstance(msg, dict) else None,
                         -32600, "invalid request")
    rid = msg.get("id")
    method = msg["method"]
    if not isinstance(method, str):
        return mcp.error(msg.get("id"), -32600, "invalid request")
    params = msg.get("params") or {}
    if method.startswith("notifications/"):
        return None
    if method == "initialize":
        want = (params.get("protocolVersion")
                if isinstance(params, dict) else None)
        return mcp.result(rid, {
            "protocolVersion": want if want in mcp.PROTOCOL_VERSIONS
                               else mcp.DEFAULT_PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": mcp.SERVER_INFO})
    if method == "ping":
        return mcp.result(rid, {})
    if method == "tools/list":
        return mcp.result(rid, {"tools": mcp.TOOL_DEFS})
    if method == "tools/call":
        name = params.get("name") if isinstance(params, dict) else None
        handler = _MCP_HANDLERS.get(name if isinstance(name, str) else "")
        if name == "file_receipt" and demo:
            # Same rule as /api/intake/: filing a receipt (and the model
            # call that judges it) needs a real account.
            return mcp.result(rid, mcp.tool_error(
                "this needs a real account — the demo household keeps nothing"))
        if handler is None:
            return mcp.result(rid, mcp.tool_error(f"unknown tool: {name}"))
        if not demo and not _demo_rate(
                _mcp_hits, state._current_user.get() or "",
                "ARYA_MCP_RATE", 600):
            return mcp.result(rid, mcp.tool_error(
                "too many tool calls this hour — try again in a bit"))
        args = params.get("arguments") or {}
        if not isinstance(args, dict):
            return mcp.result(rid, mcp.tool_error("arguments must be an object"))
        try:
            data = handler(args)
        except ValueError as e:
            return mcp.result(rid, mcp.tool_error(str(e)))
        return mcp.result(rid, mcp.tool_result(data))
    return mcp.error(rid, -32601, f"method not found: {method}")


@router.post("/api/mcp")
async def mcp_route(req: Request):
    declared = req.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MCP_MAX_BODY:
        raise HTTPException(413, "request too large")
    body = await _json_body(req)
    resp = await run_in_threadpool(_mcp_dispatch, body, _is_demo(req))
    if resp is None:
        return Response(status_code=202)
    return resp
