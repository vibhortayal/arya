"""Groups: share lists and receipts with the people you shop for
(flag ARYA_GROUPS=1). See api/groups.py for the rules."""
from fastapi import APIRouter, HTTPException, Request

from api import groups, state
from api.demo_guard import _is_demo
from api.deps import _client_ip, _json_obj

router = APIRouter()

# Wrong-code guesses per IP, like sign-in: a 6-letter code from a
# 31-letter alphabet is about 900 million codes, and 20 tries an hour
# never gets near one.
_code_tries = {}
_CODE_TRIES_PER_HOUR = 20


def _me(req):
    if not groups.enabled():
        raise HTTPException(404, "groups are not turned on")
    if _is_demo(req):
        raise HTTPException(403, "the demo household cannot join a group — make an account first")
    return state._current_user.get()


def _rate(req):
    import time
    ip = _client_ip(req)
    now = time.time()
    hits = [t for t in _code_tries.get(ip, []) if now - t < 3600]
    if len(hits) >= _CODE_TRIES_PER_HOUR:
        raise HTTPException(429, "too many codes tried — wait an hour and try again")
    _code_tries[ip] = hits + [now]
    if len(_code_tries) > 5000:
        for k in [k for k, v in _code_tries.items() if not v or now - v[-1] > 3600]:
            del _code_tries[k]


@router.get("/api/group")
def group_get(req: Request):
    if not groups.enabled() or _is_demo(req):
        return {"enabled": False, "group": None}
    user = state._current_user.get()
    return {"enabled": True, "group": groups.view(user),
            "recent": groups.recent(user)}


@router.post("/api/group")
async def group_create(req: Request):
    user = _me(req)
    body = await _json_obj(req)
    try:
        groups.create(user, body.get("name", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"enabled": True, "group": groups.view(user)}


@router.post("/api/group/rename")
async def group_rename(req: Request):
    user = _me(req)
    body = await _json_obj(req)
    try:
        groups.rename(user, body.get("name", ""))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"enabled": True, "group": groups.view(user)}


@router.post("/api/group/invite")
def group_invite(req: Request):
    user = _me(req)
    try:
        code, expires = groups.invite(user)
    except LookupError as e:
        raise HTTPException(404, str(e))
    return {"code": code, "expires": expires,
            "hours": groups.INVITE_TTL // 3600}


@router.get("/api/group/preview")
def group_preview(req: Request, code: str = ""):
    _me(req)
    _rate(req)
    p = groups.preview(code)
    if p is None:
        raise HTTPException(404, "that code is wrong or has expired")
    mine = state.named_lists()
    return {**p, "my_lists": len(mine)}


@router.post("/api/group/join")
async def group_join(req: Request):
    user = _me(req)
    _rate(req)
    body = await _json_obj(req)
    try:
        groups.join(user, body.get("code", ""))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"enabled": True, "group": groups.view(user)}


@router.get("/api/group/leave-preview")
def group_leave_preview(req: Request):
    user = _me(req)
    p = groups.leave_preview(user)
    if p is None:
        raise HTTPException(404, "you are not in a group")
    return p


@router.post("/api/group/leave")
def group_leave(req: Request):
    user = _me(req)
    if groups.leave(user) is None:
        raise HTTPException(404, "you are not in a group")
    return {"enabled": True, "group": None}


@router.post("/api/group/remove")
async def group_remove(req: Request):
    user = _me(req)
    body = await _json_obj(req)
    try:
        gone = groups.remove(user, body.get("handle", ""))
    except PermissionError as e:
        raise HTTPException(403, str(e))
    except LookupError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"removed": gone, "group": groups.view(user)}
