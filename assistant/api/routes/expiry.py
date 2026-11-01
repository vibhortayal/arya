"""Expiry dates: read one off a package, save it, and act on it."""
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import own_key
from api import state
from api.demo_guard import _is_demo
from api.deps import _budget_guard, _d_today, _json_obj, new_client
from api.routes.items import _merge_flag

router = APIRouter()


# --- Expiry dates (owner, 2026-10-29) ----------------------------------

def _known_item_name(item_id):
    return (state.flags().get(item_id, {}).get("name")
            or state.names().get(item_id) or item_id)


@router.post("/api/expiry/read")
async def expiry_read(req: Request, sample: int = 0):
    """One Spark vision read of the date on a package. Nothing is saved:
    the client shows what Arya read and the user confirms through
    /api/expiry/save. ?sample=1 (demo only) returns a canned read with
    no model call, so a visitor with no package can try the flow."""
    from api import expiry
    today = _d_today()
    demo = _is_demo(req)
    if sample:
        if not demo:
            raise HTTPException(400, "sample reads are for the demo")
        from datetime import timedelta as _td
        read = {"readable": True, "name": "Whole Milk 1 gal",
                "date": (today + _td(days=5)).isoformat(), "kind": "use_by",
                "confidence": 1.0, "raw": "USE BY (sample)"}
    else:
        media = (req.headers.get("content-type") or "").split(";")[0].strip()
        if not media.startswith("image/"):
            raise HTTPException(415, "send a photo (image)")
        body = await req.body()
        if not body:
            raise HTTPException(400, "empty upload")
        if len(body) > 12_000_000:
            raise HTTPException(413, "photo too large (12 MB max)")
        if not own_key.model_ready():
            raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
        _budget_guard(demo=demo)
        client = new_client()
        try:
            read = await run_in_threadpool(expiry.read_expiry_photo, body, client,
                                           media_type=media, today=today)
        except RuntimeError as e:
            raise HTTPException(502, str(e)[:200])
    item_id = expiry.match_item(read["name"], state.dictionary()["entries"], state.flags())
    read["match"] = ({"item_id": item_id, "name": _known_item_name(item_id)}
                     if item_id else None)
    read["demo"] = demo
    return read


@router.post("/api/expiry/save")
async def expiry_save(req: Request):
    """The user confirmed a date. Tracks it on the item (a known one by
    item_id, else a new tracked-only item by name — it does not join
    the shopping list)."""
    from api.list.intake import item_slug
    from api import expiry
    body = await _json_obj(req)
    d = expiry.parse_iso(body.get("date"))
    today = _d_today()
    if not expiry.sane_date(d, today):
        raise HTTPException(400, "date must be a real date within the next five years")
    item_id = body.get("item_id")
    name = " ".join(str(body.get("name") or "").split())[:80]
    if item_id:
        if item_id not in state.flags() and item_id not in state.names():
            raise HTTPException(404, "unknown item")
    elif name:
        item_id = expiry.match_item(name, state.dictionary()["entries"], state.flags())
        if not item_id:
            item_id = "manual-" + item_slug(name)
            _merge_flag(item_id, {"name": name})
    else:
        raise HTTPException(400, "item_id or name is required")
    _merge_flag(item_id, expiry.track_fields(d, body.get("kind"), today))
    return {"item_id": item_id, "name": _known_item_name(item_id),
            "date": d.isoformat()}


@router.post("/api/expiry/nudge")
async def expiry_nudge(req: Request):
    """The after-receipt card was answered (#207). "done" (dates saved
    or the sheet closed with Done) and "not_now" both stop asking about
    this receipt and anything older; "not_now" also counts toward the
    stop for good."""
    from api import expiry
    body = await _json_obj(req)
    action = body.get("action")
    if action not in ("done", "not_now"):
        raise HTTPException(400, "action must be done or not_now")
    d = expiry.parse_iso(str(body.get("date") or ""))
    if d is None:
        raise HTTPException(400, "date is the receipt's date (YYYY-MM-DD)")
    with state.file_lock("settings.json"):
        cur = state._load("settings.json", {})
        pn = dict(cur.get("perish_nudge") or {})
        old = expiry.parse_iso(pn.get("seen") or "")
        if old is None or d > old:
            pn["seen"] = d.isoformat()
        if action == "not_now":
            pn["not_now"] = int(pn.get("not_now") or 0) + 1
        cur["perish_nudge"] = pn
        state._save("settings.json", cur)
    return {"perish_nudge": pn}


@router.post("/api/expiry/{item_id}/{action}")
def expiry_action(item_id: str, action: str):
    """done (used it) and stop both untrack; snooze waits two days."""
    from datetime import timedelta as _td
    from api import expiry
    if not expiry.tracked(state.flags().get(item_id)):
        raise HTTPException(404, "that item has no tracked date")
    if action in ("done", "stop"):
        _merge_flag(item_id, expiry.untrack_fields())
    elif action == "snooze":
        until = (_d_today() + _td(days=expiry.SNOOZE_DAYS)).isoformat()
        _merge_flag(item_id, {"use_by_snooze": until})
    else:
        raise HTTPException(404, "unknown action")
    return {"item_id": item_id, "name": _known_item_name(item_id), "action": action}
