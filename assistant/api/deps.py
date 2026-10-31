"""Shared plumbing for the API: the cost ledger and budget guard, the
rate-limit buckets, request-body helpers, the session cookie, and the
one place a Meta client is built.

Routes build their client with new_client() and read the ledger path
from this module at call time, so a test can swap deps.MetaClient or
deps._LEDGER and every router sees it."""
import json
import os
import time

from fastapi import HTTPException

from api import state
from api.cost_ledger import CostLedger
from api.meta_client import MetaClient
from api import auth

# The cost ledger is an operator artifact: it lives in the data root so it
# survives container redeploys (the app layer is ephemeral; /app/data is not).
_LEDGER = os.path.join(os.environ.get(
    "ARYA_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data")),
    "cost-ledger.jsonl")

RATE_BUCKET_MAX = 10_000


def _prune(bucket, window):
    """Per-IP hit lists live in memory. Once a bucket holds many IPs,
    drop the ones with no hit inside the window, so a scan from many
    addresses cannot grow it without bound (codebase map 2026-10-29)."""
    if len(bucket) <= RATE_BUCKET_MAX:
        return
    import time as _t
    now = _t.time()
    for ip in [ip for ip, hits in bucket.items()
               if not hits or now - hits[-1] >= window]:
        bucket.pop(ip, None)


_login_fails = {}
_register_hits = {}
_code_hits = {}
_verify_hits = {}
_waitlist_hits = {}


def _client_ip(req):
    """The client address for rate limiting. The app sits behind
    one proxy hop (Caddy), which APPENDS the address it saw to
    X-Forwarded-For — so the LAST entry is the trustworthy one and
    the first entries are client-supplied and spoofable. Keying a
    limiter on the first entry lets an attacker reset their bucket
    at will (review 2026-10-28, M5). No header: the peer address."""
    parts = [p.strip() for p in
             (req.headers.get("x-forwarded-for") or "").split(",")
             if p.strip()]
    if parts:
        return parts[-1]
    return req.client.host if req.client else "?"


def _budget_guard(demo=False):
    """Stage 6 hardening: a daily ceiling on model spend (default $10),
    far above real household use, bounding any single bad day. The
    demo household has its own smaller bucket (default $2): a crowd
    of judges can exhaust the demo's day, never the real accounts'
    (review 2026-10-28, H4)."""
    if demo or state.in_sandbox():
        box = state._overlay.get()
        share = float(os.environ.get("ARYA_DEMO_SESSION_BUDGET_USD", "0.40"))
        if box is not None and box.get(_DEMO_SPENT_KEY, 0.0) >= share:
            raise HTTPException(503, "You've used this demo visit's live reads. "
                                "Everything else still works; sign in with a real "
                                "account for more.")
        cap = float(os.environ.get("ARYA_DEMO_DAILY_BUDGET_USD", "2"))
        spent = CostLedger(_LEDGER).spent_today("demo")
        if spent >= cap:
            raise HTTPException(503, "The demo's live reads are paused for today. "
                                "Everything else still works.")
    else:
        cap = float(os.environ.get("ARYA_DAILY_BUDGET_USD", "10"))
        spent = CostLedger(_LEDGER).spent_today("app")
        user = state._owner()
        if user and not _is_owner(user):
            reason = reading_off(user)
            if reason:
                raise HTTPException(429, reason)
    if spent >= cap:
        raise HTTPException(503, "daily model budget reached — Arya pauses paid reads until tomorrow")


def user_limits():
    """(heavy, ceiling) in dollars a month for one real account.
    Heavy only shows a heads-up on the usage screen; the ceiling pauses
    paid reads until the 1st. Both are far above a typical user (about
    15 cents) and 0 turns one off. The owner is never limited."""
    def env(name, default):
        try:
            return max(0.0, float(os.environ.get(name, default)))
        except ValueError:
            return float(default)
    return env("ARYA_USER_HEAVY_MONTHLY_USD", "3"), env("ARYA_USER_MONTHLY_CEILING_USD", "5")


def _hourly_limit():
    try:
        return max(0.0, float(os.environ.get("ARYA_USER_HOURLY_FREEZE_USD", "1")))
    except ValueError:
        return 1.0


def _freeze_path():
    return os.path.join(state.base_dir(), "frozen-accounts.json")


def _freezes():
    try:
        with open(_freeze_path()) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return {}
    return doc if isinstance(doc, dict) else {}


def frozen_until(user):
    """When this account's paid reads come back (epoch seconds), or 0."""
    until = _freezes().get(user, {}).get("until", 0)
    return until if isinstance(until, (int, float)) and until > time.time() else 0


def freeze(user, usd_hour):
    """Switch an account's paid reads off for ARYA_USER_FREEZE_HOURS
    (default 24). Only paid reads: sign-in, lists and Today stay up."""
    try:
        hours = max(1.0, float(os.environ.get("ARYA_USER_FREEZE_HOURS", "24")))
    except ValueError:
        hours = 24.0
    doc = _freezes()
    doc[user] = {"at": int(time.time()), "until": int(time.time() + hours * 3600),
                 "usd_hour": round(usd_hour, 2)}
    state.write_json_atomic(_freeze_path(), doc)


def unfreeze(user):
    doc = _freezes()
    if doc.pop(user, None) is not None:
        state.write_json_atomic(_freeze_path(), doc)


