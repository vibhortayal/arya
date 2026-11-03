"""The shopper's look: avatar, generated looks, shared looks, news and profile."""
import os

from api.errors import safe_detail
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

from api import own_key
from api.deps import _budget_guard, _json_obj, new_client

router = APIRouter()


@router.get("/api/quest/avatar")
def quest_avatar():
    from api import avatar
    return avatar.get()


@router.get("/api/quest/avatar/image")
def quest_avatar_image(candidate: bool = False):
    from api import avatar
    img = avatar.read_image(candidate=candidate)
    if img is None:
        raise HTTPException(404, "no avatar image")
    return Response(img, media_type="image/webp",
                    headers={"Cache-Control": "no-cache"})


@router.post("/api/quest/avatar/generate")
async def quest_avatar_generate(req: Request):
    """One tap, one image ($0.01). No retries here: a try-again is the
    player's next tap."""
    from api import avatar
    body = await _json_obj(req)
    own_key.need_model()
    _budget_guard()
    try:
        await run_in_threadpool(avatar.make_from_prompt, body.get("prompt", ""),
                                new_client())
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, safe_detail(e))
    return avatar.get()


@router.post("/api/quest/avatar/photo")
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
    own_key.need_model()
    _budget_guard()
    try:
        await run_in_threadpool(avatar.make_from_photo, photo, media,
                                new_client())
    except RuntimeError as e:
        raise HTTPException(502, safe_detail(e))
    return avatar.get()


@router.post("/api/quest/share-look")
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
    own_key.need_model()
    _budget_guard()
    try:
        img, _ = await run_in_threadpool(sharelook.make, look, art,
                                         new_client())
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, safe_detail(e))
    return Response(img, media_type="image/webp",
                    headers={"Cache-Control": "no-store"})


@router.post("/api/quest/avatar/use")
def quest_avatar_use():
    from api import avatar
    try:
        return avatar.use_candidate()
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/api/quest/news")
def quest_news():
    """Store news: stops people flagged as not here, newest first."""
    from api import quest
    return quest.store_news()


@router.get("/api/quest/profile")
def quest_profile():
    from api import social
    return social.profile()


@router.get("/api/quest/game")
def quest_game_get():
    """The Quest game's profile (stickers, xp, weeks), or null, with
    what the game adds to it for display: base_points (receipt-closed
    hunts) and weeks (every played week, "2026-W44")."""
    from api import game_profile, social
    prof = social.profile()
    return {"profile": game_profile.load(),
            "base_points": max(0, prof["points"] - game_profile.xp()),
            "weeks": sorted(f"{y}-W{w:02d}" for y, w in social.played_weeks())}


@router.put("/api/quest/game")
async def quest_game_put(req: Request):
    body = await _json_obj(req)
    from api import game_profile
    try:
        return {"profile": game_profile.save(body.get("profile"))}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/api/quest/avatar")
async def quest_set_avatar(req: Request):
    body = await _json_obj(req)
    from api import quest
    saved = quest.set_avatar((body.get("file") or "").strip())
    if saved is None:
        raise HTTPException(400, "pick one of the cast portraits")
    return {"avatar": saved}
