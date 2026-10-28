"""Haul routes — the closed hunt's review, card, Crew post and queue.

Its own tiny JSON-object parser (no import from api.main). quest and
social are imported inside the modules that need them, so this file
adds no import cycle. No route here accepts free text: a fix names a
fixed kind and a key the review itself offered; a reaction is one of
three fixed words; a post carries only art filenames the client
picks (the server checks them against the character manifest).
"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter()

_NO_STORE = {"Cache-Control": "no-store"}


async def _obj(req: Request):
    try:
        body = await req.json()
    except Exception:
        raise HTTPException(400, "request body must be valid JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "request body must be a JSON object")
    return body


def _view_dict(session_id):
    from api import crew, haul
    try:
        v = haul.haul_view(session_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if v is None:
        raise HTTPException(404, "no such session")
    v["post"] = crew.post_state(session_id)
    return v


def _view(session_id, **post_flags):
    """The haul view with the Crew post block filled in. The private
    estimate rides this response, so it is never cached."""
    v = _view_dict(session_id)
    v["post"].update(post_flags)
    return JSONResponse(v, headers=_NO_STORE)


def _wrap(fn, *args):
    """Run a haul call: ValueError is a 400, LookupError a 404, a
    missing trip (None) a 404."""
    try:
        out = fn(*args)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))
    if out is None:
        raise HTTPException(404, "no such session")
    return out


# --- the haul view ------------------------------------------------------------------

@router.get("/api/quest/sessions/{session_id}/haul")
def haul_get(session_id: str):
    return _view(session_id)


@router.post("/api/quest/sessions/{session_id}/haul/fix")
async def haul_fix(session_id: str, req: Request):
    from api import haul
    body = await _obj(req)
    _wrap(haul.fix, session_id, str(body.get("kind") or ""),
          str(body.get("key") or ""))
    return _view(session_id)


@router.post("/api/quest/sessions/{session_id}/haul/receipts")
async def haul_receipts(session_id: str, req: Request):
    from api import haul
    body = await _obj(req)
    rid = str(body.get("receipt_id") or "")
    if not rid:
        raise HTTPException(400, "receipt_id is required")
    _wrap(haul.add_receipt, session_id, rid)
    return _view(session_id)


@router.post("/api/quest/sessions/{session_id}/haul/hide")
async def haul_hide(session_id: str, req: Request):
    from api import crew, haul
    body = await _obj(req)
    key = str(body.get("key") or "")
    if not key:
        raise HTTPException(400, "key is required")
    _wrap(haul.hide, session_id, key, bool(body.get("hidden")))
    # A hide or show updates a live post in place.
    taken_down = False
    if haul.record(session_id)["post"]:
        try:
            crew.publish(session_id)
        except ValueError:
            # Every sticker is hidden: a post with nothing in it comes
            # down, and the client says so.
            crew.unpublish(session_id)
            taken_down = True
    return _view(session_id, taken_down=taken_down)


@router.post("/api/quest/sessions/{session_id}/haul/post")
async def haul_post(session_id: str, req: Request):
    from api import crew
    body = await _obj(req)
    items = body.get("items")
    if items is not None and not isinstance(items, list):
        raise HTTPException(400, "items must be a list")
    _wrap(crew.publish, session_id, items)
    return _view(session_id)


@router.delete("/api/quest/sessions/{session_id}/haul/post")
def haul_unpost(session_id: str):
    from api import crew, quest
    if quest.get_session(session_id) is None:
        raise HTTPException(404, "no such session")
    crew.unpublish(session_id)
    return _view(session_id)


# --- Crew ------------------------------------------------------------------------------

@router.get("/api/quest/crew/audience")
def crew_audience():
    from api import crew
    return {"audience": crew.audience()}


@router.get("/api/quest/crew/feed")
def crew_feed():
    from api import crew
    return {"feed": crew.feed()}


@router.post("/api/quest/crew/posts/{author}/{post_id}/react")
async def crew_react(author: str, post_id: str, req: Request):
    from api import crew
    body = await _obj(req)
    post = _wrap(crew.react, author, post_id, body.get("kind"))
    return {"post": post}


# --- the 'Same haul' queue -----------------------------------------------------------------

@router.get("/api/quest/queued")
def queued_get():
    from api import haul
    return {"queued": haul.queued_list()}


@router.post("/api/quest/queued")
async def queued_post(req: Request):
    from api import crew, haul, state
    body = await _obj(req)
    names = body.get("names")
    if not isinstance(names, list):
        raise HTTPException(400, "names must be a list")
    handle = str(body.get("from") or "")
    post_id = str(body.get("post_id") or "")
    post = crew.inbox_post(handle, post_id)
    if post is not None:
        # A real friend's post: only items that post names can queue.
        allowed = {haul.key_of(i["name"]) for i in post["items"]}
        names = [n for n in names if haul.key_of(str(n)) in allowed]
    elif not state.in_sandbox():
        raise HTTPException(404, "no such post")
    try:
        rows = haul.queued_add(handle, post_id, [str(n) for n in names])
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"queued": rows}


@router.post("/api/quest/queued/finish")
async def queued_finish_route(req: Request):
    from api import haul
    body = await _obj(req)
    ids = body.get("ids")
    if not isinstance(ids, list):
        raise HTTPException(400, "ids must be a list")
    return {"queued": haul.queued_finish(ids)}


@router.delete("/api/quest/queued/{row_id}")
def queued_delete(row_id: str):
    from api import haul
    return {"queued": haul.queued_remove(row_id)}
