"""Open Lists API, v1: read and write your own lists from another app.

A small, versioned wrapper over the list routes. It authenticates with
the same personal API token as the agent connector (bearer only, never
the cookie), shares the connector's per-account hourly limit and size
caps, and answers errors as {"error": {"code", "message"}}. It holds
no list logic of its own: every write goes through the helpers in
routes/lists.py. /api/v1 is frozen once shipped; changes are additive.
Documented in docs/API.md."""
import time
from typing import List, Optional, Union

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from api import open_data, state
from api.demo_guard import _demo_rate
from api.list import export
from api.list.intake import amount, clean_unit, split_text_lines
from api.routes import lists as L
from api.routes.mcp_connector import MCP_MAX_BODY, _mcp_hits

UNFILED = "unfiled"            # the id of "Everything else"
MAX_ADD = 50                   # items per add call, as the MCP connector
MAX_IMPORT_ROWS = 500

v1 = FastAPI(
    title="Arya Lists API", version="1.0.0", docs_url=None, redoc_url=None,
    description="Read and write your own Arya lists. Authenticate with "
                "your personal API token: Authorization: Bearer YOUR_CODE.")

_CODES = {400: "bad_request", 401: "unauthorized", 404: "not_found",
          405: "method_not_allowed", 409: "conflict", 413: "too_large",
          415: "unsupported_media_type", 422: "bad_request",
          429: "rate_limited"}


def _err(status, message, headers=None, code=None):
    return JSONResponse(
        {"error": {"code": code or _CODES.get(status, "error"),
                   "message": message}},
        status_code=status, headers=headers)


@v1.exception_handler(StarletteHTTPException)
async def _http_error(request, exc):
    return _err(exc.status_code, str(exc.detail), getattr(exc, "headers", None))


@v1.exception_handler(RequestValidationError)
async def _invalid(request, exc):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
    return _err(400, f"{where}: {first.get('msg', 'invalid request')}".strip(": "))


@v1.exception_handler(Exception)
async def _unhandled(request, exc):
    return _err(500, "something went wrong; try again", code="internal_error")


@v1.middleware("http")
async def _guard(request: Request, call_next):
    """The connector's hourly limit and size cap, before any body is read."""
    user = state._current_user.get()
    if user:
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MCP_MAX_BODY:
            return _err(413, "request too large")
        if not _demo_rate(_mcp_hits, user, "ARYA_MCP_RATE", 600):
            oldest = min(_mcp_hits.get(user) or [time.time()])
            wait = max(1, int(3600 - (time.time() - oldest)))
            return _err(429, "too many calls this hour; try again later",
                        headers={"Retry-After": str(wait)})
    return await call_next(request)


async def _body_bytes(req):
    body = await req.body()
    if len(body) > MCP_MAX_BODY:
        raise HTTPException(413, "request too large")
    return body


# ---- shapes -----------------------------------------------------------

class Item(BaseModel):
    id: str
    name: str
    qty: float
    unit: str
    checked: bool
    aisle: Optional[str]
    added_at: Optional[str]
    list_id: str


class ListSummary(BaseModel):
    id: str
    name: str
    stores: List[str]
    open_count: int


class ListDetail(ListSummary):
    items: List[Item]


class NewItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    qty: Optional[float] = Field(None, ge=0.1, le=99)
    unit: Optional[str] = Field(None, max_length=16)
    aisle: Optional[str] = Field(None, max_length=40)


