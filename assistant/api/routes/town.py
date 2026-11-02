"""Demo Town routes: the simulated neighbourhood of the demo household.
Served only to the demo account and only when ARYA_DEMO_TOWN=1; anyone
else gets a 404, as if the routes did not exist (api/town.py)."""
from fastapi import APIRouter, HTTPException, Request

from api import town
from api.deps import _json_obj

router = APIRouter()


def _need_town():
    if not town.active():
        raise HTTPException(404, "not found")


@router.get("/api/town/hints")
def town_hints():
    # The demo asks once per visit; with the flag off it gets a plain
    # "no town" (null) instead of a 404 in the console (performance
    # report 2026-11-02, finding 7). A real account still gets 404.
    from api import state
    if not town.active() and state._current_user.get() == state.DEMO_USER:
        return None
    _need_town()
    return town.hints()


@router.post("/api/town/director")
async def town_director(req: Request):
    _need_town()
    body = await _json_obj(req)
    try:
        town.stage(str(body.get("scenario", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return town.hints()


@router.post("/api/town/report")
async def town_report(req: Request):
    _need_town()
    body = await _json_obj(req)
    try:
        town.report(str(body.get("kind", "")), str(body.get("store", "")), str(body.get("item", "")))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return town.hints()
