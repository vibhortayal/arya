"""Ask Arya (chat) and the cart approval it hands back."""
import base64
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

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


@router.post("/api/chat")
async def chat_route(req: Request):
    own_key.need_model()
    _budget_guard()
    body = await _json_obj(req)
    from api.chat_service import chat as run_chat
    client = new_client()
    try:
        image = _chat_image(body.get("image"))
        surface = body.get("surface") if body.get("surface") in ("list", "hunt") else None
        return await run_in_threadpool(run_chat, body.get("messages", []), client,
                                       surface=surface, context=body.get("context"), image=image,
                                       bar=body.get("bar"))
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])


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
