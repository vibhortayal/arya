"""The owner's Ops screen (2026-10-31): how Arya is doing and the
switches that stop spend fast. Owner only (ARYA_OWNER_USERNAME). The
registration switch and Unfreeze keep their own routes."""
import json
import time

from fastapi import APIRouter, HTTPException, Request

from api import ops_summary, settings, site_flags, state
from api.auth import users as _users
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
    if "spark_tier" in body:
        if body["spark_tier"] not in (None, *site_flags.SPARK_TIERS):
            raise HTTPException(400, "spark_tier must be contributor, standard or null")
        changes["spark_tier"] = body["spark_tier"]
    if "reasoning_effort" in body:
        if body["reasoning_effort"] not in (None, *site_flags.REASONING):
            raise HTTPException(400, "reasoning_effort must be low, medium, high or null")
        changes["reasoning_effort"] = body["reasoning_effort"]
    if "open_model" in body:
        v = body["open_model"]
        if v is not None and not (isinstance(v, str) and 0 < len(v.strip()) <= 120):
            raise HTTPException(400, "open_model must be a model name or null")
        changes["open_model"] = v.strip() if v else None
    if "meta_says" in body:
        v = body["meta_says"]
        if v is not None and not (isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 100000):
            raise HTTPException(400, "meta_says must be a dollar amount or null")
        changes["meta_says"] = None if v is None else {"usd": round(float(v), 2), "at": int(time.time())}
    new_settings, new_overrides = {}, []
    for key, v in (body.get("settings") or {}).items():
        try:
            new_settings[key] = settings.validate(key, v)
        except ValueError as e:
            raise HTTPException(400, str(e))
    ov = body.get("overrides") or {}
    if not isinstance(ov, dict):
        raise HTTPException(400, "overrides must be an object")
    tok = state._current_user.set(None)   # accounts live in the data root
    try:
        known = {u.lower() for u in _users()}
    finally:
        state._current_user.reset(tok)
    for acct, vals in ov.items():
        if acct.lower() not in known:
            raise HTTPException(400, f"{acct} is not an account")
        if not isinstance(vals, dict):
            raise HTTPException(400, "each override must be an object")
        for key, v in vals.items():
            if key not in settings.ACCOUNT_KEYS:
                raise HTTPException(400, f"{key} cannot be set per account")
            try:
                new_overrides.append((acct.lower(), key, settings.validate(key, v)))
            except ValueError as e:
                raise HTTPException(400, str(e))
    if not (changes or new_settings or new_overrides):
        raise HTTPException(400, "nothing to change")
    now = site_flags.set_flags(changes) if changes else {}
    for key, v in new_settings.items():
        site_flags.set_nested("settings", key, v)
    for acct, key, v in new_overrides:
        site_flags.set_nested_user("overrides", acct, key, v)
    _log(user, {**changes, **({"settings": new_settings} if new_settings else {}),
                **({"overrides": {f"{a}.{k}": v for a, k, v in new_overrides}} if new_overrides else {})})
    return {"ok": True, **now}


def _log(user, what):
    """Append one line to ops-changes.jsonl: when, who, what."""
    import os
    line = json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "user": user, "set": what})
    with open(os.path.join(state.base_dir(), "ops-changes.jsonl"), "a") as fh:
        fh.write(line + "\n")
