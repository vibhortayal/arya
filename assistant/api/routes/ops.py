"""The owner's Ops screen (2026-10-31): how Arya is doing and the
switches that stop spend fast. Owner only (ARYA_OWNER_USERNAME). The
registration switch and Unfreeze keep their own routes."""
import json
import time

from fastapi import APIRouter, HTTPException, Request

from api import ops_summary, site_flags, state
from api.deps import _is_owner, _json_obj

router = APIRouter()


def _owner_only():
    user = state._owner()
    if not _is_owner(user):
        raise HTTPException(403, "owner only")
    return user


@router.get("/api/ops")
def ops_get():
    _owner_only()
    return ops_summary.summary()


@router.post("/api/ops/controls")
async def ops_controls(req: Request):
    """Set the owner's switches. Each key is optional; photo_reader null
    hands the choice back to the environment. Every change is written
    to ops-changes.jsonl with the time."""
    user = _owner_only()
    body = await _json_obj(req)
    changes = {}
    for key in ("ai_paused", "demo_live"):
        if key in body:
            if not isinstance(body[key], bool):
                raise HTTPException(400, f"{key} must be true or false")
            changes[key] = body[key]
    if "photo_reader" in body:
        if body["photo_reader"] not in (None, *site_flags.PHOTO_READERS):
            raise HTTPException(400, "photo_reader must be spark, wonder, auto or null")
        changes["photo_reader"] = body["photo_reader"]
    if not changes:
        raise HTTPException(400, "nothing to change")
    now = site_flags.set_flags(changes)
    line = json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "user": user, "set": changes})
    import os
    with open(os.path.join(state.base_dir(), "ops-changes.jsonl"), "a") as fh:
        fh.write(line + "\n")
    return {"ok": True, **now}
