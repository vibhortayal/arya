"""Arya API — FastAPI entry point.
All Meta calls go through api.meta_client; all money math is code.

Event-loop rule (review 2026-10-28, H1): MetaClient is blocking
urllib with timeouts up to 120 s, so no route may call a model —
or judge_pending, which calls the judge — on the event loop.
Model work runs through run_in_threadpool; a slow photo read then
stalls one worker thread, never every other request."""
import logging, os
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from api import state
from api.deps import _PWA, _budget_guard, _json_obj, new_client
from api.demo_guard import _is_demo, require_login

app = FastAPI(title="Arya API")
app.middleware("http")(require_login)
_log = logging.getLogger("arya.api")


@app.exception_handler(RuntimeError)
async def _model_failure(request, exc):
    """MetaClient and parse_json raise RuntimeError when a model call
    fails or its answer cannot be read. Routes that do not catch it
    answer 502 with a plain sentence instead of a bare 500 (codebase
    map 2026-10-29). The traceback still goes to the log."""
    _log.exception("unhandled RuntimeError on %s", request.url.path,
                   exc_info=exc)
    return JSONResponse({"detail": "Arya could not finish that read. Try again."},
                        status_code=502)
from api import pack as pack_api; app.include_router(pack_api.router)  # noqa: E402,E702


from api.routes import auth as auth_routes  # noqa: E402
app.include_router(auth_routes.router)



@app.get("/health")
def health():
    return {"status": "ok", "service": "arya-api", "stage": 3, "receipts": len(state.receipts())}
from api.routes import intake as intake_routes  # noqa: E402
app.include_router(intake_routes.router)

from api.routes import review as review_routes  # noqa: E402
app.include_router(review_routes.router)

from api.routes import home as home_routes  # noqa: E402
app.include_router(home_routes.router)



@app.get("/api/quest/plan")
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
from api.routes import items as items_routes  # noqa: E402
app.include_router(items_routes.router)

from api.routes import eyes as eyes_routes  # noqa: E402
app.include_router(eyes_routes.router)
from api.routes import mcp_connector as mcp_connector_routes  # noqa: E402
app.include_router(mcp_connector_routes.router)

from api.routes import chat as chat_routes  # noqa: E402
app.include_router(chat_routes.router)
from api.routes import lists as lists_routes  # noqa: E402
app.include_router(lists_routes.router)

from api.routes import expiry as expiry_routes  # noqa: E402
app.include_router(expiry_routes.router)

from api.routes import account as account_routes  # noqa: E402
app.include_router(account_routes.router)
from api.routes import stores as stores_routes  # noqa: E402
app.include_router(stores_routes.router)



# --- Arya Quest (Stage A): sessions, optimizer, Shop-Off, social ---

@app.post("/api/quest/sessions")
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


@app.get("/api/quest/sessions")
def quest_list_sessions():
    from api import quest
    return {"sessions": quest.list_sessions()}


@app.get("/api/quest/sessions/{session_id}")
def quest_get_session(session_id: str):
    from api import quest
    sess = quest.get_session(session_id)
    if sess is None:
        raise HTTPException(404, "no such session")
    return quest.session_view(sess)


@app.post("/api/quest/sessions/{session_id}/items")
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


@app.post("/api/quest/sessions/{session_id}/check")
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


from api.album_routes import router as album_router  # noqa: E402
app.include_router(album_router)


@app.post("/api/quest/sessions/{session_id}/state")
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


@app.post("/api/quest/sessions/{session_id}/delete")
def quest_delete_session(session_id: str):
    """Remove a hunt from the player's history (Tranche 1) — a
    mistaken or duplicate hunt, or an unsettled one whose receipt
    is truly lost. Points recompute from what remains."""
    from api import quest
    if not quest.delete_session(session_id):
        raise HTTPException(404, "no such session")
    return {"ok": True, "deleted": session_id}


