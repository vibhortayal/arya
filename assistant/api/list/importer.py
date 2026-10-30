"""Paste-in import (owner, 2026-10-30): read whatever the person pastes
into a list of {name, qty, unit, checked, aisle}. Plain lines, a CSV and a
JSON from another app are read by code ($0); anything else goes to the one
model extraction call. The result is a preview: nothing is added until the
person says so."""
import csv
import io
import json

MAX_ITEMS = 200
MAX_CHARS = 20000
_NAME_KEYS = ("name", "item", "title", "product", "text", "summary", "task")
_QTY_KEYS = ("qty", "quantity", "amount", "count")
_UNIT_KEYS = ("unit", "units")
_DONE_KEYS = ("checked", "done", "completed", "complete", "bought")
_AISLE_KEYS = ("department", "aisle", "category", "section")


def _pick(row, keys):
    low = {str(k).strip().lower(): v for k, v in row.items() if k is not None}
    for k in keys:
        if k in low and low[k] not in (None, ""):
            return low[k]
    return None


def _truthy(v):
    return str(v).strip().lower() in ("1", "true", "yes", "y", "x", "done", "checked", "✓")


def _item(name, qty=1, unit="", checked=False, aisle=""):
    name = " ".join(str(name or "").split())[:80]
    if not name:
        return None
    try:
        q = int(float(qty))
    except (TypeError, ValueError):
        q = 1
    return {"name": name, "qty": max(1, min(q, 99)), "unit": str(unit or "")[:12],
            "checked": bool(checked), "aisle": str(aisle or "")[:40]}


def _from_rows(rows):
    out = []
    for r in rows:
        if isinstance(r, str):
            it = _item(r)
        elif isinstance(r, dict):
            name = _pick(r, _NAME_KEYS)
            if name is None:
                continue
            it = _item(name, _pick(r, _QTY_KEYS) or 1, _pick(r, _UNIT_KEYS) or "",
                       _truthy(_pick(r, _DONE_KEYS) or ""), _pick(r, _AISLE_KEYS) or "")
        else:
            continue
        if it:
            out.append(it)
    return out


def _json_rows(text):
    try:
        doc = json.loads(text)
    except ValueError:
        return None
    if isinstance(doc, dict):
        for k in ("items", "list", "lists", "tasks", "data"):
            if isinstance(doc.get(k), list):
                doc = doc[k]
                break
        else:
            doc = [doc]
    if not isinstance(doc, list):
        return None
    rows = []
    for r in doc:
        if isinstance(r, dict) and isinstance(r.get("items"), list):
            rows.extend(r["items"])  # a list of lists: take the items
        else:
            rows.append(r)
    return rows


def _csv_rows(text):
    first = text.splitlines()[0] if text.splitlines() else ""
    delim = "\t" if first.count("\t") >= 1 else ("," if first.count(",") >= 1 else None)
    if not delim:
        return None
    head = [h.strip().lower() for h in next(csv.reader([first], delimiter=delim), [])]
    if not any(h in _NAME_KEYS for h in head):
        return None
    return list(csv.DictReader(io.StringIO(text), delimiter=delim))


def parse_paste(text, model_extract=None):
    """-> (items, source). `model_extract(text)` is the model fallback and
    may be None (no key): then unreadable text gives no items."""
    text = (text or "").strip()[:MAX_CHARS]
    if not text:
        return [], "empty"
    rows, source = None, ""
    if text[0] in "[{":
        rows = _json_rows(text)
        source = "json"
    if rows is None:
        rows = _csv_rows(text)
        source = "csv"
    if rows is not None:
        items = _from_rows(rows)
        if items:
            return items[:MAX_ITEMS], source
    from api.list.intake import split_list_items_units
    if not (text[0] in "[{"):
        plain = [_item(n, q, u) for n, q, u in split_list_items_units(text)]
        plain = [i for i in plain if i]
        if plain:
            return plain[:MAX_ITEMS], "split"
    names = model_extract(text) if model_extract else []
    # The model may only return what the paste holds: drop invented items.
    low = text.lower()
    kept = [n for n in names if n and n.lower().split()[0][:4] in low]
    return [i for i in (_item(n) for n in kept) if i][:MAX_ITEMS], "model"
