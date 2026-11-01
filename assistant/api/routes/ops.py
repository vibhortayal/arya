"""The owner's Ops screen (2026-10-31): how Arya is doing and the
switches that stop spend fast. Owner only (ARYA_OWNER_USERNAME). The
registration switch and Unfreeze keep their own routes."""
import json
import os
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


def _accounts():
    """Every real account: spend today, frozen, switched off, owner."""
    tok = state._current_user.set(None)   # accounts live in the data root
    try:
        names = sorted(_users())
    finally:
        state._current_user.reset(tok)
    from api import deps
    from api.cost_ledger import CostLedger
    today = dict(CostLedger(deps._LEDGER).health(24)["top_users"])
    frozen = deps._freezes()
    return [{"user": n, "usd_24h": round(today.get(n, 0), 2), "owner": deps._is_owner(n),
             "frozen": deps.frozen_until(n) > 0 and n in frozen, "disabled": site_flags.disabled(n)}
            for n in names if n != "demo"]


@router.get("/api/ops/accounts")
def ops_accounts():
    _owner_only()
    o = site_flags.raw().get("owner") or {}
    return {"accounts": _accounts(), "owner": {"username": o.get("username"), "previous": o.get("previous"),
            "at": o.get("at"), "undo_s": site_flags.OWNER_UNDO_S}}


@router.post("/api/ops/accounts")
async def ops_account_set(req: Request):
    """Switch an account off or back on. Its sign-in and every call then
    answer 403 until switched on again. The owner cannot be switched off."""
    me = _owner_only()
    body = await _json_obj(req)
    acct = str(body.get("user") or "").strip().lower()
    if not isinstance(body.get("disabled"), bool):
        raise HTTPException(400, "disabled must be true or false")
    if acct not in {a["user"].lower() for a in _accounts()}:
        raise HTTPException(400, f"{acct or 'that'} is not an account")
    from api import deps
    if deps._is_owner(acct):
        raise HTTPException(400, "the owner account cannot be switched off")
    site_flags.set_nested("disabled", acct, True if body["disabled"] else None)
    _log(me, {"disabled": {acct: body["disabled"]}})
    return {"ok": True}


@router.post("/api/ops/owner")
async def ops_owner_set(req: Request):
    """Name a new owner account. Guards against a lock-out: the account
    must exist and have signed in before (it has a password), the
    current owner must confirm with their password, and the old owner
    keeps owner rights for 24 hours so a wrong pick can be undone from
    it. If locked out anyway: docs/OPS.md, "Recover the owner"."""
    me = _owner_only()
    body = await _json_obj(req)
    target = str(body.get("username") or "").strip().lower()
    from api import auth, deps
    known = {a["user"].lower() for a in _accounts()}
    if target not in known:
        raise HTTPException(400, f"{target or 'that'} is not an account")
    tok = state._current_user.set(None)   # accounts live in the data root
    try:
        has_pw = bool((auth.users().get(auth.resolve_login_name(me)) or {}).get("hash"))
        pw_ok = auth.verify(me, str(body.get("password") or ""))
    finally:
        state._current_user.reset(tok)
    if has_pw and not pw_ok:
        raise HTTPException(403, "that password is not right")
    if not has_pw and str(body.get("confirm") or "").strip().lower() != target:
        # A Google-only owner has no password: type the new owner's name instead.
        raise HTTPException(403, "type the new owner's account name to confirm")
    if deps._is_owner(target) and target == me.lower():
        raise HTTPException(400, "that account is already the owner")
    site_flags.set_nested("owner", "username", target)
    site_flags.set_nested("owner", "previous", me.lower())
    site_flags.set_nested("owner", "at", int(time.time()))
    _log(me, {"owner": {"from": me.lower(), "to": target}})
    return {"ok": True, "owner": target}


@router.post("/api/ops/delete")
async def ops_delete(req: Request):
    """Erase one account's receipts or learned names. The owner must
    type the account name (confirm); a copy is saved first."""
    me = _owner_only()
    body = await _json_obj(req)
    from api import ops_data
    acct = str(body.get("user") or "").strip().lower()
    what = body.get("what")
    if what not in ops_data.WHAT:
        raise HTTPException(400, "what must be receipts or names")
    if acct not in {a["user"].lower() for a in _accounts()}:
        raise HTTPException(400, f"{acct or 'that'} is not an account")
    if str(body.get("confirm") or "").strip().lower() != acct:
        raise HTTPException(400, "type the account name to confirm")
    try:
        out = ops_data.delete_data(acct, what)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _log(me, {"deleted": {"user": acct, "what": what, "removed": out["removed"]}})
    return {"ok": True, **out}


@router.get("/api/ops/mirror")
def ops_mirror():
    _owner_only()
    from api import ops_data, pgstore
    return {"store": pgstore.mode(), "configured": bool(os.environ.get("DATABASE_URL")), **ops_data.job()}


@router.post("/api/ops/mirror")
async def ops_mirror_run(req: Request):
    me = _owner_only()
    body = await _json_obj(req)
    from api import ops_data
    try:
        started = ops_data.start(str(body.get("kind") or ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not started:
        raise HTTPException(409, "a job is already running")
    _log(me, {"mirror": body.get("kind")})
    return {"ok": True}