class AddItems(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: Optional[List[Union[NewItem, str]]] = Field(None, max_length=MAX_ADD)
    text: Optional[str] = Field(None, max_length=20000)


class ItemPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    checked: Optional[bool] = None
    qty: Optional[float] = Field(None, ge=0.1, le=99)
    unit: Optional[str] = Field(None, max_length=16)
    list_id: Optional[str] = None
    aisle: Optional[str] = Field(None, max_length=40)


# ---- reading the account's lists ---------------------------------------

def _list_rows():
    """Every list the account can address: Everything else, then the
    named lists in creation order."""
    return [{"id": UNFILED, "name": "Everything else", "stores": []}] + [
        {"id": l["id"], "name": l["name"], "stores": l.get("stores") or []}
        for l in state.named_lists()]


def _items():
    """Every item on the household's lists, as the API shape."""
    flags = state.flags()
    out = []
    for i in state.derived()["smart_list"]["items"]:
        if not i.get("on_list"):
            continue
        f = flags.get(i["item_id"], {})
        out.append({
            "id": i["item_id"], "name": i["name"], "qty": i.get("qty") or 1,
            "unit": i.get("unit") or "", "checked": bool(i.get("checked")),
            # Only a department the user set: Arya's own guess stays inside Arya.
            "aisle": f.get("aisle") or None,
            "added_at": f.get("added_at"), "list_id": i.get("list") or UNFILED})
    return out


def _list_or_404(list_id):
    row = next((r for r in _list_rows() if r["id"] == list_id), None)
    if row is None:
        raise HTTPException(404, "no such list")
    return row


def _summary(row, items):
    mine = [i for i in items if i["list_id"] == row["id"]]
    return {**row, "open_count": sum(1 for i in mine if not i["checked"])}, mine


def _item_or_404(item_id):
    item = next((i for i in _items() if i["id"] == item_id), None)
    if item is None:
        raise HTTPException(404, "no such item on your lists")
    return item


def _real_list_id(list_id):
    """The stored list id: Everything else is no list at all."""
    return None if list_id in (None, "", UNFILED) else list_id


@v1.get("/lists", response_model=List[ListSummary])
def get_lists():
    items = _items()
    return [_summary(r, items)[0] for r in _list_rows()]


@v1.get("/lists/{list_id}", response_model=ListDetail)
def get_list(list_id: str):
    row = _list_or_404(list_id)
    head, mine = _summary(row, _items())
    return {**head, "items": mine}


# ---- adding ------------------------------------------------------------

def _qty_unit(qty, unit):
    """A structured qty/unit as the list stores them: an amount with a
    unit keeps one decimal, a bare count is whole."""
    unit = clean_unit(unit)
    if qty is None:
        return 1, unit
    return (amount(qty) if unit else max(1, min(int(qty), 99))), unit


@v1.post("/lists/{list_id}/items")
async def add_items(list_id: str, req: Request, body: AddItems):
    await _body_bytes(req)
    _list_or_404(list_id)
    if (body.items is None) == (body.text is None):
        raise HTTPException(400, "send either items or text")
    real = _real_list_id(list_id)
    if real is None:
        # Every item on a list (owner, 2026-11-02): new items go on a
        # named list; with exactly one list, that one.
        rows = state.named_lists()
        if len(rows) != 1:
            raise HTTPException(400, "add to a named list: " + (", ".join(f"{l['name']} ({l['id']})" for l in rows)
                                                              or "make a list in Arya first"))
        real = rows[0]["id"]
    aisle_for = {}
    if body.items is not None:
        typed = []
        for it in body.items:
            it = NewItem(name=it) if isinstance(it, str) else it
            name = " ".join(it.name.split())
            if not name:
                raise HTTPException(400, "item names cannot be empty")
            qty, unit = _qty_unit(it.qty, it.unit)
            typed.append((name, qty, unit))
            if it.aisle:
                aisle_for[name] = " ".join(it.aisle.split())
        skipped = []
    else:
        # Deterministic split only ($0): the API never spends model calls.
        typed, skipped = split_text_lines(body.text)
        typed, skipped = typed[:MAX_ADD], skipped[:5]
    # One row per item: a name already on a different list is not moved
    # (the in-app add would move it). It stays put and is reported.
    from api.list.intake import existing_item_id
    here = {i["id"]: i for i in _items()}
    entries, flags = state.dictionary()["entries"], state.flags()
    elsewhere, keep = [], []
    for t in typed:
        known = existing_item_id(t[0], entries, flags)
        at = here.get(known)
        if at and at["list_id"] != list_id:
            elsewhere.append({"name": t[0], "item_id": known, "list_id": at["list_id"],
                              "list_name": _list_or_404(at["list_id"])["name"]})
        else:
            keep.append(t)
    typed = keep
    reply = L._add_typed(typed, real, skipped=skipped)
    for (name, _q, _u), item_id in zip(typed, reply["all_item_ids"]):
        if name in aisle_for:
            L._merge_flag(item_id, {"aisle": aisle_for[name]})
    mine = {i["id"]: i for i in _items()}
    return {"added": reply["added"], "already": reply["already"],
            "already_names": reply["already_names"], "also_on": elsewhere,
            "skipped": reply["skipped"],
            "items": [mine[i] for i in dict.fromkeys(reply["all_item_ids"])
                      if i in mine]}


# ---- changing and removing ---------------------------------------------

@v1.patch("/items/{item_id}", response_model=Item)
async def patch_item(item_id: str, req: Request, body: ItemPatch):
    await _body_bytes(req)
    item = _item_or_404(item_id)
    sent = body.model_fields_set
    if not sent:
        raise HTTPException(400, "send at least one field to change")
    if "checked" in sent and body.checked is None:
        raise HTTPException(400, "checked must be true or false")
    if "qty" in sent and body.qty is None:
        raise HTTPException(400, "qty must be a number")
    real = _real_list_id(body.list_id) if "list_id" in sent else None
    if real and not any(l["id"] == real for l in state.named_lists()):
        raise HTTPException(404, "no such list")
    # Everything is checked before the first write.
    if "qty" in sent or "unit" in sent:
        unit = clean_unit(body.unit) if "unit" in sent else item["unit"]
        qty = body.qty if "qty" in sent else item["qty"]
        change = {"qty": (amount(qty) if unit else max(1, min(int(qty), 99)))}
        if "unit" in sent:
            change["unit"] = unit
        L._set_qty(item_id, change)
    if "checked" in sent:
        L._set_checked(item_id, body.checked)
    if "list_id" in sent:
        L._move_item(item_id, real)
    if "aisle" in sent:
        L._merge_flag(item_id, {"aisle": " ".join((body.aisle or "").split()) or None})
    return _item_or_404(item_id)


@v1.delete("/items/{item_id}")
async def delete_item(item_id: str):
    _item_or_404(item_id)
    L._remove_item(item_id)
    return {"deleted": item_id}


# ---- export and import --------------------------------------------------

def _export_rows(row, items):
    return [{"name": i["name"], "qty": i["qty"], "unit": i["unit"],
             "checked": i["checked"], "department": i["aisle"] or "",
             "list": row["name"]} for i in items]


@v1.get("/lists/{list_id}/export")
def export_list(list_id: str, format: str = "json"):
    row = _list_or_404(list_id)
    head, mine = _summary(row, _items())
    if format == "json":
        return {"list": {k: head[k] for k in ("id", "name", "stores")},
                "items": mine}
    rows = _export_rows(row, mine)
    if format == "csv":
        return Response(export.to_csv(rows), media_type="text/csv; charset=utf-8")
    if format == "text":
        return Response(export.to_text(rows), media_type="text/plain; charset=utf-8")
    raise HTTPException(400, "format must be csv, json or text")


@v1.post("/lists/import")
async def import_list(req: Request, list: str = "", format: str = ""):
    body = await _body_bytes(req)
    try:
        text = body.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "send UTF-8 text")
    kind = format or ("csv" if "csv" in (req.headers.get("content-type") or "")
                      else "text")
    if kind not in ("csv", "text"):
        raise HTTPException(400, "format must be csv or text")
    try:
        rows, skipped = (export.parse_csv if kind == "csv" else export.parse_text)(text)
    except ValueError as e:
        raise HTTPException(400, str(e))
    default = " ".join(list.split())[:40] or "Imported"
    skipped += max(0, len(rows) - MAX_IMPORT_ROWS)
    rows = rows[:MAX_IMPORT_ROWS]
    by_list = {}
    for r in rows:
        by_list.setdefault(r["list"] or default, []).append(r)
    created, touched = 0, []
    for name, group in by_list.items():
        target = next((l for l in state.named_lists()
                       if l["name"].lower() == name.lower()), None)
        if target is None:
            try:
                target = L._create_list({"name": name, "stores": []})
            except HTTPException:     # too many lists: leave this group out
                skipped += len(group)
                continue
        touched.append({"id": target["id"], "name": target["name"]})
        reply = L._add_typed([(r["name"], r["qty"], r["unit"]) for r in group],
                             target["id"])
        new = set(reply["item_ids"])
        for r, item_id in zip(group, reply["all_item_ids"]):
            if item_id not in new:
                continue
            if r["checked"]:
                L._set_checked(item_id, True)
            if r["department"]:
                L._merge_flag(item_id, {"aisle": r["department"]})
        created += len(new)
        skipped += len(group) - len(new)
    return {"created": created, "skipped": skipped, "lists": touched}


