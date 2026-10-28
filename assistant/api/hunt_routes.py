"""Hunt routes — the shopper's in-aisle changes (see api/hunt.py).

Every route lives under /api/quest/sessions/{sid}/..., so the demo
sandbox (writes land in the visitor's overlay, never on disk) and the
per-IP rate cap apply unchanged. No route calls a model. Each answers
with quest.session_view(...), the same shape the hunt already holds.
404 = no such session or item; 400 = the request is refused.
"""
from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


async def _obj(req: Request):
    try:
        body = await req.json()
    except Exception:
        raise HTTPException(400, "request body must be valid JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "request body must be a JSON object")
    return body


def _answer(fn, *args, extra=None, **kwargs):
    # Lazy imports keep this module free of import cycles.
    from api import hunt, quest
    try:
        sess = fn(*args, **kwargs)
    except hunt.NotFound as e:
        raise HTTPException(404, f"no such item in this session: {e}")
    except ValueError as e:
        raise HTTPException(400, str(e))
    if sess is None:
        raise HTTPException(404, "no such session")
    out = quest.session_view(sess)
    if extra is not None:
        out["forgot"] = dict(extra)
    return out


@router.post("/api/quest/sessions/{sid}/leave")
async def hunt_leave(sid: str, req: Request):
    from api import hunt
    body = await _obj(req)
    return _answer(hunt.leave, sid, body.get("entries"))


@router.post("/api/quest/sessions/{sid}/restore")
async def hunt_restore(sid: str, req: Request):
    from api import hunt
    body = await _obj(req)
    return _answer(hunt.restore, sid, body.get("item"))


@router.post("/api/quest/sessions/{sid}/edit")
async def hunt_edit(sid: str, req: Request):
    from api import hunt
    body = await _obj(req)
    return _answer(hunt.update_item, sid, body.get("item"),
                   qty=body.get("qty"), note=body.get("note"))


@router.post("/api/quest/sessions/{sid}/swap")
async def hunt_swap(sid: str, req: Request):
    from api import hunt
    body = await _obj(req)
    return _answer(hunt.swap, sid, body.get("item"), body.get("to"))


@router.post("/api/quest/sessions/{sid}/unswap")
async def hunt_unswap(sid: str, req: Request):
    from api import hunt
    body = await _obj(req)
    return _answer(hunt.unswap, sid, body.get("to"))


@router.post("/api/quest/sessions/{sid}/forgot")
async def hunt_forgot(sid: str, req: Request):
    from api import hunt
    body = await _obj(req)
    # The answer also carries "forgot": {result, reopened, prev_qty,
    # item, how}, what the server did with the typed name.
    res = {}
    return _answer(hunt.forgot, sid, body.get("name"), qty=body.get("qty", 1),
                   note=body.get("note") or "", result=res, extra=res)


@router.post("/api/quest/sessions/{sid}/remove-added")
async def hunt_remove_added(sid: str, req: Request):
    from api import hunt
    body = await _obj(req)
    return _answer(hunt.remove_added, sid, body.get("item"))


@router.post("/api/quest/sessions/{sid}/withdraw-report")
async def hunt_withdraw_report(sid: str, req: Request):
    from api import hunt
    body = await _obj(req)
    return _answer(hunt.withdraw_report, sid, body.get("item"))
