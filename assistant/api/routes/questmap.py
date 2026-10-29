"""Quest store maps: file list items into a store's zones (api/questmap.py)."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

from api import questbuild, questmap
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


@router.post("/api/quest/build")
async def quest_build(request: Request):
    """{answers, base: graph} -> {graph, say}. Arya adapts the store the
    answers made; any failure returns the base. 400 for a bad base."""
    body = await _json_obj(request)
    client = None
    try:
        _budget_guard(demo=_is_demo(request))
        client = new_client()
    except HTTPException:
        pass
    graph, say = await run_in_threadpool(questbuild.build, client, body.get("answers"), body.get("base"))
    if graph is None:
        raise HTTPException(400, "That store can't be built.")
    return {"graph": graph, "say": say}


@router.post("/api/quest/build/change")
async def quest_build_change(request: Request):
    """{graph, say} -> {graph, say}: one change said in a sentence."""
    body = await _json_obj(request)
    client = None
    try:
        _budget_guard(demo=_is_demo(request))
        client = new_client()
    except HTTPException:
        pass
    graph, say = await run_in_threadpool(questbuild.change, client, body.get("graph"), body.get("say"))
    if graph is None:
        raise HTTPException(400, "That store can't be changed.")
    return {"graph": graph, "say": say}


@router.get("/api/quest/maps")
def quest_maps():
    """The player's saved stores: My maps and dream stores, newest first."""
    return {"maps": questbuild.list_maps()}


@router.put("/api/quest/maps")
async def quest_maps_save(request: Request):
    """{kind, name, graph, storeId?} -> the saved map."""
    row = questbuild.save_map(await _json_obj(request))
    if row is None:
        raise HTTPException(400, "That map can't be saved.")
    return row