@app.post("/api/quest/scan-shelf")
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
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = new_client()
    try:
        out = await run_in_threadpool(shelfscan.scan, body, remaining,
                                      client, media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
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


@app.get("/api/quest/shelf-photo")
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


@app.post("/api/quest/locate")
async def locate_route(req: Request):
    """Where am I? — the hunt's position anchor. One photo is
    matched locally against the session store's walkthrough index
    (api/locate.py; the matcher is Wonder-authored, vendored in
    api/localizer.py). No model calls, nothing stored: the answer
    is a path fraction the client snaps to its nearest stop. The
    demo household may use it — position is ephemeral hunt state,
    like a collect (see _DEMO_LIVE_DOORS)."""
    from PIL import UnidentifiedImageError
    from api import locate, quest
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    session_id = req.query_params.get("session", "")
    sess = quest.get_session(session_id) if session_id else None
    if sess is None:
        raise HTTPException(404, "no such session")
    try:
        return await run_in_threadpool(locate.locate, body, sess)
    except UnidentifiedImageError:
        raise HTTPException(400, "could not read that photo")


@app.post("/api/quest/sessions/{session_id}/receipt")
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


@app.post("/api/quest/sessions/{session_id}/sample-receipt")
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


@app.post("/api/quest/optimize")
async def quest_optimize(req: Request):
    body = await _json_obj(req)
    items = body.get("items")
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "items is required")
    from api.optimizer import optimize
    return optimize(items, store=body.get("store"))


@app.post("/api/quest/shopoff")
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


@app.get("/api/quest/shopoff/{race_id}")
def quest_get_shopoff(race_id: str):
    from api import quest
    race = quest.get_shopoff(race_id)
    if race is None:
        raise HTTPException(404, "no such race")
    return race


@app.get("/api/quest/friends")
def quest_list_friends():
    from api import social
    return {"friends": social.list_friends()}


