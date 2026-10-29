"""Hunt sessions: plan, create, items, check-off, state, receipt, optimize, Shop-Off, missing-item reports and the haul photo."""
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import pack as pack_api, state
from api.demo_guard import _is_demo
from api.deps import _budget_guard, _json_obj, new_client

router = APIRouter()


@router.get("/api/quest/plan")
def quest_plan():
    """Plan a hunt (owner, 2026-10-28: "i pick my store. then i should
    be able to move things from my list to my quest… my milk is
    typically bought from TJ, eggs from costco"). Where each known
    item has been bought, counted from the receipts, plus the Arya
    list. The client sorts the list for the picked store: usually
    here, new, usually elsewhere, and suggests usuals for that store
    that are not on the list yet. Counting only — no model call."""
    d = state.derived()
    nm = state.names()
    gm = state.group_map()
    stores = {}
    for e in d["entries"]:
        if e["event_type"] != "purchase" or not e.get("store_id"):
            continue
        iid = gm.get(e["item_id"], e["item_id"])
        by = stores.setdefault(iid, {})
        by[e["store_id"]] = by.get(e["store_id"], 0) + 1
    pats = {p["item_id"]: p for p in d["patterns"]}
    items = []
    for iid, by in stores.items():
        p = pats.get(iid) or {}
        items.append({"item_id": iid, "name": nm.get(iid, iid), "stores": by,
                      "every_days": p.get("median_interval_days"),
                      "days_since": p.get("days_since_last"),
                      "due": bool(p.get("due"))})
    # A hand-typed row ("milk", "eggs") has no history of its own;
    # the same dictionary match the Check step uses finds the product
    # it means, so its stores and cadence read from that product's
    # receipts (QA 2026-10-28). history_id is that match; item_id
    # stays the list row's own id for removal.
    from api import quest as _quest
    lst = []
    for i in d["smart_list"]["items"]:
        if i.get("checked"):
            continue
        iid = i.get("item_id")
        name = i.get("name") or nm.get(iid, "")
        hid = gm.get(iid, iid)
        if hid not in stores:
            hid = _quest.resolve_group(name) or hid
        lst.append({"item_id": iid, "history_id": hid, "name": name,
                    "qty": i.get("qty") or 1, "unit": i.get("unit") or "",
                    "list": i.get("list"), "on_list": bool(i.get("on_list"))})
    return pack_api.enrich_plan({"list": lst, "items": items}, d)


# --- Arya Quest (Stage A): sessions, optimizer, Shop-Off, social ---

@router.post("/api/quest/sessions")
async def quest_create_session(req: Request):
    body = await _json_obj(req)
    store = (body.get("store") or "").strip()
    store_id = (body.get("store_id") or "").strip() or None
    store_address = None
    if store_id:
        # A directory store wins over the typed name: the session
        # snapshots the directory's name + address (Stage E).
        from api import stores as stores_mod
        snap = stores_mod.snapshot(store_id)
        if snap is None:
            raise HTTPException(404, "no such store in the directory")
        store = snap["name"]
        store_address = snap["address"]
    if not store:
        raise HTTPException(400, "store is required")
    from api import quest
    try:
        _budget_guard()
        match_client = new_client()
    except HTTPException:
        match_client = None  # over budget: shelf matching stays code-only
    try:
        sess = await run_in_threadpool(
            quest.create_session, store, body.get("mode") or "quest",
            body.get("items") or [],
            driver=body.get("driver") or "strip",
            store_id=store_id, store_address=store_address,
            client=match_client)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return sess


@router.get("/api/quest/sessions")
def quest_list_sessions():
    from api import quest
    return {"sessions": quest.list_sessions()}


@router.get("/api/quest/sessions/{session_id}")
def quest_get_session(session_id: str):
    from api import quest
    sess = quest.get_session(session_id)
    if sess is None:
        raise HTTPException(404, "no such session")
    return quest.session_view(sess)


@router.post("/api/quest/sessions/{session_id}/items")
async def quest_add_item(session_id: str, req: Request):
    body = await _json_obj(req)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    from api import quest
    sess = quest.add_item(session_id, name, body.get("qty", 1),
                          wild=bool(body.get("wild")))
    if sess is None:
        raise HTTPException(404, "no such session")
    return sess


@router.post("/api/quest/sessions/{session_id}/check")
async def quest_check(session_id: str, req: Request):
    body = await _json_obj(req)
    if not body.get("item"):
        raise HTTPException(400, "item is required")
    from api import quest
    checked = body.get("checked", True)
    sess = quest.check_item(session_id, body["item"], checked)
    if sess is None:
        raise HTTPException(404, "no such item in this session")
    # Album: a grab mints a sticker (a put back retracts one). Stickers
    # are garnish and must never fail a grab. The payload rides along
    # only for a first-time product.
    try:
        from api import stickers
        payload = await run_in_threadpool(
            stickers.on_check, sess, body["item"], bool(checked))
    except Exception:
        payload = None
    if payload:
        return {**sess, "new_sticker": payload}
    return sess