def reading_off(user, act=True):
    """Why this real account may not make paid calls now, or "".
    Monthly ceiling: until the 1st. Hourly trip-wire: freezes the
    account's paid reads (the owner can lift it at once). act=False
    only asks, so a read-only screen never freezes anyone."""
    if frozen_until(user):
        return ("Arya's reading is switched off for this account after unusual use. "
                "It comes back on its own, or write to support@teamnightshift.org.")
    use = CostLedger(_LEDGER).usage(user)
    ceiling = user_limits()[1]
    if ceiling and use["month_usd"] >= ceiling:
        return "Arya's reading is paused for you until the 1st. Lists, Today and typing still work."
    hourly = _hourly_limit()
    if hourly and use["hour_usd"] >= hourly:
        if act:
            freeze(user, use["hour_usd"])
        return ("Arya's reading is switched off for this account after unusual use. "
                "It comes back on its own, or write to support@teamnightshift.org.")
    return ""


# Spend a demo visit has caused, kept in that visitor's in-memory sandbox
# (not in the storage layer), so one visitor cannot drain the day's
# demo bucket (review 2026-10-28, item 1).
_DEMO_SPENT_KEY = "__demo_spent_usd"


class _SessionLedger(CostLedger):
    def record(self, *a, **k):
        row = super().record(*a, **k)
        box = state._overlay.get()
        if box is not None:
            box[_DEMO_SPENT_KEY] = box.get(_DEMO_SPENT_KEY, 0.0) + row["cost_usd"]
        return row


def _ledger():
    """The cost ledger for this request: demo sandbox calls spend from
    the demo bucket (and count against the visit's own share),
    everything else from the app bucket."""
    if state.in_sandbox():
        return _SessionLedger(_LEDGER, bucket="demo")
    return CostLedger(_LEDGER, bucket="app", user=state._owner())


async def _json_body(req):
    """Parse a request body as JSON. Malformed JSON is a client
    error (400), never a 500 (review 2026-10-28, M6)."""
    try:
        return await req.json()
    except Exception:
        raise HTTPException(400, "request body must be valid JSON")


async def _json_obj(req):
    """_json_body, plus the shape the JSON routes expect: an
    object. An array or scalar body is a 400, not an
    AttributeError 500 downstream."""
    body = await _json_body(req)
    if not isinstance(body, dict):
        raise HTTPException(400, "request body must be a JSON object")
    return body


def _int_field(body, key, default=None):
    """Coerce an integer body field; a non-numeric value is a
    client error (400), not a ValueError 500."""
    try:
        return int(body.get(key, default))
    except (TypeError, ValueError):
        raise HTTPException(400, f"{key} must be an integer")


def _set_session_cookie(resp, token):
    resp.set_cookie(auth.COOKIE, token, httponly=True, samesite="lax",
                    secure=os.environ.get("ARYA_INSECURE_COOKIE") != "1",
                    max_age=auth.SESSION_TTL)
    return resp


def _site_path():
    return os.path.join(state.base_dir(), "site.json")


def _registration_override():
    """The owner's in-app toggle, once it has been set: True or
    False. None means never toggled — the environment decides."""
    try:
        with open(_site_path()) as fh:
            v = json.load(fh).get("registration_open")
    except (OSError, ValueError):
        return None
    return v if isinstance(v, bool) else None


def _registration_open():
    """New-account creation is locked by default (owner locked it
    2026-10-28, reversing the same-day open). The environment flag
    ARYA_REGISTRATION_OPEN is the bootstrap default; the owner's
    in-app toggle (POST /auth/registration, owner only) overrides
    it once set, and the override survives redeploys in the data
    root. Existing accounts and the demo are unaffected."""
    override = _registration_override()
    if override is not None:
        return override
    return os.environ.get("ARYA_REGISTRATION_OPEN") == "1"


def _set_registration_open(open_):
    path = _site_path()
    doc = {}
    if os.path.exists(path):
        try:
            with open(path) as fh:
                doc = json.load(fh)
        except ValueError:
            doc = {}
    if not isinstance(doc, dict):
        doc = {}
    doc["registration_open"] = bool(open_)
    state.write_json_atomic(path, doc)
    return doc["registration_open"]


def _is_owner(user):
    """The site owner is whoever the operator names in
    ARYA_OWNER_USERNAME. Unset means nobody is owner, so the
    registration toggle stays unreachable (fail closed)."""
    owner = (os.environ.get("ARYA_OWNER_USERNAME") or "").strip().lower()
    return bool(owner) and (user or "").strip().lower() == owner


def _is_waitlist_admin(user):
    """Who may approve people from the waitlist: the accounts listed in
    ARYA_WAITLIST_ADMINS (comma separated; usernames or the email an
    account is named after, so a Google-only account can be one). Unset
    means nobody (fail closed). Separate from ARYA_OWNER_USERNAME on
    purpose (owner, 2026-10-30)."""
    names = {n.strip().lower() for n in (os.environ.get("ARYA_WAITLIST_ADMINS") or "").split(",")}
    names.discard("")
    return (user or "").strip().lower() in names


def new_client():
    """A Meta client that books its spend on this request's ledger."""
    return MetaClient(ledger=_ledger())


_PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def _d_today():
    from datetime import date as _date
    return _date.fromisoformat(state.today_ref())
