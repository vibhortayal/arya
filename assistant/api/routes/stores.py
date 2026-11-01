"""Stores: the platform directory and My Stores."""
from fastapi import APIRouter, HTTPException, Request

from api import state
from api.deps import _json_obj

router = APIRouter()


# --- Stores (Stage E): the platform directory + My Stores ---

@router.get("/api/stores/search")
def stores_search(q: str = "", quests: int = 0):
    from api import stores as stores_mod
    return {"stores": stores_mod.search_views(q, quests_only=bool(quests))}


@router.get("/api/stores/mine")
def stores_mine():
    from api import stores as stores_mod
    return {"stores": stores_mod.mine()}


@router.post("/api/stores/mine")
async def stores_add_mine(req: Request):
    body = await _json_obj(req)
    store_id = (body.get("store_id") or "").strip()
    if not store_id:
        raise HTTPException(400, "store_id is required")
    from api import stores as stores_mod
    row = stores_mod.add_to_mine(store_id)
    if row is None:
        raise HTTPException(404, "no such store in the directory")
    return row


@router.post("/api/stores")
async def stores_create(req: Request):
    body = await _json_obj(req)
    from api import stores as stores_mod
    try:
        store, _created = stores_mod.create_store(
            body.get("name"), body.get("street"), body.get("city"),
            body.get("state"), body.get("zip"),
            created_by=state._current_user.get())
    except ValueError as e:
        raise HTTPException(400, str(e))
    return stores_mod.add_to_mine(store["id"])


def _places_allowed():
    """Per own-key account, a daily count of Google lookups."""
    from api import own_key, settings
    if not own_key.required():
        return True
    import time as _t
    today = _t.strftime("%Y-%m-%d")
    doc = state._load("places_count.json", {})
    n = doc.get(today, 0) if isinstance(doc, dict) else 0
    if n >= settings.get("places_daily_lookups"):
        return False
    state._save("places_count.json", {today: n + 1})
    return True


@router.get("/api/stores/places")
def stores_places(q: str = "", session: str = "",
                  lat: float = None, lng: float = None):
    """Google Places suggestions for the store picker. A plain def
    route: the upstream call blocks, so FastAPI runs it in the
    threadpool. Unprovisioned (no key) is a quiet no-op, the
    second-seat shape."""
    from api import places
    nearby = not q.strip() and lat is not None and lng is not None
    if not places.provisioned() or (len(q.strip()) < 3 and not nearby):
        return {"provisioned": places.provisioned(), "suggestions": []}
    if not _places_allowed():
        # Google bills the app per lookup; an own-key account gets a
        # daily allowance (BYOK review 2, change 7). The picker still
        # takes a typed store.
        return {"provisioned": True, "suggestions": [], "capped": True}
    try:
        if nearby:
            # "Near me": grocery stores around the phone, no typing.
            rows = places._text_search_stores("", lat, lng)
        else:
            rows = places.autocomplete(q.strip(), session or None, lat, lng)
    except places.PlacesError:
        return {"provisioned": True, "suggestions": [], "error": "places"}
    return {"provisioned": True, "suggestions": rows}


@router.post("/api/stores/places/pick")
async def stores_places_pick(req: Request):
    body = await _json_obj(req)
    place_id = (body.get("place_id") or "").strip()
    name = (body.get("name") or "").strip()
    if not place_id or not name:
        raise HTTPException(400, "place_id and name are required")
    from api import places
    if not places.provisioned():
        raise HTTPException(503, "Google Places is not provisioned yet")
    from starlette.concurrency import run_in_threadpool
    try:
        row = await run_in_threadpool(
            places.pick_store, place_id, name, state._current_user.get())
    except places.PlacesError as e:
        raise HTTPException(502, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return row


@router.post("/api/stores/favorite")
async def stores_favorite(req: Request):
    body = await _json_obj(req)
    store_id = (body.get("store_id") or "").strip()
    if not store_id:
        raise HTTPException(400, "store_id is required")
    if "favorite" not in body:
        raise HTTPException(400, "favorite is required")
    from api import stores as stores_mod
    row = stores_mod.set_favorite(store_id, body.get("favorite"))
    if row is None:
        raise HTTPException(404, "that store is not in your stores")
    return row


@router.post("/api/stores/mine/remove")
async def stores_mine_remove(req: Request):
    body = await _json_obj(req)
    store_id = (body.get("store_id") or "").strip()
    if not store_id:
        raise HTTPException(400, "store_id is required")
    from api import stores as stores_mod
    if not stores_mod.remove_from_mine(store_id):
        raise HTTPException(404, "that store is not in your stores")
    return {"ok": True, "removed": store_id}


@router.get("/api/stores/kroger-aisle")
def stores_kroger_aisle(store_id: str = "", item: str = ""):
    """A live, unsaved aisle suggestion for a Kroger-family store (see
    api/kroger.py). Always 200: {"hint": null} means fall back to the
    crowd map. A plain def route: the upstream call blocks."""
    from api import kroger, stores as stores_mod
    store = stores_mod.get_store(store_id.strip())
    if store is None:
        raise HTTPException(404, "no such store in the directory")
    if not kroger.enabled():
        return {"enabled": False, "hint": None}
    return {"enabled": True, "hint": kroger.aisle_hint(store, item),
            "source": "Kroger"}


@router.post("/api/stores/kroger-trip")
async def stores_kroger_trip(req: Request):
    """Aisle hints for the items of one trip, in one call. The app keeps
    them in memory until checkout and never saves them."""
    from fastapi.concurrency import run_in_threadpool
    from api import kroger, stores as stores_mod
    body = await _json_obj(req)
    store = stores_mod.get_store(str(body.get("store_id") or "").strip())
    if store is None:
        raise HTTPException(404, "no such store in the directory")
    if not kroger.enabled():
        return {"enabled": False, "hints": {}}
    items = body.get("items")
    if not isinstance(items, list):
        raise HTTPException(400, "items must be a list")
    hints = await run_in_threadpool(
        kroger.trip_hints, store, [str(i) for i in items[:30]])
    return {"enabled": True, "hints": hints, "source": "Kroger"}