@app.post("/api/quest/friends")
async def quest_request_friend(req: Request):
    body = await _json_obj(req)
    from api import social
    try:
        friend = social.request_friend(body.get("handle", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return friend


@app.post("/api/quest/friends/accept")
async def quest_accept_friend(req: Request):
    body = await _json_obj(req)
    from api import social
    friend = social.accept_friend(body.get("handle", ""))
    if friend is None:
        raise HTTPException(404, "no pending request from that handle")
    return friend


@app.post("/api/quest/friends/remove")
async def quest_remove_friend(req: Request):
    body = await _json_obj(req)
    from api import social
    friend = social.remove_friend(body.get("handle", ""))
    if friend is None:
        raise HTTPException(404, "no friend or request with that handle")
    return {"ok": True, "removed": friend}


@app.get("/api/quest/avatar")
def quest_avatar():
    from api import avatar
    return avatar.get()


@app.get("/api/quest/avatar/image")
def quest_avatar_image(candidate: bool = False):
    from api import avatar
    img = avatar.read_image(candidate=candidate)
    if img is None:
        raise HTTPException(404, "no avatar image")
    return Response(img, media_type="image/webp",
                    headers={"Cache-Control": "no-cache"})


@app.post("/api/quest/avatar/generate")
async def quest_avatar_generate(req: Request):
    """One tap, one image ($0.01). No retries here: a try-again is the
    player's next tap."""
    from api import avatar
    body = await _json_obj(req)
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    try:
        await run_in_threadpool(avatar.make_from_prompt, body.get("prompt", ""),
                                new_client())
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    return avatar.get()


@app.post("/api/quest/avatar/photo")
async def quest_avatar_photo(req: Request):
    """The player's own photo, drawn as a cartoon. The upload is read
    into memory, sent to Muse Image and dropped; it is never saved."""
    from api import avatar
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    photo = await req.body()
    if not photo:
        raise HTTPException(400, "empty upload")
    if len(photo) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    try:
        await run_in_threadpool(avatar.make_from_photo, photo, media,
                                new_client())
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    return avatar.get()


@app.post("/api/quest/share-look")
async def quest_share_look(req: Request, look: str = ""):
    """One paint pass for the haul card's art layer ($0.01). The body is
    the PNG; the answer is the painted WebP. Nothing is stored."""
    from api import sharelook
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if media != "image/png":
        raise HTTPException(415, "send the card art as image/png")
    art = await req.body()
    if look not in sharelook.LOOKS:
        raise HTTPException(400, "unknown look")
    if not art or len(art) > sharelook.MAX_BYTES:
        raise HTTPException(413, "card art must be under 4 MB")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    try:
        img, _ = await run_in_threadpool(sharelook.make, look, art,
                                         new_client())
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    return Response(img, media_type="image/webp",
                    headers={"Cache-Control": "no-store"})


@app.post("/api/quest/avatar/use")
def quest_avatar_use():
    from api import avatar
    try:
        return avatar.use_candidate()
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/quest/news")
def quest_news():
    """Store news: stops people flagged as not here, newest first."""
    from api import quest
    return quest.store_news()


@app.get("/api/quest/profile")
def quest_profile():
    from api import social
    return social.profile()


@app.get("/api/quest/receipts")
def quest_receipt_archive():
    from api import social
    return {"receipts": social.receipt_archive(),
            "unsettled": social.unsettled_hunts()}


@app.get("/api/quest/receipts/{receipt_id}")
def quest_receipt_detail(receipt_id: str):
    from api import social
    detail = social.receipt_detail(receipt_id)
    if detail is None:
        raise HTTPException(404, "no such receipt")
    return detail


@app.get("/api/quest/receipts/{receipt_id}/original")
def quest_receipt_original(receipt_id: str):
    """The kept original upload for a filed receipt (Discussion
    42): the caller's own bytes, served at their recorded media
    type. The lookup runs over the caller's receipts — no
    cross-account access — and the demo files nothing. A
    receipt filed without an upload (seeded history, order
    text) has no original and 404s honestly."""
    rec = next((r for r in state.receipts()
                if r["receipt_id"] == receipt_id), None)
    if rec is None or not rec.get("image_ref"):
        raise HTTPException(404, "no original kept for this receipt")
    data = state.receipt_media(receipt_id)
    if data is None:
        raise HTTPException(404, "no original kept for this receipt")
    return Response(content=data,
                    media_type=rec.get("media_type")
                    or "application/octet-stream",
                    headers={"Content-Disposition": "inline"})


@app.post("/api/quest/receipts/{receipt_id}/delete")
def quest_delete_receipt(receipt_id: str):
    """Delete a filed receipt (Tranche 1): the record and its kept
    original go; hunts it settled return to unsettled; the ledger
    and patterns recompute from what remains."""
    from api import quest, state
    if state.in_sandbox():
        raise HTTPException(403, "the demo household files nothing")
    rec = state.delete_receipt(receipt_id)
    if rec is None:
        raise HTTPException(404, "no such receipt")
    quest.detach_receipt(receipt_id)
    return {"ok": True, "deleted": receipt_id}


@app.post("/api/quest/sessions/{session_id}/report-missing")
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


@app.get("/api/quest/stores/{store}/reports")
def quest_store_reports(store: str):
    from api import quest
    return quest.store_reports(store)


from api import hunt_routes
app.include_router(hunt_routes.router)


@app.post("/api/quest/avatar")
async def quest_set_avatar(req: Request):
    body = await _json_obj(req)
    from api import quest
    saved = quest.set_avatar((body.get("file") or "").strip())
    if saved is None:
        raise HTTPException(400, "pick one of the cast portraits")
    return {"avatar": saved}


@app.get("/api/quest/sos-count")
def quest_sos_count(store: str = "", item: str = ""):
    from api import quest
    return quest.sos_count(store, item)


@app.post("/api/quest/haul-photo")
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
from api.routes import storemap as storemap_routes  # noqa: E402
app.include_router(storemap_routes.router)



from api import haul_routes  # noqa: E402  (HAUL slice: review, card, Crew)
app.include_router(haul_routes.router)

if os.path.isdir(_PWA):
    app.mount("/", StaticFiles(directory=_PWA, html=True), name="pwa")