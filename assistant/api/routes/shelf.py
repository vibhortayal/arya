"""Shelf photos in the aisle: scan a shelf, fetch a stored shelf photo, and work out where the shopper is."""
import os

from api.errors import safe_detail
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import own_key
from api.demo_guard import _is_demo
from api.deps import _budget_guard, new_client

router = APIRouter()


@router.post("/api/quest/scan-shelf")
async def scan_shelf_route(req: Request):
    """Shelf Scan (Discussion 37), the unmapped-store mode: one
    shelf photo against the session's REMAINING items. SAM 3.1
    proposes boxes from list-driven phrasings, Muse Spark verifies
    each candidate crop, only verified items pop (api/shelfscan.py
    carries the spike's three fixes). A frame is kept only after its
    people are scrubbed (below); the raw frame never is. The demo
    household's carve-out is the same live-door rule as the Photo
    door (see _DEMO_LIVE_DOORS)."""
    from api import quest, shelfscan
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a shelf photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    session_id = req.query_params.get("session", "")
    sess = quest.get_session(session_id) if session_id else None
    if sess is None:
        raise HTTPException(404, "no such session")
    remaining = [i["name"] for i in sess["items"] if not i["checked"]]
    # Find it for me: aim the scan at the one item the player is
    # after — one item's model calls, not the whole list's.
    target = (req.query_params.get("item") or "").strip()
    if target:
        remaining = [n for n in remaining if n == target]
    if not remaining:
        return {"pops": [], "not_found": [target] if target else []}
    own_key.need_model()
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = new_client()
    try:
        out = await run_in_threadpool(shelfscan.scan, body, remaining,
                                      client, media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, safe_detail(e))
    # What was seen where feeds the store map. A frame that popped
    # an item is kept as a fresh shelf photo, but only once SAM 3.1
    # has found and pixelated every person in it (owner, 2026-10-28:
    # "we don't store images of people, only products"). Fail closed.
    pops = out.get("pops") or []
    quest.record_sightings(session_id, pops)
    if pops:
        jpeg, people = await run_in_threadpool(
            shelfscan.scrub_people, body, client, media_type=media)
        if jpeg:
            quest.keep_frame(session_id, pops, jpeg, people)
    return out


@router.get("/api/quest/shelf-photo")
def quest_shelf_photo(store: str = "", item: str = ""):
    """The freshest people-scrubbed shopper photo of one item's shelf
    in one store, with the verified box to highlight."""
    from api import quest
    rec = quest.shelf_photo(store, item)
    if rec is None:
        raise HTTPException(404, "no fresh photo yet")
    out = {k: v for k, v in rec.items() if k != "jpeg_b64"}
    out["image"] = "data:image/jpeg;base64," + rec["jpeg_b64"]
    return out