@router.post("/api/quest/sessions/{session_id}/state")
async def quest_set_state(session_id: str, req: Request):
    body = await _json_obj(req)
    from api import quest
    try:
        sess = quest.set_state(session_id, body.get("state", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if sess is None:
        raise HTTPException(404, "no such session")
    return sess


@router.post("/api/quest/sessions/{session_id}/delete")
def quest_delete_session(session_id: str):
    """Remove a hunt from the player's history (Tranche 1) — a
    mistaken or duplicate hunt, or an unsettled one whose receipt
    is truly lost. Points recompute from what remains."""
    from api import quest
    if not quest.delete_session(session_id):
        raise HTTPException(404, "no such session")
    return {"ok": True, "deleted": session_id}


@router.post("/api/quest/sessions/{session_id}/receipt")
async def quest_attach_receipt(session_id: str, req: Request):
    body = await _json_obj(req)
    receipt_id = body.get("receipt_id")
    if not receipt_id:
        raise HTTPException(400, "receipt_id is required")
    from api import quest
    if quest.get_session(session_id) is None:
        raise HTTPException(404, "no such session")
    try:
        sess = quest.attach_receipt(session_id, receipt_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if sess is None:
        raise HTTPException(404, "no such receipt")
    return quest.session_view(sess)


@router.post("/api/quest/sessions/{session_id}/sample-receipt")
def quest_sample_receipt(session_id: str):
    """Demo only: settle this hunt with a sample receipt for the
    trip (Hunt v2 plan item 8). Real accounts attach their own."""
    if not state.in_sandbox():
        raise HTTPException(403, "sample receipts are for the demo only")
    from api import quest
    try:
        sess = quest.sample_receipt(session_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if sess is None:
        raise HTTPException(404, "no such session")
    return sess


@router.post("/api/quest/optimize")
async def quest_optimize(req: Request):
    body = await _json_obj(req)
    items = body.get("items")
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "items is required")
    from api.optimizer import optimize
    return optimize(items, store=body.get("store"))


@router.post("/api/quest/shopoff")
async def quest_create_shopoff(req: Request):
    body = await _json_obj(req)
    store = (body.get("store") or "").strip()
    if not store:
        raise HTTPException(400, "store is required")
    from api import quest
    try:
        race = await run_in_threadpool(
            quest.create_shopoff, store, body.get("items") or [],
            body.get("opponent_handle", ""),
            client=new_client())
    except ValueError as e:
        raise HTTPException(400, str(e))
    return race


@router.get("/api/quest/shopoff/{race_id}")
def quest_get_shopoff(race_id: str):
    from api import quest
    race = quest.get_shopoff(race_id)
    if race is None:
        raise HTTPException(404, "no such race")
    return race


@router.post("/api/quest/sessions/{session_id}/report-missing")
async def quest_report_missing(session_id: str, req: Request):
    body = await _json_obj(req)
    if not body.get("item"):
        raise HTTPException(400, "item is required")
    from api import quest, storemap
    try:
        rep = quest.report_missing(session_id, body["item"],
                                   body.get("kind", ""), body.get("photo"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if rep is None:
        raise HTTPException(404, "no such item in this session")
    # Map my store: a "not found" also flags the part of the map where
    # the item was last seen, and answers with the capture to ask for.
    task = storemap.flag_outdated(rep["store"], item=rep["item"],
                                  reason="not_found")
    return {**rep, "map_task": task}


@router.get("/api/quest/stores/{store}/reports")
def quest_store_reports(store: str):
    from api import quest
    return quest.store_reports(store)


@router.get("/api/quest/sos-count")
def quest_sos_count(store: str = "", item: str = ""):
    from api import quest
    return quest.sos_count(store, item)


@router.post("/api/quest/haul-photo")
async def quest_haul_photo(req: Request, session: str = ""):
    """Snap your haul: one Eyes read of the haul photo, matched
    against the hunt by quest.haul_check. The read is saved on the
    session; the photo itself is never stored."""
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    from api import quest
    if quest.get_session(session) is None:
        raise HTTPException(404, "no such session")
    _budget_guard(demo=_is_demo(req))
    from api.eyes.service import detect
    client = new_client()
    try:
        sightings = await run_in_threadpool(detect, body, client,
                                            media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    out = quest.haul_check(session, sightings)
    if out is None:
        raise HTTPException(404, "no such session")
    return out
