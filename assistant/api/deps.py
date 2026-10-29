"""Shared plumbing for the API: the cost ledger and budget guard, the
rate-limit buckets, request-body helpers, the session cookie, and the
one place a Meta client is built.

Routes build their client with new_client() and read the ledger path
from this module at call time, so a test can swap deps.MetaClient or
deps._LEDGER and every router sees it."""
import os

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
    if spent >= cap:
        raise HTTPException(503, "daily model budget reached — Arya pauses paid reads until tomorrow")


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
    return CostLedger(_LEDGER, bucket="app")


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


def _registration_open():
    """New-account creation is locked by default (owner locked it
    2026-10-28, reversing the same-day open). The operator reopens it
    by setting ARYA_REGISTRATION_OPEN=1 in the service environment —
    no code change. Existing accounts and the demo are unaffected."""
    return os.environ.get("ARYA_REGISTRATION_OPEN") == "1"


def new_client():
    """A Meta client that books its spend on this request's ledger."""
    return MetaClient(ledger=_ledger())


_PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def _d_today():
    from datetime import date as _date
    return _date.fromisoformat(state.today_ref())
