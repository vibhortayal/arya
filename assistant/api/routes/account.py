"""Account-level routes: settings, data export, feedback and push reminders."""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from api import state
from api.demo_guard import _is_demo
from api.deps import _json_obj

router = APIRouter()


# ---- Account settings: currency and language. Currency (owner, 2026-10-29): it
# changes the symbol prices show with, nothing else. No exchange rates
# and no conversion: an amount is shown as it was read. Language
# ("auto" or a code) sets Ask Arya's reply language; it does not
# translate the app (assistant/docs/MULTILINGUAL-ASK.md).
LANGUAGES = {"auto": "Auto", "en": "English", "es": "Español", "hi": "हिन्दी"}
CURRENCIES = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹",
              "CAD": "C$", "AUD": "A$"}


# ---- First run (#153, #163). "onboarded" in settings.json says the
# account saw the welcome sheet (either choice sets it). An account
# that already holds anything (a list, an item, a receipt, a Quest
# session) counts as onboarded without the flag, so an existing
# account never sees the welcome. The demo household never does.
# "get_started" is set only when the welcome is answered by an empty
# account: Today then shows the three first steps until all three are
# done or the user closes the card ("get_started_dismissed").
def _has_data():
    from api import quest
    return bool(state.named_lists() or state.flags() or state.receipts()
                or quest._store()["sessions"])


def _get_started_steps():
    from api import expiry
    fl = state.flags()
    return {"list": bool(state.named_lists()) or any(f.get("manual") for f in fl.values()),
            "expiry": any(expiry.tracked(f) for f in fl.values()),
            "receipt": bool(state.receipts())}


def first_run(cur):
    """{"onboarded": bool, "get_started": None | {list, expiry, receipt}}."""
    if state._current_user.get() == state.DEMO_USER:
        return {"onboarded": True, "get_started": None}
    onboarded = bool(cur.get("onboarded")) or _has_data()
    gs = None
    if not onboarded:
        # Still new: Today shows the card behind the welcome sheet.
        gs = {"list": False, "expiry": False, "receipt": False}
    elif cur.get("get_started") and not cur.get("get_started_dismissed"):
        gs = _get_started_steps()
        if all(gs.values()):
            # All three done: the card goes for good.
            with state.file_lock("settings.json"):
                now = state._load("settings.json", {})
                now["get_started_dismissed"] = True
                state._save("settings.json", now)
            gs = None
    return {"onboarded": onboarded, "get_started": gs}


@router.get("/api/settings")
def settings_get():
    cur = state._load("settings.json", {})
    code = cur.get("currency", "USD")
    if code not in CURRENCIES:
        code = "USD"
    lang = cur.get("language", "auto")
    if lang not in LANGUAGES:
        lang = "auto"
    return {"currency": code, "symbol": CURRENCIES[code], "language": lang,
            "languages": [{"code": c, "name": n} for c, n in LANGUAGES.items()],
            "currencies": [{"code": c, "symbol": v} for c, v in CURRENCIES.items()],
            **first_run(cur)}


@router.post("/api/settings")
async def settings_set(req: Request):
    body = await _json_obj(req)
    code = str(body["currency"]).upper() if "currency" in body else None
    lang = str(body["language"]).lower() if "language" in body else None
    onboard = body.get("onboarded") is True
    dismiss = body.get("get_started_dismissed") is True
    if code is None and lang is None and not onboard and not dismiss:
        raise HTTPException(400, "send currency, language, onboarded or get_started_dismissed")
    if code is not None and code not in CURRENCIES:
        raise HTTPException(400, "currency must be one of " + ", ".join(CURRENCIES))
    if lang is not None and lang not in LANGUAGES:
        raise HTTPException(400, "language must be one of " + ", ".join(LANGUAGES))
    with state.file_lock("settings.json"):
        cur = state._load("settings.json", {})
        if code is not None:
            cur["currency"] = code
        if lang is not None:
            cur["language"] = lang
        if onboard and not cur.get("onboarded"):
            # Only an empty account gets the Get started card.
            cur["get_started"] = not _has_data()
            cur["onboarded"] = True
        if dismiss:
            cur["get_started_dismissed"] = True
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


@router.post("/api/demo/feedback")
async def demo_feedback_submit(req: Request):
    """The one demo write that reaches disk: a note from the end of the
    demo. Demo sessions only; per-IP cap, length caps, a honeypot field,
    and a day-wide cap (api/feedback.py). No model call."""
    from api import demo_guard, feedback
    from api.deps import _client_ip
    if not _is_demo(req):
        raise HTTPException(403, "this door is for the demo")
    body = await _json_obj(req)
    if body.get("website"):   # honeypot: a person never fills this
        return {"ok": True}
    # Backstop only: a shared network gets 10 an hour, a script gets stopped.
    if not demo_guard._demo_rate(demo_guard._demo_feedback_hits, _client_ip(req),
                                 "ARYA_DEMO_FEEDBACK_IP_RATE", 10):
        raise HTTPException(429, "that is enough for now, thank you")
    try:
        feedback.submit_demo(body.get("text", ""), body.get("email", ""))
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