# ---- your receipts and totals --------------------------------------------
# The account's own filed receipts only (never a household member's), and
# plain sums of them. No inference is exposed here.

def _own():
    return state.own_receipts()


def _own_or_404(receipt_id):
    r = next((r for r in _own() if r["receipt_id"] == receipt_id), None)
    if r is None:
        raise HTTPException(404, "no such receipt")
    return r


@v1.get("/receipts")
def get_receipts(limit: int = 50, offset: int = 0):
    rows = open_data.newest_first(_own())
    limit, offset = min(max(limit, 1), 200), max(offset, 0)
    return {"total": len(rows),
            "receipts": [open_data.summary(r) for r in rows[offset:offset + limit]]}


@v1.get("/receipts/export")
def export_receipts(format: str = "json"):
    rows = _own()
    if format == "json":
        return {"receipts": [open_data.detail(r) for r in open_data.newest_first(rows)]}
    if format == "csv":
        return Response(open_data.to_csv(rows), media_type="text/csv; charset=utf-8")
    raise HTTPException(400, "format must be csv or json")


@v1.get("/receipts/{receipt_id}")
def get_receipt(receipt_id: str):
    return open_data.detail(_own_or_404(receipt_id))


@v1.get("/receipts/{receipt_id}/original")
def get_receipt_original(receipt_id: str):
    r = _own_or_404(receipt_id)
    data = state.receipt_media(receipt_id) if r.get("image_ref") else None
    if data is None:
        raise HTTPException(404, "no original kept for this receipt")
    return Response(data, media_type=r.get("media_type") or "application/octet-stream")


