"""Quest friends: list, request, accept, remove."""
from fastapi import APIRouter, HTTPException, Request

from api.deps import _json_obj

router = APIRouter()


@router.get("/api/quest/friends")
def quest_list_friends():
    from api import social
    return {"friends": social.list_friends()}


@router.post("/api/quest/friends")
async def quest_request_friend(req: Request):
    body = await _json_obj(req)
    from api import social
    try:
        friend = social.request_friend(body.get("handle", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return friend


@router.post("/api/quest/friends/accept")
async def quest_accept_friend(req: Request):
    body = await _json_obj(req)
    from api import social
    friend = social.accept_friend(body.get("handle", ""))
    if friend is None:
        raise HTTPException(404, "no pending request from that handle")
    return friend


@router.post("/api/quest/friends/remove")
async def quest_remove_friend(req: Request):
    body = await _json_obj(req)
    from api import social
    friend = social.remove_friend(body.get("handle", ""))
    if friend is None:
        raise HTTPException(404, "no friend or request with that handle")
    return {"ok": True, "removed": friend}
