"""Account-level routes: settings, data export, feedback and push reminders."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from api import state
from api.demo_guard import _is_demo
from api.deps import _json_obj

router = APIRouter()


# ---- Account settings. Currency only so far (owner, 2026-10-29): it
# changes the symbol prices show with, nothing else. No exchange rates
# and no conversion: an amount is shown as it was read.
CURRENCIES = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹",
              "CAD": "C$", "AUD": "A$"}


@router.get("/api/settings")
def settings_get():
    code = state._load("settings.json", {}).get("currency", "USD")
    if code not in CURRENCIES:
        code = "USD"
    return {"currency": code, "symbol": CURRENCIES[code],
            "currencies": [{"code": c, "symbol": v} for c, v in CURRENCIES.items()]}


@router.post("/api/settings")
async def settings_set(req: Request):
    body = await _json_obj(req)
    code = str(body.get("currency") or "").upper()
    if code not in CURRENCIES:
        raise HTTPException(400, "currency must be one of " + ", ".join(CURRENCIES))
    with state.file_lock("settings.json"):
        cur = state._load("settings.json", {})
        cur["currency"] = code
        state._save("settings.json", cur)
    return settings_get()


@router.get("/api/account/export")
def account_export():
    """Download everything the account holds (Tranche 1): the
    raw per-user stores as one JSON file. Photos are not embedded —
    their records and filenames are, and each original is served
    by its own route."""
    import json as _json
    from datetime import datetime, timezone
    from api import state
    out = {"exported_at": datetime.now(timezone.utc).isoformat(),
           "user": state._current_user.get()}
    for name in ("receipts.json", "dictionary.json", "flags.json",
                 "cart.json", "quest.json", "my_stores.json",
                 "eyes.json", "curator.json", "lists.json", "settings.json"):
        out[name[:-5]] = state._load(name, None)
    return Response(_json.dumps(out, indent=1),
                    media_type="application/json",
                    headers={"Content-Disposition":
                             "attachment; filename=arya-export.json"})


@router.post("/api/feedback")
async def feedback_submit(req: Request):
    body = await _json_obj(req)
    from api import feedback
    user = state._current_user.get()
    try:
        feedback.submit(user, body.get("kind", ""), body.get("text", ""))
    except PermissionError as e:
        raise HTTPException(429, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# --- push reminders (flag ARYA_PUSH_REMINDERS=1, off by default) -----------
def _push_guard(req):
    from api import reminders
    if not reminders.configured():
        raise HTTPException(404, "reminders are not turned on")
    return reminders


@router.get("/api/push/config")
def push_config(req: Request):
    from api import reminders
    if _is_demo(req):
        return {"enabled": False}
    return reminders.config()


@router.post("/api/push/subscribe")
async def push_subscribe(req: Request):
    r = _push_guard(req)
    body = await _json_obj(req)
    try:
        r.subscribe(body.get("subscription"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return r.config()


@router.post("/api/push/unsubscribe")
async def push_unsubscribe(req: Request):
    r = _push_guard(req)
    body = await _json_obj(req)
    r.unsubscribe(body.get("endpoint"))
    return r.config()


@router.post("/api/push/settings")
async def push_settings(req: Request):
    r = _push_guard(req)
    body = await _json_obj(req)
    try:
        r.set_notice_days(body.get("notice_days"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return r.config()


@router.post("/api/push/test")
def push_test(req: Request):
    r = _push_guard(req)
    if not r.config()["subscribed"]:
        raise HTTPException(400, "turn reminders on first")
    return {"sent": r.send(r.compose([], test=True))}


@router.get("/api/feedback")
def feedback_list():
    """Owner only: the first account reads what people sent."""
    from api import feedback
    if not feedback.is_owner(state._current_user.get()):
        raise HTTPException(403, "only the owner can read feedback")
    return {"notes": feedback.list_all()}
