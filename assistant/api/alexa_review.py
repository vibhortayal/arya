"""Unclear Alexa adds, kept for a look in the app (owner, 2026-11-03:
a "From Alexa" card on Today, for the unclear ones only). An add lands
here when Spark guessed (not sure) or Spark could not help and the item
went on as heard. The item is already on a list; the card lets the
person keep it, rename it, move it or take it off.

Per account, alexa_review.json: [{id, heard, heard_list, item_id, name,
list_id, why: "guess"|"fallback", at, open}]."""
import datetime, secrets, time

from api import state

_DOC = "alexa_review.json"
KEEP = 50
SHOW_S = 7 * 86400   # rows clear from the card after 7 days


def _rows():
    return state._load(_DOC, [])


def record(heard, heard_list, name, list_name, why, added=None):
    from api.alexa_brain import known_item
    item_id = (added[0]["item_id"] if added else None) or known_item(name)
    lst = next((l for l in state.named_lists() if l["name"] == list_name), None)
    row = {"id": secrets.token_hex(6), "heard": heard, "heard_list": heard_list,
           "item_id": item_id, "name": name, "list_id": lst["id"] if lst else None,
           "list": list_name, "why": why, "at": int(time.time()), "open": True}
    with state.file_lock(_DOC):
        rows = [row] + _rows()
        state._save(_DOC, rows[:KEEP])
    return row


def _shown(r):
    """A row as the app reads it: kind "guess" (Spark unsure) or
    "unchecked" (Spark could not help; the name is what was heard)."""
    names = {l["id"]: l["name"] for l in state.named_lists()}
    return {"id": r["id"], "item_id": r.get("item_id"), "name": r.get("name"),
            "heard": r.get("heard"), "kind": "guess" if r.get("why") == "guess" else "unchecked",
            "list_id": r.get("list_id"), "list_name": names.get(r.get("list_id")) or r.get("list"),
            "at": datetime.datetime.fromtimestamp(r["at"], datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def open_rows():
    """Open rows from the last 7 days, newest first."""
    now = time.time()
    rows = [r for r in _rows() if r.get("open") and now - r.get("at", 0) < SHOW_S]
    return [_shown(r) for r in sorted(rows, key=lambda r: -r.get("at", 0))]


def reopen(row_id):
    """Undo for a confirm: the row shows again (the item was never changed)."""
    with state.file_lock(_DOC):
        rows = _rows()
        row = next((r for r in rows if r["id"] == row_id and not r.get("open")
                    and r.get("done") == "confirm"), None)
        if not row:
            return None
        row["open"] = True
        row.pop("done", None)
        state._save(_DOC, rows)
        return row


def close(row_id, action, list_id=None, name=None):
    """confirm | rename | move | remove; the row closes. Returns the row
    or None when there is no open row with that id."""
    from api.routes.items import _merge_flag
    from api.routes.lists import _move_item, _remove_item
    with state.file_lock(_DOC):
        rows = _rows()
        row = next((r for r in rows if r["id"] == row_id and r.get("open")), None)
        if not row:
            return None
        iid = row.get("item_id")
        if action == "move":
            if not any(l["id"] == list_id for l in state.named_lists()):
                raise ValueError("no such list")
            if iid:
                _move_item(iid, list_id, row.get("list_id"))
            row["list_id"] = list_id
        elif action == "remove":
            if iid:
                _remove_item(iid, row.get("list_id"))
        elif action == "rename":
            name = " ".join(str(name or "").split())[:60]
            if not name:
                raise ValueError("name cannot be empty")
            if iid:
                _merge_flag(iid, {"name": name})
            row["name"] = name
        elif action != "confirm":
            raise ValueError("unknown action")
        row["open"] = False
        row["done"] = action
        state._save(_DOC, rows)
        return row
