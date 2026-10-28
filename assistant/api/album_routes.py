"""Album routes (Game: album). Sticker and album reads and the manual
add. Own tiny JSON parser and lazy imports, so this module never
imports api.main (no cycle). No model call anywhere here."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

router = APIRouter()

NAME_MAX = 80


async def _obj(req: Request):
    try:
        body = await req.json()
    except Exception:
        raise HTTPException(400, "request body must be JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "request body must be a JSON object")
    return body


def _session_or_404(session_id):
    from api import quest
    sess = quest.get_session(session_id) if session_id else None
    if sess is None:
        raise HTTPException(404, "no such session")
    return sess


@router.get("/api/quest/album")
def quest_album():
    from api import album
    return album.view()


@router.get("/api/quest/stickers")
def quest_stickers(session: str = ""):
    from api import stickers
    sess = _session_or_404(session)
    return {"stickers": stickers.for_session(sess)}


@router.get("/api/quest/stickers/new")
def quest_stickers_new(session: str = ""):
    from api import stickers
    _session_or_404(session)
    return {"new": stickers.new_in_session(session)}


@router.post("/api/quest/stickers")
async def quest_stickers_add(req: Request):
    """Add a sticker by name (a receipt-only find the shopper keeps).
    Idempotent by product. Stock art only: no photo is involved."""
    from api import quest, stickers
    body = await _obj(req)
    name = " ".join(str(body.get("name") or "").split())[:NAME_MAX].strip()
    if not name:
        raise HTTPException(400, "name is required")
    session_id, store = None, None
    sid = str(body.get("session") or "").strip()
    if sid:
        sess = quest.get_session(sid)
        if sess is not None:
            session_id, store = sess["id"], sess.get("store")
    if not store and body.get("store"):
        store = str(body["store"]).strip()[:80] or None
    sticker, is_new = stickers.add_sticker(
        name, session_id=session_id, store=store, source="manual")
    return {"sticker": sticker, "is_new": is_new}


@router.get("/api/quest/stickers/{sticker_id}/image")
async def quest_sticker_image(sticker_id: str):
    """The product cutout (webp). 404 for an art-only sticker, an
    unknown id, or an id that is not a plain name."""
    from api import stickers
    import os
    if os.path.basename(sticker_id) != sticker_id:
        raise HTTPException(404, "no such sticker image")
    data = await run_in_threadpool(stickers.media_bytes, sticker_id)
    if data is None:
        raise HTTPException(404, "no such sticker image")
    return Response(content=data, media_type="image/webp",
                    headers={"Cache-Control": "private, max-age=86400"})
