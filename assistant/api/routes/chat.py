"""Ask Arya (chat) and the cart approval it hands back."""
import base64
import os

from api.errors import safe_detail
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import ask_guard
from api import own_key
from api import state
from api.cart.build import approve
from api.deps import _budget_guard, _json_obj, new_client

router = APIRouter()


_IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp", "image/gif")
_IMAGE_MAX_B64 = 8_000_000  # about 6 MB of picture; the phone shrinks it first


def _chat_image(raw):
    """The optional photo asked about with a question: {media_type, data}
    with base64 data. One-shot: read for this answer, never stored."""
    if raw is None:
        return None
    if not isinstance(raw, dict) or raw.get("media_type") not in _IMAGE_TYPES:
        raise HTTPException(415, "image must be a jpeg, png, webp or gif photo")
    data = raw.get("data")
    if not isinstance(data, str) or not data:
        raise HTTPException(400, "image data is required")
    if len(data) > _IMAGE_MAX_B64:
        raise HTTPException(413, "photo too large")
    try:
        base64.b64decode(data, validate=True)
    except ValueError:
        raise HTTPException(400, "image data must be base64")
    return {"media_type": raw["media_type"], "data": data}


def _ask_keys(req):
    """Who this Ask caller is for the three-strike lock. The owner is
    never locked, so has no keys."""
    from api import auth
    from api.deps import _client_ip, _is_owner
    from api.demo_guard import _is_demo
    if _is_demo(req):
        return ask_guard.keys_for(demo=True, session=req.cookies.get(auth.COOKIE),
                                  ip=_client_ip(req)), True
    user = state._owner()
    if not user or _is_owner(user):
        return [], False
    return ask_guard.keys_for(user=user), False


@router.post("/api/chat")
async def chat_route(req: Request):
    keys, demo = _ask_keys(req)
    if ask_guard.locked(keys):
        raise HTTPException(403, ask_guard.LOCKED_DEMO if demo else ask_guard.LOCKED)
    body = await _json_obj(req)
    # Rules, not a model: a plain attempt to get around Arya's rules in
    # the user's own latest message gets a fixed answer and a strike,
    # before any credit is spent. Stored text never strikes.
    family = ask_guard.check(ask_guard.latest_user_text(body.get("messages")))
    if family:
        _n, now_locked = ask_guard.strike(keys, family, demo=demo)
        reply = ask_guard.REFUSAL
        if now_locked:
            reply += " " + (ask_guard.LOCKED_DEMO if demo else ask_guard.LOCKED)
        return {"reply": reply, "applied": [], "skipped": [], "added": [],
                "proposed": [], "choices": [], "guarded": True}
    own_key.need_model()
    _budget_guard()
    from api.chat_service import chat as run_chat
    client = new_client()
    try:
        image = _chat_image(body.get("image"))
        surface = body.get("surface") if body.get("surface") in ("list", "hunt") else None
        return await run_in_threadpool(run_chat, body.get("messages", []), client,
                                       surface=surface, context=body.get("context"), image=image,
                                       bar=body.get("bar"))
    except RuntimeError as e:
        raise HTTPException(502, safe_detail(e))


@router.post("/api/chat/apply")
async def chat_apply_route(req: Request):
    """The yes to an action Arya proposed from the List or a hunt."""
    body = await _json_obj(req)
    actions = body.get("actions")
    if not isinstance(actions, list) or not actions:
        raise HTTPException(400, "actions are required")
    from api.chat_service import apply_confirmed
    return await run_in_threadpool(apply_confirmed, actions[:10])


@router.post("/api/cart/approve")
def approve_route():
    cart = approve(state.get_cart())
    state.save_cart(cart)
    return cart
