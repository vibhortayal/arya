"""Ask Arya (chat) and the cart approval it hands back."""
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import state
from api.cart.build import approve
from api.deps import _budget_guard, _json_obj, new_client

router = APIRouter()


@router.post("/api/chat")
async def chat_route(req: Request):
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    body = await _json_obj(req)
    from api.chat_service import chat as run_chat
    client = new_client()
    try:
        surface = body.get("surface") if body.get("surface") in ("list", "hunt") else None
        return await run_in_threadpool(run_chat, body.get("messages", []), client,
                                       surface=surface, context=body.get("context"))
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