@v1.delete("/receipts/{receipt_id}")
def delete_receipt(receipt_id: str):
    _own_or_404(receipt_id)
    from api.routes.receipts import quest_delete_receipt
    quest_delete_receipt(receipt_id)
    return {"deleted": receipt_id}


@v1.get("/analysis/spending")
def analysis_spending():
    return open_data.spending(_own())


@v1.get("/analysis/purchases")
def analysis_purchases(limit: int = 50):
    return {"items": open_data.purchases(_own(), min(max(limit, 1), 500))}


# ---- the schema, as developers read it ---------------------------------
# FastAPI names operations after the function and path
# (get_lists_lists_get). The reference page at /developers/reference
# draws this schema, so each operation gets a plain id, a one-line
# summary and a short description here, in one place, and the schema
# declares the bearer code and the error shape. The routes are untouched.

_OPS = {
    ("get", "/lists"): ("listLists", "Lists", "Your lists",
        "Every list you have, with how many items are still open. The id `unfiled` is Everything else."),
    ("get", "/lists/{list_id}"): ("getList", "Lists", "One list and its items",
        "The list and every item on it."),
    ("post", "/lists/{list_id}/items"): ("addItems", "Lists", "Add items",
        "Send `items` (names or objects) or `text` (free text, split the way the app splits it), not both. "
        "At most 50 items. Names already on the list are not added twice. Names on a different list are "
        "reported in `also_on` and not moved."),
    ("patch", "/items/{item_id}"): ("updateItem", "Lists", "Change an item",
        "Change any of `checked`, `qty`, `unit`, `list_id` and `aisle`. Nothing changes if any field is bad."),
    ("delete", "/items/{item_id}"): ("deleteItem", "Lists", "Remove an item", "Removes the item from your lists."),
    ("get", "/lists/{list_id}/export"): ("exportList", "Export and import", "Export a list",
        "`format` is `json` (default), `csv` or `text` (a checklist, one item per line)."),
    ("post", "/lists/import"): ("importList", "Export and import", "Import a list",
        "Send the file as the request body. The format is `csv` when the Content-Type contains csv, else text. "
        "`list` names the list to fill (default Imported); it is created if missing. At most 500 rows."),
    ("get", "/receipts"): ("listReceipts", "Receipts and spending", "Your receipts",
        "The receipts you filed, newest first. `limit` is at most 200."),
    ("get", "/receipts/export"): ("exportReceipts", "Export and import", "Export every receipt",
        "Every receipt you filed, as `json` (default) or `csv` (one row per line)."),
    ("get", "/receipts/{receipt_id}"): ("getReceipt", "Receipts and spending", "One receipt",
        "The receipt with its lines. Lines are `item`, `discount` or `return`."),
    ("get", "/receipts/{receipt_id}/original"): ("getReceiptOriginal", "Receipts and spending", "The receipt photo or PDF",
        "The file you uploaded, if Arya kept one (`has_photo`)."),
    ("delete", "/receipts/{receipt_id}"): ("deleteReceipt", "Receipts and spending", "Delete a receipt",
        "Removes the receipt and its photo."),
    ("get", "/analysis/spending"): ("getSpending", "Receipts and spending", "Spending totals",
        "Sums of what your receipts say, by month and by store. Nothing is inferred."),
    ("get", "/analysis/purchases"): ("listPurchases", "Receipts and spending", "What you bought",
        "Items by the name read from your receipts, most often bought first. `limit` is at most 500."),
}
_ERROR = {"description": "Error", "content": {"application/json": {"schema": {
    "type": "object", "properties": {"error": {"type": "object", "properties": {
        "code": {"type": "string", "example": "not_found"},
        "message": {"type": "string", "example": "no such list"}}}}}}}}
