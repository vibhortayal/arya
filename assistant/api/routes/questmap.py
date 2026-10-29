"""Quest store maps: file list items into a store's zones (api/questmap.py)."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import questmap
from api.demo_guard import _is_demo
from api.deps import _budget_guard, _json_obj, new_client

router = APIRouter()


@router.post("/api/quest/zones")
async def quest_zones(request: Request):
    """{graph, items: [name], zones: [{id, label, categories}]} ->
    {zones: {name: zone_id}, source: {name: "cache"|"model"}}. Over
    today's budget it answers from the cache only."""
    body = await _json_obj(request)
    client = None
    try:
        _budget_guard(demo=_is_demo(request))
        client = new_client()
    except HTTPException:
        pass
    zones, source = await run_in_threadpool(
        questmap.classify, client, body.get("graph"), body.get("items"), body.get("zones"))
    return {"zones": zones, "source": source}