_ERRORS = {"401": "No, wrong or revoked code", "429": "Over the hourly limit; wait Retry-After seconds"}


def _openapi():
    if v1.openapi_schema:
        return v1.openapi_schema
    from fastapi.openapi.utils import get_openapi
    spec = get_openapi(title=v1.title, version=v1.version, description=v1.description,
                       routes=v1.routes, servers=[{"url": "/api/v1"}])
    spec["info"]["description"] += (
        " New here? Start with the [quickstart](/developers). Make your code in Arya under Settings, Use Arya in another AI app. "
        "600 calls an hour per account. Errors are {\"error\": {\"code\", \"message\"}}.")
    spec.setdefault("components", {})["securitySchemes"] = {"bearerAuth": {
        "type": "http", "scheme": "bearer",
        "description": "Your personal code, sent as Authorization: Bearer YOUR_CODE."}}
    spec["security"] = [{"bearerAuth": []}]
    spec["tags"] = [{"name": n} for n in dict.fromkeys(v[1] for v in _OPS.values())]
    for path, methods in spec["paths"].items():
        for method, op in methods.items():
            meta = _OPS.get((method, path))
            if meta:
                op["operationId"], tag, op["summary"], op["description"] = meta[0], meta[1], meta[2], meta[3]
                op["tags"] = [tag]
            for code, why in _ERRORS.items():
                op["responses"].setdefault(code, {**_ERROR, "description": why})
    v1.openapi_schema = spec
    return spec


v1.openapi = _openapi
