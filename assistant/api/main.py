"""Arya API — FastAPI entry point.
All Meta calls go through api.meta_client; all money math is code.

Event-loop rule (review 2026-10-28, H1): MetaClient is blocking
urllib with timeouts up to 120 s, so no route may call a model —
or judge_pending, which calls the judge — on the event loop.
Model work runs through run_in_threadpool; a slow photo read then
stalls one worker thread, never every other request."""
import datetime, hashlib, json, logging, math, os
from collections import OrderedDict
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from api import state, auth, supabase_auth
from api.decode.service import decode_order_text, decode_photo, decode_text, extract_pdf_text, normalize_costco_json
from api.meta_client import MetaClient
from api.cost_ledger import CostLedger
from api.cart.build import approve

app = FastAPI(title="Arya API")
_log = logging.getLogger("arya.api")


@app.exception_handler(RuntimeError)
async def _model_failure(request, exc):
    """MetaClient and parse_json raise RuntimeError when a model call
    fails or its answer cannot be read. Routes that do not catch it
    answer 502 with a plain sentence instead of a bare 500 (codebase
    map 2026-10-29). The traceback still goes to the log."""
    _log.exception("unhandled RuntimeError on %s", request.url.path,
                   exc_info=exc)
    return JSONResponse({"detail": "Arya could not finish that read. Try again."},
                        status_code=502)
from api import pack as pack_api; app.include_router(pack_api.router)  # noqa: E402,E702
# The cost ledger is an operator artifact: it lives in the data root so it
# survives container redeploys (the app layer is ephemeral; /app/data is not).
_LEDGER = os.path.join(os.environ.get(
    "ARYA_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data")),
    "cost-ledger.jsonl")

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


# Per-IP sliding-window caps on the demo's unauthenticated surface:
# session minting and the live doors. Generous for a human judge,
# a hard stop for a script (review 2026-10-28, H4).
_demo_auth_hits = {}
_demo_door_hits = {}


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


def _demo_rate(bucket, key, limit_env, default):
    import time as _t
    limit = int(os.environ.get(limit_env, str(default)))
    now = _t.time()
    _prune(bucket, 3600)
    hits = [t for t in bucket.get(key, []) if now - t < 3600]
    if len(hits) >= limit:
        return False
    bucket[key] = hits + [now]
    return True

# The demo household is a sandbox (review 2026-10-28): a judge can play
# the whole loop — list, hunt in every mode and view, receipt finish,
# Ask — and every write lands in an in-memory overlay for that visitor
# alone (state.set_overlay). Nothing a demo visitor does reaches disk,
# the shipped household, or another visitor; the overlay is dropped
# when the session ages out of the LRU below. Routes that write
# outside the state layer, or only exist to run batch model jobs,
# stay closed to the demo.
_DEMO_CLOSED = ("/import", "/decode/pdf", "/decode/text", "/eyes/photo",
                "/api/curator/run", "/api/judge/run", "/api/review/suggest",
                "/api/intake/", "/api/quest/avatar/generate",
                "/api/quest/avatar/photo", "/api/feedback", "/api/push/")
# Doors that can call the Meta API: the per-IP live-door cap applies.
_DEMO_LIVE_DOORS = ("/decode/photo", "/api/transcribe",
                    "/api/list/from-photo", "/api/list/from-text",
                    "/api/expiry/read",
                    "/api/quest/scan-shelf", "/api/quest/locate",
                    "/api/quest/share-look",
                    "/api/chat", "/api/quest/sessions", "/api/quest/shopoff",
                    "/api/storemap")
# The haul writes (fix, hide, post, second receipt) sit under the
# sessions prefix but never call a model, so they spend no door budget.
_DEMO_FREE_DOORS = ("/api/quest/sessions/",)


def _demo_live_door(path):
    if not path.startswith(_DEMO_LIVE_DOORS):
        return False
    return not (path.startswith(_DEMO_FREE_DOORS) and "/haul/" in path)


DEMO_SANDBOXES_MAX = 500
_demo_sandboxes = OrderedDict()   # session cookie -> overlay dict


def _demo_sandbox(token):
    box = _demo_sandboxes.get(token)
    if box is None:
        box = _demo_sandboxes[token] = {}
        while len(_demo_sandboxes) > DEMO_SANDBOXES_MAX:
            _demo_sandboxes.popitem(last=False)
    else:
        _demo_sandboxes.move_to_end(token)
    return box


@app.middleware("http")
async def require_login(request, call_next):
    path = request.url.path
    protected = path.startswith(("/api/", "/import", "/decode", "/eyes"))
    state.set_overlay(None)
    if protected:
        info = None
        authz = request.headers.get("authorization", "")
        if authz.startswith("Bearer "):
            user = auth.api_token_user(authz[7:])
            if user:
                info = {"user": user, "demo": False}
        cookie = request.cookies.get(auth.COOKIE)
        if not info:
            info = auth.session_info(cookie)
        if not info:
            return JSONResponse({"detail": "login required"}, status_code=401)
        if info["demo"]:
            if request.method != "GET":
                if path.startswith(_DEMO_CLOSED):
                    return JSONResponse(
                        {"detail": "this needs a real account — the demo household keeps nothing"},
                        status_code=403)
                if _demo_live_door(path) and not _demo_rate(
                        _demo_door_hits, _client_ip(request),
                        "ARYA_DEMO_DOOR_RATE", 240):
                    return JSONResponse(
                        {"detail": "demo rate limit — try again in a bit"},
                        status_code=429)
            state.set_overlay(_demo_sandbox(cookie))
        state.set_current_user(info["user"])
    return await call_next(request)


def _is_demo(req):
    """Demo sessions ride the cookie; connector tokens are never demo
    (minting one requires a real account). Sessions live in the root
    store, so read them with the per-user context cleared — the
    middleware has already set it by the time a route runs."""
    tok = state._current_user.set(None)
    try:
        info = auth.session_info(req.cookies.get(auth.COOKIE))
    finally:
        state._current_user.reset(tok)
    return bool(info and info["demo"])


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


@app.get("/auth/status")
def auth_status():
    return {"has_users": len(auth.users()) > 0,
            "registration_open": _registration_open(),
            "email_signin": supabase_auth.configured()}


@app.post("/auth/setup")
async def auth_setup(req: Request):
    if len(auth.users()) > 0:
        raise HTTPException(403, "setup is closed; an account already exists")
    body = await _json_obj(req)
    try:
        name = auth.create_user(body.get("username", ""), body.get("password", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _set_session_cookie(JSONResponse({"user": name}), auth.new_session(name))


@app.post("/auth/register")
async def auth_register(req: Request):
    """Public sign-up — LOCKED unless the operator opens it
    (ARYA_REGISTRATION_OPEN=1; owner locked registration 2026-10-28).
    Same account shape as setup; setup stays bootstrap-only. A per-IP
    cap keeps account farming slow, and the password floor is
    enforced here so the operator path (create_user) keeps its own
    rules."""
    if not _registration_open():
        raise HTTPException(403, "registration is closed")
    import time as _t
    ip = _client_ip(req)
    _prune(_register_hits, 900)
    hits = [t for t in _register_hits.get(ip, []) if _t.time() - t < 900]
    if len(hits) >= 10:
        raise HTTPException(429, "too many account creations — try again later")
    _register_hits[ip] = hits + [_t.time()]
    body = await _json_obj(req)
    password = body.get("password", "")
    if len(password) < 8:
        raise HTTPException(400, "password must be at least 8 characters")
    try:
        name = auth.create_user(body.get("username", ""), password)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _set_session_cookie(JSONResponse({"user": name}), auth.new_session(name))


@app.post("/auth/login")
async def auth_login(req: Request):
    import time as _t
    ip = _client_ip(req)
    _prune(_login_fails, 900)
    fails = [t for t in _login_fails.get(ip, []) if _t.time() - t < 900]
    if len(fails) >= 8:
        raise HTTPException(429, "too many sign-in attempts — wait 15 minutes")
    body = await _json_obj(req)
    name = auth.resolve_login_name(body.get("username"))
    if not auth.verify(name, body.get("password", "")):
        _login_fails[ip] = fails + [_t.time()]
        raise HTTPException(401, "wrong email or password")
    return _set_session_cookie(JSONResponse({"user": name}), auth.new_session(name))


def _federated_login(email):
    """Sign in (or create) the account for a Supabase-verified email.
    ARYA_SUPABASE_SIGNUP=0 limits it to accounts that already exist."""
    try:
        name, created = auth.ensure_federated_user(email) \
            if os.environ.get("ARYA_SUPABASE_SIGNUP") != "0" or email in auth.users() \
            else (None, False)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not name:
        raise HTTPException(403, "sign-up is closed")
    return _set_session_cookie(JSONResponse({"user": name, "created": created}),
                               auth.new_session(name))


def _email_guard(req, bucket, limit):
    import time as _t
    ip = _client_ip(req)
    _prune(bucket, 900)
    hits = [t for t in bucket.get(ip, []) if _t.time() - t < 900]
    if len(hits) >= limit:
        raise HTTPException(429, "too many attempts, try again in 15 minutes")
    bucket[ip] = hits + [_t.time()]


def _need_supabase():
    if not supabase_auth.configured():
        raise HTTPException(404, "email sign-in is not set up")


@app.post("/auth/email/start")
async def auth_email_start(req: Request):
    _need_supabase()
    _email_guard(req, _code_hits, 5)
    body = await _json_obj(req)
    email = (body.get("email") or "").strip().lower()
    if "@" not in email or len(email) > 254:
        raise HTTPException(400, "enter a valid email")
    try:
        await run_in_threadpool(supabase_auth.send_code, email)
    except supabase_auth.AuthError as e:
        raise HTTPException(502, str(e))
    return {"ok": True}


@app.post("/auth/email/verify")
async def auth_email_verify(req: Request):
    _need_supabase()
    _email_guard(req, _verify_hits, 10)
    body = await _json_obj(req)
    email = (body.get("email") or "").strip().lower()
    code = str(body.get("code") or "").strip()
    try:
        verified = await run_in_threadpool(supabase_auth.verify_code, email, code)
    except supabase_auth.AuthError as e:
        raise HTTPException(401, str(e))
    return _federated_login(verified)


@app.get("/auth/google")
def auth_google(req: Request):
    _need_supabase()
    return RedirectResponse(supabase_auth.google_url(
        str(req.base_url).rstrip("/") + "/auth/callback"))


@app.get("/auth/callback")
def auth_callback():
    """Supabase returns the token in the URL fragment, which only the
    browser can read. This page hands it to /auth/supabase and goes home."""
    return HTMLResponse(
        "<!doctype html><meta charset=utf-8><title>Signing in</title>"
        "<p>Signing you in...</p><script src=\"/auth-callback.js\"></script>")


@app.post("/auth/supabase")
async def auth_supabase(req: Request):
    _need_supabase()
    _email_guard(req, _verify_hits, 10)
    body = await _json_obj(req)
    try:
        verified = await run_in_threadpool(
            supabase_auth.email_for_token, str(body.get("access_token") or ""))
    except supabase_auth.AuthError as e:
        raise HTTPException(401, str(e))
    return _federated_login(verified)


@app.post("/auth/logout")
async def auth_logout(req: Request):
    auth.drop_session(req.cookies.get(auth.COOKIE))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


@app.post("/auth/account/delete")
async def auth_delete_account(req: Request):
    """Erase the caller's account (Tranche 1, register #2):
    password-confirmed, then the record, sessions, tokens, data
    directory, friend mirrors in other accounts, and feedback
    attribution all go. The registry lives in the data root, so
    reads and writes run with the per-user context cleared (the
    feedback._root_call idiom)."""
    body = await _json_obj(req)
    from api import auth, feedback, social, state
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info or info["demo"]:
        raise HTTPException(403, "the demo household has no account to delete")
    user = info["user"]

    def _root_call(fn):
        tok = state._current_user.set(None)
        try:
            return fn()
        finally:
            state._current_user.reset(tok)

    everyone = _root_call(lambda: list(auth.users()))
    if not _root_call(lambda: auth.verify(user, body.get("password", ""))):
        raise HTTPException(401, "that password does not match this account")
    social.scrub_handle(user.split("@")[0], everyone, skip=user)
    _root_call(lambda: auth.delete_user(user))
    feedback.anonymize_user(user)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


@app.get("/auth/me")
def auth_me(req: Request):
    # Signed-out is a normal state, not an error (review
    # 2026-10-28, U5): the boot probe reads user=None and shows
    # the sign-in screen, with no 401 noise in the console.
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info:
        return {"user": None, "demo": False}
    return info


@app.post("/auth/token")
def mint_token(req: Request):
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info or info["demo"]:
        raise HTTPException(401, "sign in with your account to create a connector token")
    return {"token": auth.new_api_token(info["user"]),
            "note": "Shown once. Creating a new token replaces the old one."}


@app.get("/auth/token")
def token_status(req: Request):
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info or info["demo"]:
        raise HTTPException(401, "login required")
    return {"has_token": auth.has_api_token(info["user"])}


@app.delete("/auth/token")
def revoke_token(req: Request):
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info or info["demo"]:
        raise HTTPException(401, "login required")
    auth.revoke_api_tokens(info["user"])
    return {"ok": True, "has_token": False}


@app.post("/auth/demo")
def auth_demo(req: Request):
    if not _demo_rate(_demo_auth_hits, _client_ip(req),
                      "ARYA_DEMO_AUTH_RATE", 120):
        raise HTTPException(429, "too many demo sessions — try again in a bit")
    return _set_session_cookie(JSONResponse({"user": "demo", "demo": True}),
                               auth.new_session("demo", demo=True))


@app.get("/health")
def health():
    # No receipt count: /health runs with no account, so it counted the
    # root plane, which holds none (review M11). Liveness only.
    return {"status": "ok", "service": "arya-api", "stage": 3}


@app.post("/import/costco-json")
async def import_costco_json(req: Request):
    obj = await _json_body(req)
    if not isinstance(obj, dict) or "itemArray" not in obj:
        raise HTTPException(422, "not a Costco warehouse receipt object")
    dec = normalize_costco_json(obj)
    state.add_receipts([dec])
    await run_in_threadpool(state.judge_pending, MetaClient(ledger=_ledger()))
    return dec


@app.post("/import/costco-json-bulk")
async def import_bulk(req: Request):
    objs = await _json_body(req)
    if not isinstance(objs, list):
        raise HTTPException(422, "expected a list of Costco receipt objects")
    decs = [normalize_costco_json(o) for o in objs if isinstance(o, dict) and "itemArray" in o]
    added = state.add_receipts(decs)
    await run_in_threadpool(state.judge_pending, MetaClient(ledger=_ledger()))
    return {"received": len(decs), "added": added, "total_receipts": len(state.receipts())}


@app.post("/decode/text")
async def decode_text_route(req: Request):
    body = await _json_obj(req)
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    client = MetaClient(ledger=_ledger())
    dec = await run_in_threadpool(decode_text, body.get("text", ""), client)
    state.add_receipts([dec])
    await run_in_threadpool(state.judge_pending, MetaClient(ledger=_ledger()))
    return dec


def _need_receipt_date(receipt):
    """state.add_receipts refuses a receipt with no date, so say so
    here instead of answering "added" with an id that was never
    filed (a hunt finish then failed with "no such receipt")."""
    if not receipt.get("purchased_at"):
        raise HTTPException(422, "could not read the date on this receipt — "
                            "retake the photo with the date in view")


@app.post("/api/intake/order-text")
async def intake_order_text(req: Request):
    """A pasted online order (Instacart, Amazon Fresh, ...) becomes a
    receipt through the same verify-and-queue path as a photo."""
    body = await _json_obj(req)
    text = body.get("text", "")
    if len(text.strip()) < 20:
        raise HTTPException(422, "paste the order confirmation text")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    client = MetaClient(ledger=_ledger())
    dec = await run_in_threadpool(decode_order_text, text, client)
    _need_receipt_date(dec)
    state.add_receipts([dec])
    await run_in_threadpool(state.judge_pending, MetaClient(ledger=_ledger()))
    return {"receipt_id": dec["receipt_id"], "merchant": dec["merchant"],
            "purchased_at": dec["purchased_at"], "lines": len(dec["lines"]),
            "total": dec["total"], "totals_reconcile": dec["totals_reconcile"]}


@app.post("/api/intake/structured")
async def intake_structured(req: Request):
    """A receipt already read by the user's own Muse. Arya spends no
    tokens on perception here: it verifies the arithmetic, assigns line
    statuses by confidence, and queues what does not verify — the client
    proposes, Arya disposes."""
    body = await _json_body(req)
    if not isinstance(body, dict) or not body.get("merchant") \
            or not body.get("purchased_at") \
            or not isinstance(body.get("lines"), list) or not body["lines"]:
        raise HTTPException(422, "a structured receipt needs merchant, purchased_at, and lines")
    from api.decode.service import _finish
    lines = []
    for ln in body["lines"]:
        if not isinstance(ln, dict) or not ln.get("decoded_name") \
                or not isinstance(ln.get("line_total"), (int, float)):
            raise HTTPException(422, "every line needs decoded_name and a numeric line_total")
        lt = ln.get("line_type") or "item"
        lines.append({
            "raw": ln.get("raw") or ln["decoded_name"],
            "decoded_name": ln["decoded_name"],
            "qty": ln.get("qty") if isinstance(ln.get("qty"), (int, float)) else 1,
            "unit_price": ln.get("unit_price"),
            "line_total": float(ln["line_total"]),
            "line_type": lt if lt in ("item", "discount", "return") else "item",
            "sku": ln.get("sku"), "discount_parent_sku": ln.get("discount_parent_sku"),
            "confidence": ln.get("confidence") if isinstance(ln.get("confidence"), (int, float)) else 0.5,
            "alternatives": []})
    lines, reconcile = _finish(lines, body.get("subtotal"))
    rid = body.get("receipt_id")
    if not isinstance(rid, str) or not rid:
        import hashlib as _h
        rid = "ext-" + _h.sha1(json.dumps(body, sort_keys=True).encode()).hexdigest()[:10]
    dec = {"receipt_id": rid, "source_type": "muse",
           "merchant": body["merchant"], "purchased_at": body["purchased_at"],
           "lines": lines, "subtotal": body.get("subtotal"),
           "tax": body.get("tax"), "total": body.get("total"),
           "totals_reconcile": reconcile, "image_ref": None}
    added = state.add_receipts([dec])
    await run_in_threadpool(state.judge_pending, MetaClient(ledger=_ledger()))
    # The ledger counts a line only when it has a sku, so a line
    # without one is kept on the receipt but never reaches patterns,
    # running low or spend. Say so instead of returning a clean success.
    no_sku = [l["decoded_name"] for l in lines
              if l["line_type"] != "discount" and not l.get("sku")]
    out = {"receipt_id": rid, "merchant": dec["merchant"], "added": added,
           "lines": len(lines), "totals_reconcile": reconcile,
           "unverified": sum(1 for l in lines if l["status"] != "auto")}
    if no_sku:
        out["no_sku"] = no_sku
        out["warning"] = (f"{len(no_sku)} line(s) have no sku, so they are saved "
                          "but not counted toward patterns or running low.")
    return out


@app.post("/api/review/suggest")
async def review_suggest(req: Request):
    """Researched candidates for an unresolved item, posted by the
    user's Muse (the Resolver loop). Candidates carry their source;
    settling still takes the user's word."""
    body = await _json_obj(req)
    if body.get("receipt_id"):
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(422, "a line suggestion needs a name")
        if not state.suggest_line(body["receipt_id"],
                                  _int_field(body, "idx", -1),
                                  name, body.get("source", "")):
            raise HTTPException(404, "no unverified line with that id")
        return {"ok": True, "name": name}
    cands = body.get("candidates") or []
    clean = [{"name": c["name"], "source": c.get("source", "")}
             for c in cands if isinstance(c, dict) and c.get("name")]
    if not clean:
        raise HTTPException(422, "candidates need at least one name")
    if not state.suggest_resolution(body.get("item_id", ""), clean):
        raise HTTPException(404, "no unresolved item with that id")
    return {"ok": True, "candidates": [c["name"] for c in clean]}


@app.post("/api/curator/run")
def curator_run():
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    from api.curator import run_curator
    n = run_curator(MetaClient(ledger=_ledger()))
    return {"proposals": n}


@app.get("/api/curator")
def curator_pending():
    from api.curator import pending
    return {"proposals": pending()}


@app.post("/api/curator/decide")
async def curator_decide(req: Request):
    body = await _json_obj(req)
    from api.curator import decide
    try:
        p = decide(body.get("id", ""), body.get("action", ""))
    except KeyError:
        raise HTTPException(404, "unknown or settled proposal")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"id": p["id"], "status": p["status"]}


def _d_today():
    from datetime import date as _date
    return _date.fromisoformat(state.today_ref())


@app.get("/api/home")
def home():
    d = state.derived()
    nm = state.names()
    from api.eyes.service import prior_days
    seen = [{"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
             "date": p["seen"]["date"], "kind": p["seen"].get("kind")}
            for p in d["patterns"] if p.get("seen")]
    checks = []
    _fl = state.flags()
    _MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    for p in d["patterns"]:
        prior = prior_days(nm.get(p["item_id"], ""))
        if prior and p.get("last_bought") and not p["due"]:
            if _fl.get(p["item_id"], {}).get("check_ok") == state.as_of():
                continue  # the user already answered this cycle
            if _fl.get(p["item_id"], {}).get("use_by"):
                continue  # a real printed date beats the usual-shelf-life guess
            from datetime import date as _d
            age = (_d.fromisoformat(state.today_ref()) - _d.fromisoformat(p["last_bought"])).days
            if age >= prior:
                _lb = p["last_bought"]
                checks.append({"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
                               "text": f"{nm.get(p['item_id'], p['item_id'])} from {_MON[int(_lb[5:7]) - 1]} {int(_lb[8:10])} usually turns about now — still good?"})
    low = [{"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
            "judge_reason": (p.get("judge") or {}).get("reason", ""),
            "due_window": p["due_window"], "reason": p["due_reason"] if "due_reason" in p else
            f"every ~{p['median_interval_days']:.0f} days; last bought {p['days_since_last']} days ago"}
           for p in state.running_low(d)]
    # Store affinity for the list ships with this payload: the List
    # view used to make one /api/items/{id} call per list item just
    # for these keys (review 2026-10-28, M9). Same aggregation as
    # state.item_detail, computed once over the derived entries.
    gm = state.group_map()
    pbs = {}
    for item in d["smart_list"]["items"]:
        iid = gm.get(item["item_id"], item["item_id"])
        prices = {}
        for e in d["entries"]:
            if e["item_id"] == iid and e["event_type"] == "purchase":
                prices.setdefault(e["store_id"], []).append(e["price"])
        if prices:
            pbs[item["item_id"]] = {
                s: {"min": min(v), "median": sorted(v)[len(v) // 2],
                    "max": max(v), "count": len(v)}
                for s, v in prices.items()}
    from api import expiry
    last_bought = {p["item_id"]: p.get("last_bought") for p in d["patterns"]}
    use_soon = expiry.use_soon(_fl, nm, last_bought, _d_today())
    return {"as_of": state.as_of(), "running_low": low,
            "list": d["smart_list"], "lists": state.named_lists(),
            "cart": state.get_cart(), "seen": seen, "checks": checks, "price_by_store": pbs,
            "use_soon": use_soon}


@app.get("/api/quest/plan")
def quest_plan():
    """Plan a hunt (owner, 2026-10-28: "i pick my store. then i should
    be able to move things from my list to my quest… my milk is
    typically bought from TJ, eggs from costco"). Where each known
    item has been bought, counted from the receipts, plus the Arya
    list. The client sorts the list for the picked store: usually
    here, new, usually elsewhere, and suggests usuals for that store
    that are not on the list yet. Counting only — no model call."""
    d = state.derived()
    nm = state.names()
    gm = state.group_map()
    stores = {}
    for e in d["entries"]:
        if e["event_type"] != "purchase" or not e.get("store_id"):
            continue
        iid = gm.get(e["item_id"], e["item_id"])
        by = stores.setdefault(iid, {})
        by[e["store_id"]] = by.get(e["store_id"], 0) + 1
    pats = {p["item_id"]: p for p in d["patterns"]}
    items = []
    for iid, by in stores.items():
        p = pats.get(iid) or {}
        items.append({"item_id": iid, "name": nm.get(iid, iid), "stores": by,
                      "every_days": p.get("median_interval_days"),
                      "days_since": p.get("days_since_last"),
                      "due": bool(p.get("due"))})
    # A hand-typed row ("milk", "eggs") has no history of its own;
    # the same dictionary match the Check step uses finds the product
    # it means, so its stores and cadence read from that product's
    # receipts (QA 2026-10-28). history_id is that match; item_id
    # stays the list row's own id for removal.
    from api import quest as _quest
    lst = []
    for i in d["smart_list"]["items"]:
        if i.get("checked"):
            continue
        iid = i.get("item_id")
        name = i.get("name") or nm.get(iid, "")
        hid = gm.get(iid, iid)
        if hid not in stores:
            hid = _quest.resolve_group(name) or hid
        lst.append({"item_id": iid, "history_id": hid, "name": name,
                    "qty": i.get("qty") or 1, "unit": i.get("unit") or "",
                    "list": i.get("list"), "on_list": bool(i.get("on_list"))})
    return pack_api.enrich_plan({"list": lst, "items": items}, d)


@app.get("/api/dashboard")
def dashboard_route():
    return state.dashboard()


@app.get("/api/review")
def review_route():
    return state.review_queue()


@app.get("/api/items/{item_id}")
def item_route(item_id: str):
    detail = state.item_detail(item_id)
    if detail["entry"] is None and detail["pattern"] is None:
        # A typed item has no receipts yet: show its page with the name
        # it was typed as, instead of a 404 (first-timer play-test).
        typed = state.flags().get(item_id) or {}
        if typed.get("manual") and typed.get("name"):
            detail["entry"] = {"item_id": item_id, "canonical_name": typed["name"]}
            return detail
        raise HTTPException(404, "unknown item")
    return detail


@app.post("/decode/pdf")
async def decode_pdf(req: Request):
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 10_000_000:
        raise HTTPException(413, "PDF too large (10 MB max)")
    try:
        text = await run_in_threadpool(extract_pdf_text, body)
    except Exception:
        raise HTTPException(422, "could not read this PDF")
    if len(text.strip()) < 20:
        raise HTTPException(422, "no text layer in this PDF — scanned receipts use the photo path, which opens after verification")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    client = MetaClient(ledger=_ledger())
    receipt = await run_in_threadpool(decode_text, text, client)
    _need_receipt_date(receipt)
    added = state.add_receipts(
        [receipt], media={receipt["receipt_id"]: (body, "application/pdf")})
    await run_in_threadpool(state.judge_pending, MetaClient(ledger=_ledger()))
    return {"added": added, "total_receipts": len(state.receipts()), "receipt": receipt}


@app.post("/decode/photo")
async def decode_photo_route(req: Request):
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a receipt photo (image) or use /decode/pdf for PDFs")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = MetaClient(ledger=_ledger())
    try:
        receipt = await run_in_threadpool(decode_photo, body, client,
                                          media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    _need_receipt_date(receipt)
    if demo:
        # The demo files into the visitor's sandbox (never disk), so a
        # hunt can finish on its receipt; the batch judge does not run.
        receipt["live"] = True
        added = state.add_receipts([receipt])
        return {"demo": True, "added": added, "receipt": receipt}
    added = state.add_receipts(
        [receipt], media={receipt["receipt_id"]: (body, media)})
    await run_in_threadpool(state.judge_pending, MetaClient(ledger=_ledger()))
    return {"added": added, "total_receipts": len(state.receipts()), "receipt": receipt}


@app.post("/api/transcribe")
async def transcribe_route(req: Request):
    """Muse Voice Transcribe, proxied: the browser sends a WAV
    recording (mono 16-bit PCM, 16 kHz — the batch endpoint's input
    contract) and the server key makes the call. Stateless by design:
    the transcript is returned, never stored, for every account
    including the demo."""
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if media not in ("audio/wav", "audio/x-wav", "audio/wave"):
        raise HTTPException(415, "send a WAV recording (audio/wav)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty recording")
    if len(body) > 10_000_000:
        raise HTTPException(413, "recording too large — keep it under a few minutes")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    from api.voice.service import transcribe_audio
    client = MetaClient(ledger=_ledger())
    try:
        out = await run_in_threadpool(transcribe_audio, body, client)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    return {"text": out["text"], "duration_s": out["duration_s"],
            "model": "muse-voice-transcribe-1.0", "demo": demo}


@app.post("/eyes/photo")
async def eyes_photo(req: Request, kind: str = "fridge"):
    if kind not in ("fridge", "pantry", "freezer", "fruit"):
        raise HTTPException(400, "kind must be fridge, pantry, freezer, or fruit")
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo of the fridge, pantry, freezer, or fruit")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    from api.eyes.service import detect, match_item
    from datetime import date as _d
    client = MetaClient(ledger=_ledger())
    try:
        sightings = await run_in_threadpool(detect, body, client,
                                            media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    rec_id = "eye-" + hashlib.sha1(body).hexdigest()[:10]
    ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(media, ".jpg")
    photo_dir = os.path.join(state.data_dir(), "eyes_photos")
    os.makedirs(photo_dir, exist_ok=True)
    with open(os.path.join(photo_dir, rec_id + ext), "wb") as fh:
        fh.write(body)
    idx = state.name_index()
    for sg in sightings:
        sg["item_id"] = match_item(sg["name"], idx)
        sg["state"] = "pending"
    rec = {"id": rec_id, "date": _d.today().isoformat(), "kind": kind,
           "photo": rec_id + ext, "sightings": sightings}
    state.save_eyes_record(rec)
    return rec


@app.get("/api/eyes")
def eyes_list():
    return {"records": sorted(state.eyes_records(), key=lambda r: r["date"], reverse=True)}


@app.post("/api/eyes/{rec_id}/delete")
def eyes_delete(rec_id: str):
    """Delete one Eyes photo and its record (Tranche 1)."""
    from api import state
    if state.delete_eyes_record(rec_id) is None:
        raise HTTPException(404, "no such photo")
    return {"ok": True, "deleted": rec_id}


# --- Agent connector (MCP): any MCP-capable assistant, one token ---
# The connector is generic by design (owner, 2026-10-28): the account's
# API token authenticates /api/mcp through the same middleware as the
# REST doors, and each tool mirrors an existing REST behavior — the
# snapshot Ask reads, the shared add path, the flag check, and the
# structured intake (the agent reads the receipt; Arya verifies and
# files it). Muse Spark is the showcased client, not a special case.

def _mcp_get_snapshot(args):
    from api.chat_service import snapshot
    s = snapshot()
    return {"as_of": s["as_of"], "running_low": s["running_low"],
            "spend_total": s["spend_total"],
            "returns_total": s["returns_total"], "trips": s["trips"],
            "top_items": s["top_items"]}


def _mcp_get_list(args):
    d = state.derived()
    nm = state.names()
    return {"as_of": state.as_of(), "items": [
        {"name": i.get("name") or nm.get(i["item_id"], i["item_id"]),
         "item_id": i["item_id"], "checked": bool(i.get("checked"))}
        for i in d["smart_list"]["items"]]}


def _mcp_str(v):
    return v.strip() if isinstance(v, str) else ""


def _mcp_add_items(args):
    items = args.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("items must be a non-empty array of names")
    if len(items) > 50:
        raise ValueError("add at most 50 items per call")
    added = [_add_name_to_list(_mcp_str(n)[:120]) for n in items
             if _mcp_str(n)]
    if not added:
        raise ValueError("items must be a non-empty array of names")
    return {"added": added}


def _mcp_check_item(args):
    name = _mcp_str(args.get("name"))
    if not name:
        raise ValueError("name is required")
    d = state.derived()
    nm = state.names()
    want = name.lower()
    for i in d["smart_list"]["items"]:
        iname = i.get("name") or nm.get(i["item_id"], i["item_id"])
        if iname.lower() == want:
            _merge_flag(i["item_id"],
                        {"checked_on": state.as_of() if args.get("checked", True) else None})
            return {"name": iname, "checked": bool(args.get("checked", True))}
    raise ValueError(f"{name} is not on the list")


def _mcp_file_receipt(args):
    merchant = _mcp_str(args.get("merchant"))
    purchased_at = _mcp_str(args.get("purchased_at"))
    try:
        day = datetime.date.fromisoformat(purchased_at)
    except ValueError:
        day = None
    if purchased_at and (day is None or day > datetime.date.today()):
        raise ValueError("purchased_at must be a real ISO date (YYYY-MM-DD) "
                         "that is not in the future")
    raw_lines = args.get("lines")
    if not merchant or not purchased_at or not isinstance(raw_lines, list) or not raw_lines:
        raise ValueError("a receipt needs merchant, purchased_at, and lines")
    from api.decode.service import _finish
    lines = []
    for ln in raw_lines:
        if not isinstance(ln, dict) or not _mcp_str(ln.get("decoded_name")) \
                or isinstance(ln.get("line_total"), bool) \
                or not isinstance(ln.get("line_total"), (int, float)) \
                or not math.isfinite(ln["line_total"]):
            raise ValueError("every line needs decoded_name and a numeric line_total")
        lt = ln.get("line_type") or "item"
        lines.append({
            "raw": ln.get("raw") or ln["decoded_name"],
            "decoded_name": ln["decoded_name"],
            "qty": ln.get("qty") if isinstance(ln.get("qty"), (int, float)) else 1,
            "unit_price": ln.get("unit_price"),
            "line_total": float(ln["line_total"]),
            "line_type": lt if lt in ("item", "discount", "return") else "item",
            "sku": ln.get("sku"), "discount_parent_sku": ln.get("discount_parent_sku"),
            "confidence": ln.get("confidence") if isinstance(ln.get("confidence"), (int, float)) else 0.5,
            "alternatives": []})
    lines, reconcile = _finish(lines, args.get("subtotal"))
    rid = args.get("receipt_id")
    if not isinstance(rid, str) or not rid:
        import hashlib as _h
        rid = "ext-" + _h.sha1(json.dumps(args, sort_keys=True).encode()).hexdigest()[:10]
    dec = {"receipt_id": rid, "source_type": "muse",
           "merchant": merchant, "purchased_at": purchased_at,
           "lines": lines, "subtotal": args.get("subtotal"),
           "tax": args.get("tax"), "total": args.get("total"),
           "totals_reconcile": reconcile, "image_ref": None}
    added = state.add_receipts([dec])
    state.judge_pending(MetaClient(ledger=_ledger()))
    return {"receipt_id": rid, "merchant": merchant, "added": added,
            "lines": len(lines), "totals_reconcile": reconcile}


def _mcp_get_receipts(args):
    limit = args.get("limit")
    if isinstance(limit, bool) or not isinstance(limit, int):
        limit = 10
    limit = min(max(limit, 1), 100)
    out = []
    for r in state.receipts():
        total = r.get("total")
        if total is None:
            total = round(sum(ln.get("line_total") or 0 for ln in r.get("lines", [])), 2)
        out.append({"receipt_id": r["receipt_id"], "merchant": r.get("merchant"),
                    "purchased_at": r.get("purchased_at"), "total": total})
    out.sort(key=lambda x: x["purchased_at"] or "", reverse=True)
    return {"receipts": out[:limit]}


_MCP_HANDLERS = {
    "get_snapshot": _mcp_get_snapshot,
    "get_list": _mcp_get_list,
    "add_items": _mcp_add_items,
    "check_item": _mcp_check_item,
    "file_receipt": _mcp_file_receipt,
    "get_receipts": _mcp_get_receipts,
}


def _mcp_dispatch(msg, demo=False):
    """One JSON-RPC message in, one response dict out (None for a
    notification). Runs in a threadpool: tool handlers block on the
    file store and, for file_receipt, on the staple judge."""
    from api import mcp
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or "method" not in msg:
        return mcp.error(msg.get("id") if isinstance(msg, dict) else None,
                         -32600, "invalid request")
    rid = msg.get("id")
    method = msg["method"]
    params = msg.get("params") or {}
    if method.startswith("notifications/"):
        return None
    if method == "initialize":
        want = (params.get("protocolVersion")
                if isinstance(params, dict) else None)
        return mcp.result(rid, {
            "protocolVersion": want if want in mcp.PROTOCOL_VERSIONS
                               else mcp.DEFAULT_PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": mcp.SERVER_INFO})
    if method == "ping":
        return mcp.result(rid, {})
    if method == "tools/list":
        return mcp.result(rid, {"tools": mcp.TOOL_DEFS})
    if method == "tools/call":
        name = params.get("name") if isinstance(params, dict) else None
        handler = _MCP_HANDLERS.get(name if isinstance(name, str) else "")
        if name == "file_receipt" and demo:
            # Same rule as /api/intake/: filing a receipt (and the model
            # call that judges it) needs a real account.
            return mcp.result(rid, mcp.tool_error(
                "this needs a real account — the demo household keeps nothing"))
        if handler is None:
            return mcp.result(rid, mcp.tool_error(f"unknown tool: {name}"))
        args = params.get("arguments") or {}
        if not isinstance(args, dict):
            return mcp.result(rid, mcp.tool_error("arguments must be an object"))
        try:
            data = handler(args)
        except ValueError as e:
            return mcp.result(rid, mcp.tool_error(str(e)))
        return mcp.result(rid, mcp.tool_result(data))
    return mcp.error(rid, -32601, f"method not found: {method}")


@app.post("/api/mcp")
async def mcp_route(req: Request):
    body = await _json_body(req)
    resp = await run_in_threadpool(_mcp_dispatch, body, _is_demo(req))
    if resp is None:
        return Response(status_code=202)
    return resp


@app.get("/eyes/photos/{rec_id}")
def eyes_photo_file(rec_id: str):
    from fastapi.responses import FileResponse
    photo_dir = os.path.join(state.data_dir(), "eyes_photos")
    for ext in (".jpg", ".png", ".webp"):
        p = os.path.join(photo_dir, rec_id + ext)
        if os.path.exists(p):
            return FileResponse(p)
    raise HTTPException(404, "no such photo")


@app.post("/api/eyes/{rec_id}/sightings/{idx}")
async def eyes_decide(rec_id: str, idx: int, req: Request):
    body = await _json_obj(req)
    decision = body.get("state")
    if decision not in ("confirmed", "rejected"):
        raise HTTPException(400, "state must be confirmed or rejected")
    for rec in state.eyes_records():
        if rec["id"] == rec_id:
            if idx < 0 or idx >= len(rec["sightings"]):
                raise HTTPException(404, "no such sighting")
            rec["sightings"][idx]["state"] = decision
            state.save_eyes_record(rec)
            return rec
    raise HTTPException(404, "no such eyes record")


@app.post("/api/items/{item_id}/expired")
def item_expired(item_id: str):
    from datetime import date as _d
    fl = state.flags()
    cur = dict(fl.get(item_id, {}))
    cur["expired"] = _d.today().isoformat()
    state.set_flag(item_id, cur)
    return {"item_id": item_id, "expired": cur["expired"]}


@app.post("/api/chat")
async def chat_route(req: Request):
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    body = await _json_obj(req)
    from api.chat_service import chat as run_chat
    client = MetaClient(ledger=_ledger())
    try:
        surface = body.get("surface") if body.get("surface") in ("list", "hunt") else None
        return await run_in_threadpool(run_chat, body.get("messages", []), client,
                                       surface=surface, context=body.get("context"))
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])


@app.post("/api/chat/apply")
async def chat_apply_route(req: Request):
    """The yes to an action Arya proposed from the List or a hunt."""
    body = await _json_obj(req)
    actions = body.get("actions")
    if not isinstance(actions, list) or not actions:
        raise HTTPException(400, "actions are required")
    from api.chat_service import apply_confirmed
    return await run_in_threadpool(apply_confirmed, actions[:10])


@app.post("/api/cart/approve")
def approve_route():
    cart = approve(state.get_cart())
    state.save_cart(cart)
    return cart


# The flag vocabulary — every key a flag record may carry. The
# flag route writes only these; anything else in a POST body is a
# caller bug and never lands in the store (review M6: an empty
# probe POST once left a junk record behind).
_FLAG_KEYS = {"manual", "never", "out", "expired", "snoozed_until",
              "dismissed_on", "checked_on", "check_ok", "qty_override",
              "name", "list", "use_by", "use_by_kind", "use_by_set", "use_by_snooze", "unit"}


@app.post("/api/items/{item_id}/flag")
async def flag_route(item_id: str, req: Request):
    body = await _json_obj(req)
    updates = {k: v for k, v in body.items() if k in _FLAG_KEYS}
    if not updates:
        raise HTTPException(400, "no recognized flag fields")
    merged = state.update_flag(item_id, lambda f: {**f, **updates})
    return {"item_id": item_id, "flags": merged}


def _merge_flag(item_id, fields):
    return state.update_flag(item_id, lambda f: {**f, **fields})


@app.get("/api/list/candidates")
def list_candidates():
    d = state.derived()
    nm = state.names()
    on_list = {i["item_id"] for i in d["smart_list"]["items"]}
    return {"candidates": [{"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
                            "on_list": p["item_id"] in on_list}
                           for p in d["patterns"] if p["purchase_count"] >= 1]}


@app.post("/api/judge/run")
def judge_run():
    try:
        _budget_guard()
    except HTTPException:
        # Over today's budget: judge nothing, quietly, like a host
        # with no key. Verdicts catch up on the next run.
        return {"judged": 0, "paused": True}
    client = MetaClient(ledger=_ledger())
    return {"judged": state.judge_pending(client)}


@app.post("/api/judge/second-seat")
def judge_second_seat():
    """The open-weights second seat re-judges this account's judged
    items by NAME only (no facts leave the hosted API) and records
    where it disagrees with the deciding verdict. Advisory only:
    judgments are never changed here."""
    from api.judge import second_seat_batch, second_seat_report
    from api.open_client import OpenClient
    judged = state.judgments()
    if not judged:
        return {"checked": 0, "agreed": 0, "disagreements": []}
    _budget_guard()
    client = OpenClient()
    if not client.api_key:
        # Not provisioned on this host yet: a quiet no-op, the same
        # contract judge/run keeps when no Meta key is set.
        return {"checked": 0, "agreed": 0, "disagreements": [],
                "provisioned": False}
    nm = state.names()
    items = [(iid, nm.get(iid, iid)) for iid in judged]
    verdicts = {}
    for i in range(0, len(items), 25):
        verdicts.update(second_seat_batch(client, items[i:i + 25]))
    report = second_seat_report(verdicts, judged, nm)
    state.save_second_seat(report)
    return report


def _add_name_to_list(name, qty=1, list_id=None, unit=""):
    """A typed/pasted/read name joins the list as a manual item —
    the one add path every Add surface shares. A typed quantity
    ("eggs x 2") rides along as the item's quantity."""
    import re as _re
    from api.list.intake import existing_item_id
    name = (name or "").strip()
    known = existing_item_id(name, state.dictionary()["entries"], state.flags())
    if known:
        # Already tracked, or already typed in: the same row, not a twin.
        flag = {"manual": True, "dismissed_on": None}
        if qty and qty > 1:
            flag["qty_override"] = qty
        if unit:
            flag["unit"] = unit
        _merge_flag(known, flag)
        return {"item_id": known, "name": state.flags().get(known, {}).get("name")
                or state.names().get(known, name)}
    item_id = "manual-" + _re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    flag = {"manual": True, "name": name, "dismissed_on": None}
    if qty and qty > 1:
        flag["qty_override"] = qty
    if unit:
        flag["unit"] = unit
    if list_id:
        flag["list"] = list_id
    _merge_flag(item_id, flag)
    return {"item_id": item_id, "name": name}


def _list_add_fields(body):
    """Validate the Pack extras of an add BEFORE anything is written.
    Returns the flag fields to set; raises 400 on a bad quantity."""
    qty = body.get("qty")
    fields = {}
    list_id = body.get("list_id")
    if list_id:
        if not any(l["id"] == list_id for l in state.named_lists()):
            raise HTTPException(404, "no such list")
        fields["list"] = list_id
    if qty is not None and not isinstance(qty, bool):
        try:
            n = int(qty)
        except (TypeError, ValueError):
            raise HTTPException(400, "qty must be a whole number")
        if n >= 1:
            fields["qty_override"] = min(n, 99)
    return fields


def _list_add_extras(item_id, body, fields):
    """Pack slice: an add may carry a quantity (stored as the list
    row's qty_override), who added it (flag added_by, at most 24
    characters) and approved (the grown-up said yes to that add).
    Only an add that carries a "by" key changes the name: a later add
    with no "by" key, such as an Undo of a removal, leaves it alone;
    an empty "by" clears it."""
    from api.itemmeta import clean_extras

    def change(merged):
        merged.update(fields)
        if "by" in body:
            by = clean_extras({"by": body.get("by")}).get("by")
            if by:
                merged["added_by"] = by
            else:
                merged.pop("added_by", None)
            merged.pop("approved", None)
        if body.get("approved") is True:
            merged["approved"] = True
        return merged
    state.update_flag(item_id, change)


@app.post("/api/list/add")
async def list_add(req: Request):
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id and not body.get("name"):
        raise HTTPException(400, "item_id or name is required")
    fields = _list_add_fields(body)  # a bad qty fails before any write
    if not item_id:
        # A typed quantity ("eggs x 2") rides along; a qty in the body wins.
        from api.list.intake import split_list_items_units, clean_unit
        typed = split_list_items_units(str(body["name"]))
        name, qty, unit = typed[0] if len(typed) == 1 else (body["name"], 1, "")
        unit = clean_unit(body["unit"]) if "unit" in body else unit
        item_id = _add_name_to_list(name, qty, unit=unit)["item_id"]
        _list_add_extras(item_id, body, fields)
        return {"item_id": item_id}
    _merge_flag(item_id, {"manual": True, "dismissed_on": None})
    _list_add_extras(item_id, body, fields)
    return {"item_id": item_id}


@app.post("/api/list/from-text")
async def list_from_text(req: Request):
    """Typed or pasted list text -> list adds. The split is
    deterministic code ($0); only when it yields nothing sensible
    (chat text with chatter in it) does one Spark Standard
    extraction call run."""
    body = await _json_obj(req)
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(400, "text is required")
    list_id = (body.get("list_id") or None)
    if list_id and not any(l["id"] == list_id for l in state.named_lists()):
        raise HTTPException(404, "no such list")
    from api.list.intake import split_list_items_units, extract_items_model, skipped_pieces
    typed = split_list_items_units(text)
    skipped = skipped_pieces(text) if typed else []
    names = [n for n, _q, _u in typed]
    source = "split"
    if not names:
        if not os.environ.get("MODEL_API_KEY"):
            raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
        _budget_guard()
        client = MetaClient(ledger=_ledger())
        names = extract_items_model(text, client)
        typed = [(n, 1, "") for n in names]
        source = "model"
    on_list = {i["item_id"] for i in state.derived()["smart_list"]["items"]}
    added = [_add_name_to_list(n, q, list_id, u) for n, q, u in typed]
    # Already on the list: neither merged nor new, so not "added".
    already = sum(1 for a in added if a["item_id"] in on_list)
    return {"added": len(added) - already, "already": already,
            "names": [a["name"] for a in added], "source": source,
            "skipped": skipped,
            # Only what newly joined the list: the client's Undo.
            "item_ids": [a["item_id"] for a in added if a["item_id"] not in on_list]}


@app.post("/api/list/judge")
async def list_judge(req: Request):
    """Settle the list's unknown names: the typed items the rules and
    the aisle map do not know. One batched Spark Standard call at most,
    and each name is asked once ever (the verdict is cached). Nothing
    is removed or blocked; the client shows "Not a grocery item?
    Added anyway" for what comes back flagged. No key or a failed
    call just leaves the names unknown (treated as groceries)."""
    from api.list import grocery
    verdicts = grocery.load_verdicts()
    unknown = []
    for i in state.derived()["smart_list"]["items"]:
        if i.get("source") != "user":
            continue
        if grocery.classify(i["name"], verdicts)["kind"] == "unknown" \
                and not verdicts.get(_key_of(i["name"])):
            unknown.append(i["name"])
    if not unknown or not os.environ.get("MODEL_API_KEY"):
        return {"judged": 0, "flagged": []}
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = MetaClient(ledger=_ledger())
    found = await run_in_threadpool(grocery.judge_unknown, unknown, client)
    if found:
        verdicts = grocery.save_verdicts(found)
    flagged = [i["item_id"] for i in state.derived()["smart_list"]["items"]
               if i.get("not_grocery")]
    return {"judged": len(found), "flagged": flagged}


def _key_of(name):
    from api.list.intake import _key
    return _key(name)


@app.post("/api/list/grocery-verdict")
async def list_grocery_verdict(req: Request):
    """The user's word on one item: kind "grocery" (Keep: it is fine)
    or "other". Saved by name, beats every rule and model verdict."""
    body = await _json_obj(req)
    item = next((i for i in state.derived()["smart_list"]["items"]
                 if i["item_id"] == body.get("item_id")), None)
    kind = body.get("kind")
    if not item or kind not in ("grocery", "other"):
        raise HTTPException(400, "item_id on the list and kind grocery|other required")
    from api.list.grocery import set_user_verdict
    set_user_verdict(item["name"], kind)
    return {"item_id": item["item_id"], "kind": kind}


@app.post("/api/list/from-photo")
async def list_from_photo(req: Request):
    """The Add tab's camera: one Spark vision read. A list photo
    (handwritten, whiteboard) adds its items to the list; a receipt
    photo adds nothing — it is reported as a receipt so the client
    can offer to file it (receipts enter by image, through
    /decode/photo). The demo runs the same live read and persists
    nothing."""
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    from api.list.intake import read_list_photo
    client = MetaClient(ledger=_ledger())
    try:
        read = await run_in_threadpool(read_list_photo, body, client,
                                       media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    if read["kind"] == "receipt":
        return {"kind": "receipt", "names": [], "added": 0}
    # The demo adds too: its writes land in the visitor's sandbox.
    added = [_add_name_to_list(n) for n in read["items"]]
    return {"kind": "list", "names": [a["name"] for a in added],
            "added": len(added), "demo": demo}


# --- Expiry dates (owner, 2026-10-29) ----------------------------------

def _known_item_name(item_id):
    return (state.flags().get(item_id, {}).get("name")
            or state.names().get(item_id) or item_id)


@app.post("/api/expiry/read")
async def expiry_read(req: Request, sample: int = 0):
    """One Spark vision read of the date on a package. Nothing is saved:
    the client shows what Arya read and the user confirms through
    /api/expiry/save. ?sample=1 (demo only) returns a canned read with
    no model call, so a visitor with no package can try the flow."""
    from api import expiry
    today = _d_today()
    demo = _is_demo(req)
    if sample:
        if not demo:
            raise HTTPException(400, "sample reads are for the demo")
        from datetime import timedelta as _td
        read = {"readable": True, "name": "Whole Milk 1 gal",
                "date": (today + _td(days=5)).isoformat(), "kind": "use_by",
                "confidence": 1.0, "raw": "USE BY (sample)"}
    else:
        media = (req.headers.get("content-type") or "").split(";")[0].strip()
        if not media.startswith("image/"):
            raise HTTPException(415, "send a photo (image)")
        body = await req.body()
        if not body:
            raise HTTPException(400, "empty upload")
        if len(body) > 12_000_000:
            raise HTTPException(413, "photo too large (12 MB max)")
        if not os.environ.get("MODEL_API_KEY"):
            raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
        _budget_guard(demo=demo)
        client = MetaClient(ledger=_ledger())
        try:
            read = await run_in_threadpool(expiry.read_expiry_photo, body, client,
                                           media_type=media, today=today)
        except RuntimeError as e:
            raise HTTPException(502, str(e)[:200])
    item_id = expiry.match_item(read["name"], state.dictionary()["entries"], state.flags())
    read["match"] = ({"item_id": item_id, "name": _known_item_name(item_id)}
                     if item_id else None)
    read["demo"] = demo
    return read


@app.post("/api/expiry/save")
async def expiry_save(req: Request):
    """The user confirmed a date. Tracks it on the item (a known one by
    item_id, else a new tracked-only item by name — it does not join
    the shopping list)."""
    import re as _re
    from api import expiry
    body = await _json_obj(req)
    d = expiry.parse_iso(body.get("date"))
    today = _d_today()
    if not expiry.sane_date(d, today):
        raise HTTPException(400, "date must be a real date within the next five years")
    item_id = body.get("item_id")
    name = " ".join(str(body.get("name") or "").split())[:80]
    if item_id:
        if item_id not in state.flags() and item_id not in state.names():
            raise HTTPException(404, "unknown item")
    elif name:
        item_id = expiry.match_item(name, state.dictionary()["entries"], state.flags())
        if not item_id:
            item_id = "manual-" + _re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            _merge_flag(item_id, {"name": name})
    else:
        raise HTTPException(400, "item_id or name is required")
    _merge_flag(item_id, expiry.track_fields(d, body.get("kind"), today))
    return {"item_id": item_id, "name": _known_item_name(item_id),
            "date": d.isoformat()}


@app.post("/api/expiry/{item_id}/{action}")
def expiry_action(item_id: str, action: str):
    """done (used it) and stop both untrack; snooze waits two days."""
    from datetime import timedelta as _td
    from api import expiry
    if not expiry.tracked(state.flags().get(item_id)):
        raise HTTPException(404, "that item has no tracked date")
    if action in ("done", "stop"):
        _merge_flag(item_id, expiry.untrack_fields())
    elif action == "snooze":
        until = (_d_today() + _td(days=expiry.SNOOZE_DAYS)).isoformat()
        _merge_flag(item_id, {"use_by_snooze": until})
    else:
        raise HTTPException(404, "unknown action")
    return {"item_id": item_id, "name": _known_item_name(item_id), "action": action}


@app.post("/api/list/remove")
async def list_remove(req: Request):
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    _merge_flag(item_id, {"manual": False, "dismissed_on": state.as_of()})
    return {"ok": True}


@app.post("/api/list/qty")
async def list_qty(req: Request):
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    qty = _int_field(body, "qty", 1)
    flag = {"qty_override": max(1, qty)}
    if "unit" in body:
        from api.list.intake import clean_unit
        flag["unit"] = clean_unit(body["unit"])  # "" clears it
    _merge_flag(item_id, flag)
    return {"ok": True}


# ---- Account settings. Currency only so far (owner, 2026-10-29): it
# changes the symbol prices show with, nothing else. No exchange rates
# and no conversion: an amount is shown as it was read.
CURRENCIES = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹",
              "CAD": "C$", "AUD": "A$"}


@app.get("/api/settings")
def settings_get():
    code = state._load("settings.json", {}).get("currency", "USD")
    if code not in CURRENCIES:
        code = "USD"
    return {"currency": code, "symbol": CURRENCIES[code],
            "currencies": [{"code": c, "symbol": v} for c, v in CURRENCIES.items()]}


@app.post("/api/settings")
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


# ---- Named lists (owner, 2026-10-29): Costco, Trader Joe's, Indian
# Store, Party... An item sits on one list at a time (flag "list");
# an item on no list shows under "Everything else". Deleting a list
# never touches its items, so Undo is just restoring the list record.

def _clean_list_fields(body, current=None):
    """Validate a list's name and stores from a request body."""
    out = {}
    if "name" in body or current is None:
        name = " ".join(str(body.get("name") or "").split())[:40]
        if not name:
            raise HTTPException(400, "give the list a name")
        out["name"] = name
    if "stores" in body or current is None:
        raw = body.get("stores") or []
        if not isinstance(raw, list):
            raise HTTPException(400, "stores must be a list of names")
        stores = []
        for st in raw:
            st = " ".join(str(st or "").split())[:60]
            if st and st.lower() not in {x.lower() for x in stores}:
                stores.append(st)
        out["stores"] = stores[:state.MAX_LIST_STORES]
    return out


def _check_list_name_free(rows, name, own_id=None):
    if any(l["id"] != own_id and l["name"].lower() == name.lower() for l in rows):
        raise HTTPException(409, f"you already have a list called {name}")


@app.get("/api/lists")
def lists_get():
    return {"lists": state.named_lists()}


@app.post("/api/lists")
async def lists_create(req: Request):
    import uuid
    body = await _json_obj(req)
    fields = _clean_list_fields(body)
    rows = state.named_lists()
    if len(rows) >= state.MAX_LISTS:
        raise HTTPException(400, f"{state.MAX_LISTS} lists is the most for now")
    _check_list_name_free(rows, fields["name"])
    row = {"id": "l-" + uuid.uuid4().hex[:8], **fields}
    state.save_named_lists(rows + [row])
    return row


@app.post("/api/lists/update")
async def lists_update(req: Request):
    body = await _json_obj(req)
    rows = state.named_lists()
    row = next((l for l in rows if l["id"] == body.get("id")), None)
    if row is None:
        raise HTTPException(404, "no such list")
    fields = _clean_list_fields(body, current=row)
    if "name" in fields:
        _check_list_name_free(rows, fields["name"], own_id=row["id"])
    row.update(fields)
    state.save_named_lists(rows)
    return row


@app.post("/api/lists/delete")
async def lists_delete(req: Request):
    body = await _json_obj(req)
    rows = state.named_lists()
    row = next((l for l in rows if l["id"] == body.get("id")), None)
    if row is None:
        raise HTTPException(404, "no such list")
    state.save_named_lists([l for l in rows if l is not row])
    # Items keep their (now dangling) list id, so restoring the same
    # record brings them straight back; until then they read as
    # "Everything else".
    return {"deleted": row, "index": rows.index(row)}


@app.post("/api/lists/restore")
async def lists_restore(req: Request):
    """Undo of a delete: put the same record back at its place."""
    body = await _json_obj(req)
    rec = body.get("list") or {}
    fields = _clean_list_fields(rec)
    lid = str(rec.get("id") or "")
    if not lid.startswith("l-"):
        raise HTTPException(400, "list id is required")
    rows = state.named_lists()
    if any(l["id"] == lid for l in rows):
        return {"list": next(l for l in rows if l["id"] == lid)}
    _check_list_name_free(rows, fields["name"])
    row = {"id": lid, **fields}
    idx = body.get("index")
    idx = idx if isinstance(idx, int) and 0 <= idx <= len(rows) else len(rows)
    rows.insert(idx, row)
    state.save_named_lists(rows)
    return {"list": row}


@app.post("/api/list/move")
async def list_move(req: Request):
    """File an item under a list, or under no list (list_id null)."""
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    list_id = body.get("list_id") or None
    if list_id and not any(l["id"] == list_id for l in state.named_lists()):
        raise HTTPException(404, "no such list")
    _merge_flag(item_id, {"list": list_id})
    return {"ok": True}


@app.post("/api/list/check")
async def list_check(req: Request):
    body = await _json_obj(req)
    if not body.get("item_id"):
        raise HTTPException(400, "item_id is required")
    _merge_flag(body["item_id"],
                {"checked_on": state.as_of() if body.get("checked") else None})
    return {"ok": True}


@app.post("/api/list/check-ok")
async def list_check_ok(req: Request):
    body = await _json_obj(req)
    if not body.get("item_id"):
        raise HTTPException(400, "item_id is required")
    _merge_flag(body["item_id"], {"check_ok": state.as_of()})
    return {"ok": True}


@app.post("/api/review/line")
async def review_line(req: Request):
    body = await _json_obj(req)
    action = body.get("action")
    receipt_id = body.get("receipt_id")
    if not receipt_id:
        raise HTTPException(400, "receipt_id is required")
    idx = _int_field(body, "idx")
    if action == "confirm":
        line = state.update_receipt_line(receipt_id, idx, {"status": "auto"})
    elif action == "rename":
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "name is required to rename")
        line = state.update_receipt_line(receipt_id, idx,
                                         {"status": "auto", "decoded_name": name})
        if line:
            state.teach_name(line.get("sku"), name)
    else:
        raise HTTPException(400, "action must be confirm or rename")
    if line is None:
        raise HTTPException(404, "no such line")
    return {"ok": True}


@app.post("/api/review/resolve")
async def review_resolve(req: Request):
    body = await _json_obj(req)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    entry = state.resolve_dictionary(body.get("item_id"), name)
    if entry is None:
        raise HTTPException(404, "no such item")
    return {"ok": True}


# --- Stores (Stage E): the platform directory + My Stores ---

@app.get("/api/stores/search")
def stores_search(q: str = "", quests: int = 0):
    from api import stores as stores_mod
    return {"stores": stores_mod.search_views(q, quests_only=bool(quests))}


@app.get("/api/stores/mine")
def stores_mine():
    from api import stores as stores_mod
    return {"stores": stores_mod.mine()}


@app.post("/api/stores/mine")
async def stores_add_mine(req: Request):
    body = await _json_obj(req)
    store_id = (body.get("store_id") or "").strip()
    if not store_id:
        raise HTTPException(400, "store_id is required")
    from api import stores as stores_mod
    row = stores_mod.add_to_mine(store_id)
    if row is None:
        raise HTTPException(404, "no such store in the directory")
    return row


@app.post("/api/stores")
async def stores_create(req: Request):
    body = await _json_obj(req)
    from api import stores as stores_mod
    try:
        store, _created = stores_mod.create_store(
            body.get("name"), body.get("street"), body.get("city"),
            body.get("state"), body.get("zip"),
            created_by=state._current_user.get())
    except ValueError as e:
        raise HTTPException(400, str(e))
    return stores_mod.add_to_mine(store["id"])


@app.get("/api/stores/places")
def stores_places(q: str = "", session: str = "",
                  lat: float = None, lng: float = None):
    """Google Places suggestions for the store picker. A plain def
    route: the upstream call blocks, so FastAPI runs it in the
    threadpool. Unprovisioned (no key) is a quiet no-op, the
    second-seat shape."""
    from api import places
    nearby = not q.strip() and lat is not None and lng is not None
    if not places.provisioned() or (len(q.strip()) < 3 and not nearby):
        return {"provisioned": places.provisioned(), "suggestions": []}
    try:
        if nearby:
            # "Near me": grocery stores around the phone, no typing.
            rows = places._text_search_stores("", lat, lng)
        else:
            rows = places.autocomplete(q.strip(), session or None, lat, lng)
    except places.PlacesError:
        return {"provisioned": True, "suggestions": [], "error": "places"}
    return {"provisioned": True, "suggestions": rows}


@app.post("/api/stores/places/pick")
async def stores_places_pick(req: Request):
    body = await _json_obj(req)
    place_id = (body.get("place_id") or "").strip()
    name = (body.get("name") or "").strip()
    if not place_id or not name:
        raise HTTPException(400, "place_id and name are required")
    from api import places
    if not places.provisioned():
        raise HTTPException(503, "Google Places is not provisioned yet")
    from starlette.concurrency import run_in_threadpool
    try:
        row = await run_in_threadpool(
            places.pick_store, place_id, name, state._current_user.get())
    except places.PlacesError as e:
        raise HTTPException(502, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return row


@app.post("/api/stores/favorite")
async def stores_favorite(req: Request):
    body = await _json_obj(req)
    store_id = (body.get("store_id") or "").strip()
    if not store_id:
        raise HTTPException(400, "store_id is required")
    if "favorite" not in body:
        raise HTTPException(400, "favorite is required")
    from api import stores as stores_mod
    row = stores_mod.set_favorite(store_id, body.get("favorite"))
    if row is None:
        raise HTTPException(404, "that store is not in your stores")
    return row


@app.post("/api/stores/mine/remove")
async def stores_mine_remove(req: Request):
    body = await _json_obj(req)
    store_id = (body.get("store_id") or "").strip()
    if not store_id:
        raise HTTPException(400, "store_id is required")
    from api import stores as stores_mod
    if not stores_mod.remove_from_mine(store_id):
        raise HTTPException(404, "that store is not in your stores")
    return {"ok": True, "removed": store_id}


# --- Arya Quest (Stage A): sessions, optimizer, Shop-Off, social ---

@app.post("/api/quest/sessions")
async def quest_create_session(req: Request):
    body = await _json_obj(req)
    store = (body.get("store") or "").strip()
    store_id = (body.get("store_id") or "").strip() or None
    store_address = None
    if store_id:
        # A directory store wins over the typed name: the session
        # snapshots the directory's name + address (Stage E).
        from api import stores as stores_mod
        snap = stores_mod.snapshot(store_id)
        if snap is None:
            raise HTTPException(404, "no such store in the directory")
        store = snap["name"]
        store_address = snap["address"]
    if not store:
        raise HTTPException(400, "store is required")
    from api import quest
    try:
        _budget_guard()
        match_client = MetaClient(ledger=_ledger())
    except HTTPException:
        match_client = None  # over budget: shelf matching stays code-only
    try:
        sess = await run_in_threadpool(
            quest.create_session, store, body.get("mode") or "quest",
            body.get("items") or [],
            driver=body.get("driver") or "strip",
            store_id=store_id, store_address=store_address,
            client=match_client)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return sess


@app.get("/api/quest/sessions")
def quest_list_sessions():
    from api import quest
    return {"sessions": quest.list_sessions()}


@app.get("/api/quest/sessions/{session_id}")
def quest_get_session(session_id: str):
    from api import quest
    sess = quest.get_session(session_id)
    if sess is None:
        raise HTTPException(404, "no such session")
    return quest.session_view(sess)


@app.post("/api/quest/sessions/{session_id}/items")
async def quest_add_item(session_id: str, req: Request):
    body = await _json_obj(req)
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    from api import quest
    sess = quest.add_item(session_id, name, body.get("qty", 1),
                          wild=bool(body.get("wild")))
    if sess is None:
        raise HTTPException(404, "no such session")
    return sess


@app.post("/api/quest/sessions/{session_id}/check")
async def quest_check(session_id: str, req: Request):
    body = await _json_obj(req)
    if not body.get("item"):
        raise HTTPException(400, "item is required")
    from api import quest
    checked = body.get("checked", True)
    sess = quest.check_item(session_id, body["item"], checked)
    if sess is None:
        raise HTTPException(404, "no such item in this session")
    # Album: a grab mints a sticker (a put back retracts one). Stickers
    # are garnish and must never fail a grab. The payload rides along
    # only for a first-time product.
    try:
        from api import stickers
        payload = await run_in_threadpool(
            stickers.on_check, sess, body["item"], bool(checked))
    except Exception:
        payload = None
    if payload:
        return {**sess, "new_sticker": payload}
    return sess


from api.album_routes import router as album_router  # noqa: E402
app.include_router(album_router)


@app.post("/api/quest/sessions/{session_id}/state")
async def quest_set_state(session_id: str, req: Request):
    body = await _json_obj(req)
    from api import quest
    try:
        sess = quest.set_state(session_id, body.get("state", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if sess is None:
        raise HTTPException(404, "no such session")
    return sess


@app.post("/api/quest/sessions/{session_id}/delete")
def quest_delete_session(session_id: str):
    """Remove a hunt from the player's history (Tranche 1) — a
    mistaken or duplicate hunt, or an unsettled one whose receipt
    is truly lost. Points recompute from what remains."""
    from api import quest
    if not quest.delete_session(session_id):
        raise HTTPException(404, "no such session")
    return {"ok": True, "deleted": session_id}


@app.post("/api/quest/scan-shelf")
async def scan_shelf_route(req: Request):
    """Shelf Scan (Discussion 37), the unmapped-store mode: one
    shelf photo against the session's REMAINING items. SAM 3.1
    proposes boxes from list-driven phrasings, Muse Spark verifies
    each candidate crop, only verified items pop (api/shelfscan.py
    carries the spike's three fixes). A frame is kept only after its
    people are scrubbed (below); the raw frame never is. The demo
    household's carve-out is the same live-door rule as the Photo
    door (see _DEMO_LIVE_DOORS)."""
    from api import quest, shelfscan
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a shelf photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    session_id = req.query_params.get("session", "")
    sess = quest.get_session(session_id) if session_id else None
    if sess is None:
        raise HTTPException(404, "no such session")
    remaining = [i["name"] for i in sess["items"] if not i["checked"]]
    # Find it for me: aim the scan at the one item the player is
    # after — one item's model calls, not the whole list's.
    target = (req.query_params.get("item") or "").strip()
    if target:
        remaining = [n for n in remaining if n == target]
    if not remaining:
        return {"pops": [], "not_found": [target] if target else []}
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = MetaClient(ledger=_ledger())
    try:
        out = await run_in_threadpool(shelfscan.scan, body, remaining,
                                      client, media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    # What was seen where feeds the store map. A frame that popped
    # an item is kept as a fresh shelf photo, but only once SAM 3.1
    # has found and pixelated every person in it (owner, 2026-10-28:
    # "we don't store images of people, only products"). Fail closed.
    pops = out.get("pops") or []
    quest.record_sightings(session_id, pops)
    if pops:
        jpeg, people = await run_in_threadpool(
            shelfscan.scrub_people, body, client, media_type=media)
        if jpeg:
            quest.keep_frame(session_id, pops, jpeg, people)
    return out


@app.get("/api/quest/shelf-photo")
def quest_shelf_photo(store: str = "", item: str = ""):
    """The freshest people-scrubbed shopper photo of one item's shelf
    in one store, with the verified box to highlight."""
    from api import quest
    rec = quest.shelf_photo(store, item)
    if rec is None:
        raise HTTPException(404, "no fresh photo yet")
    out = {k: v for k, v in rec.items() if k != "jpeg_b64"}
    out["image"] = "data:image/jpeg;base64," + rec["jpeg_b64"]
    return out


@app.post("/api/quest/locate")
async def locate_route(req: Request):
    """Where am I? — the hunt's position anchor. One photo is
    matched locally against the session store's walkthrough index
    (api/locate.py; the matcher is Wonder-authored, vendored in
    api/localizer.py). No model calls, nothing stored: the answer
    is a path fraction the client snaps to its nearest stop. The
    demo household may use it — position is ephemeral hunt state,
    like a collect (see _DEMO_LIVE_DOORS)."""
    from PIL import UnidentifiedImageError
    from api import locate, quest
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    session_id = req.query_params.get("session", "")
    sess = quest.get_session(session_id) if session_id else None
    if sess is None:
        raise HTTPException(404, "no such session")
    try:
        return await run_in_threadpool(locate.locate, body, sess)
    except UnidentifiedImageError:
        raise HTTPException(400, "could not read that photo")


@app.post("/api/quest/sessions/{session_id}/receipt")
async def quest_attach_receipt(session_id: str, req: Request):
    body = await _json_obj(req)
    receipt_id = body.get("receipt_id")
    if not receipt_id:
        raise HTTPException(400, "receipt_id is required")
    from api import quest
    if quest.get_session(session_id) is None:
        raise HTTPException(404, "no such session")
    try:
        sess = quest.attach_receipt(session_id, receipt_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if sess is None:
        raise HTTPException(404, "no such receipt")
    return quest.session_view(sess)


@app.post("/api/quest/sessions/{session_id}/sample-receipt")
def quest_sample_receipt(session_id: str):
    """Demo only: settle this hunt with a sample receipt for the
    trip (Hunt v2 plan item 8). Real accounts attach their own."""
    if not state.in_sandbox():
        raise HTTPException(403, "sample receipts are for the demo only")
    from api import quest
    try:
        sess = quest.sample_receipt(session_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if sess is None:
        raise HTTPException(404, "no such session")
    return sess


@app.post("/api/quest/optimize")
async def quest_optimize(req: Request):
    body = await _json_obj(req)
    items = body.get("items")
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "items is required")
    from api.optimizer import optimize
    return optimize(items, store=body.get("store"))


@app.post("/api/quest/shopoff")
async def quest_create_shopoff(req: Request):
    body = await _json_obj(req)
    store = (body.get("store") or "").strip()
    if not store:
        raise HTTPException(400, "store is required")
    from api import quest
    try:
        race = await run_in_threadpool(
            quest.create_shopoff, store, body.get("items") or [],
            body.get("opponent_handle", ""),
            client=MetaClient(ledger=_ledger()))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return race


@app.get("/api/quest/shopoff/{race_id}")
def quest_get_shopoff(race_id: str):
    from api import quest
    race = quest.get_shopoff(race_id)
    if race is None:
        raise HTTPException(404, "no such race")
    return race


@app.get("/api/quest/friends")
def quest_list_friends():
    from api import social
    return {"friends": social.list_friends()}


@app.get("/api/account/export")
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


@app.post("/api/feedback")
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


@app.get("/api/push/config")
def push_config(req: Request):
    from api import reminders
    if _is_demo(req):
        return {"enabled": False}
    return reminders.config()


@app.post("/api/push/subscribe")
async def push_subscribe(req: Request):
    r = _push_guard(req)
    body = await _json_obj(req)
    try:
        r.subscribe(body.get("subscription"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return r.config()


@app.post("/api/push/unsubscribe")
async def push_unsubscribe(req: Request):
    r = _push_guard(req)
    body = await _json_obj(req)
    r.unsubscribe(body.get("endpoint"))
    return r.config()


@app.post("/api/push/settings")
async def push_settings(req: Request):
    r = _push_guard(req)
    body = await _json_obj(req)
    try:
        r.set_notice_days(body.get("notice_days"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return r.config()


@app.post("/api/push/test")
def push_test(req: Request):
    r = _push_guard(req)
    if not r.config()["subscribed"]:
        raise HTTPException(400, "turn reminders on first")
    return {"sent": r.send(r.compose([], test=True))}


@app.get("/api/feedback")
def feedback_list():
    """Owner only: the first account reads what people sent."""
    from api import feedback
    if not feedback.is_owner(state._current_user.get()):
        raise HTTPException(403, "only the owner can read feedback")
    return {"notes": feedback.list_all()}


@app.post("/api/quest/friends")
async def quest_request_friend(req: Request):
    body = await _json_obj(req)
    from api import social
    try:
        friend = social.request_friend(body.get("handle", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return friend


@app.post("/api/quest/friends/accept")
async def quest_accept_friend(req: Request):
    body = await _json_obj(req)
    from api import social
    friend = social.accept_friend(body.get("handle", ""))
    if friend is None:
        raise HTTPException(404, "no pending request from that handle")
    return friend


@app.post("/api/quest/friends/remove")
async def quest_remove_friend(req: Request):
    body = await _json_obj(req)
    from api import social
    friend = social.remove_friend(body.get("handle", ""))
    if friend is None:
        raise HTTPException(404, "no friend or request with that handle")
    return {"ok": True, "removed": friend}


@app.get("/api/quest/avatar")
def quest_avatar():
    from api import avatar
    return avatar.get()


@app.get("/api/quest/avatar/image")
def quest_avatar_image(candidate: bool = False):
    from api import avatar
    img = avatar.read_image(candidate=candidate)
    if img is None:
        raise HTTPException(404, "no avatar image")
    return Response(img, media_type="image/webp",
                    headers={"Cache-Control": "no-cache"})


@app.post("/api/quest/avatar/generate")
async def quest_avatar_generate(req: Request):
    """One tap, one image ($0.01). No retries here: a try-again is the
    player's next tap."""
    from api import avatar
    body = await _json_obj(req)
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    try:
        await run_in_threadpool(avatar.make_from_prompt, body.get("prompt", ""),
                                MetaClient(ledger=_ledger()))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    return avatar.get()


@app.post("/api/quest/avatar/photo")
async def quest_avatar_photo(req: Request):
    """The player's own photo, drawn as a cartoon. The upload is read
    into memory, sent to Muse Image and dropped; it is never saved."""
    from api import avatar
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    photo = await req.body()
    if not photo:
        raise HTTPException(400, "empty upload")
    if len(photo) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    try:
        await run_in_threadpool(avatar.make_from_photo, photo, media,
                                MetaClient(ledger=_ledger()))
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    return avatar.get()


@app.post("/api/quest/share-look")
async def quest_share_look(req: Request, look: str = ""):
    """One paint pass for the haul card's art layer ($0.01). The body is
    the PNG; the answer is the painted WebP. Nothing is stored."""
    from api import sharelook
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if media != "image/png":
        raise HTTPException(415, "send the card art as image/png")
    art = await req.body()
    if look not in sharelook.LOOKS:
        raise HTTPException(400, "unknown look")
    if not art or len(art) > sharelook.MAX_BYTES:
        raise HTTPException(413, "card art must be under 4 MB")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    try:
        img, _ = await run_in_threadpool(sharelook.make, look, art,
                                         MetaClient(ledger=_ledger()))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    return Response(img, media_type="image/webp",
                    headers={"Cache-Control": "no-store"})


@app.post("/api/quest/avatar/use")
def quest_avatar_use():
    from api import avatar
    try:
        return avatar.use_candidate()
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/quest/news")
def quest_news():
    """Store news: stops people flagged as not here, newest first."""
    from api import quest
    return quest.store_news()


@app.get("/api/quest/profile")
def quest_profile():
    from api import social
    return social.profile()


@app.get("/api/quest/receipts")
def quest_receipt_archive():
    from api import social
    return {"receipts": social.receipt_archive(),
            "unsettled": social.unsettled_hunts()}


@app.get("/api/quest/receipts/{receipt_id}")
def quest_receipt_detail(receipt_id: str):
    from api import social
    detail = social.receipt_detail(receipt_id)
    if detail is None:
        raise HTTPException(404, "no such receipt")
    return detail


@app.get("/api/quest/receipts/{receipt_id}/original")
def quest_receipt_original(receipt_id: str):
    """The kept original upload for a filed receipt (Discussion
    42): the caller's own bytes, served at their recorded media
    type. The lookup runs over the caller's receipts — no
    cross-account access — and the demo files nothing. A
    receipt filed without an upload (seeded history, order
    text) has no original and 404s honestly."""
    rec = next((r for r in state.receipts()
                if r["receipt_id"] == receipt_id), None)
    if rec is None or not rec.get("image_ref"):
        raise HTTPException(404, "no original kept for this receipt")
    data = state.receipt_media(receipt_id)
    if data is None:
        raise HTTPException(404, "no original kept for this receipt")
    return Response(content=data,
                    media_type=rec.get("media_type")
                    or "application/octet-stream",
                    headers={"Content-Disposition": "inline"})


@app.post("/api/quest/receipts/{receipt_id}/delete")
def quest_delete_receipt(receipt_id: str):
    """Delete a filed receipt (Tranche 1): the record and its kept
    original go; hunts it settled return to unsettled; the ledger
    and patterns recompute from what remains."""
    from api import quest, state
    if state.in_sandbox():
        raise HTTPException(403, "the demo household files nothing")
    rec = state.delete_receipt(receipt_id)
    if rec is None:
        raise HTTPException(404, "no such receipt")
    quest.detach_receipt(receipt_id)
    return {"ok": True, "deleted": receipt_id}


@app.post("/api/quest/sessions/{session_id}/report-missing")
async def quest_report_missing(session_id: str, req: Request):
    body = await _json_obj(req)
    if not body.get("item"):
        raise HTTPException(400, "item is required")
    from api import quest, storemap
    try:
        rep = quest.report_missing(session_id, body["item"],
                                   body.get("kind", ""), body.get("photo"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if rep is None:
        raise HTTPException(404, "no such item in this session")
    # Map my store: a "not found" also flags the part of the map where
    # the item was last seen, and answers with the capture to ask for.
    task = storemap.flag_outdated(rep["store"], item=rep["item"],
                                  reason="not_found")
    return {**rep, "map_task": task}


@app.get("/api/quest/stores/{store}/reports")
def quest_store_reports(store: str):
    from api import quest
    return quest.store_reports(store)


from api import hunt_routes
app.include_router(hunt_routes.router)


@app.post("/api/quest/avatar")
async def quest_set_avatar(req: Request):
    body = await _json_obj(req)
    from api import quest
    saved = quest.set_avatar((body.get("file") or "").strip())
    if saved is None:
        raise HTTPException(400, "pick one of the cast portraits")
    return {"avatar": saved}


@app.get("/api/quest/sos-count")
def quest_sos_count(store: str = "", item: str = ""):
    from api import quest
    return quest.sos_count(store, item)


@app.post("/api/quest/haul-photo")
async def quest_haul_photo(req: Request, session: str = ""):
    """Snap your haul: one Eyes read of the haul photo, matched
    against the hunt by quest.haul_check. The read is saved on the
    session; the photo itself is never stored."""
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    from api import quest
    if quest.get_session(session) is None:
        raise HTTPException(404, "no such session")
    _budget_guard(demo=_is_demo(req))
    from api.eyes.service import detect
    client = MetaClient(ledger=_ledger())
    try:
        sightings = await run_in_threadpool(detect, body, client,
                                            media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    out = quest.haul_check(session, sightings)
    if out is None:
        raise HTTPException(404, "no such session")
    return out


# --- Map my store: the guided, crowd-built store map -----------------------
# See api/storemap.py. One shared map per store; a shopper maps the
# aisles they use, and every shopper's captures merge into it.

def _map_store(value):
    name = (value or "").strip()
    if not name:
        raise HTTPException(400, "store is required")
    return name


@app.get("/api/storemap")
def storemap_view(store: str = ""):
    from api import storemap
    name = _map_store(store)
    focus = storemap.get_focus(name)
    return {**storemap.view(name, focus=focus), "focus": focus}


@app.post("/api/storemap/segments")
async def storemap_add_segment(req: Request):
    from api import storemap
    body = await _json_obj(req)
    try:
        seg, created = storemap.add_segment(
            _map_store(body.get("store")), body.get("label"),
            body.get("side") or "both")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"segment": seg["id"], "label": seg["label"],
            "side": seg["side"], "created": created}


@app.post("/api/storemap/focus")
async def storemap_set_focus(req: Request):
    from api import storemap
    body = await _json_obj(req)
    name = _map_store(body.get("store"))
    ids = body.get("segments")
    if not isinstance(ids, list):
        raise HTTPException(400, "segments must be a list")
    return {"focus": storemap.set_focus(name, [str(i) for i in ids])}


@app.get("/api/storemap/next")
def storemap_next(store: str = "", segment: str = "", items: str = ""):
    from api import storemap
    name = _map_store(store)
    prompt = storemap.next_prompt(
        name, focus=storemap.get_focus(name), seg_id=segment or None,
        hint_items=[i for i in items.split(",") if i.strip()][:30])
    return {"prompt": prompt}


@app.post("/api/storemap/outdated")
async def storemap_outdated(req: Request):
    """"The map is outdated": flag a segment (or the segment of an
    item) and answer with the capture the engine wants."""
    from api import storemap
    body = await _json_obj(req)
    return storemap.flag_outdated(
        _map_store(body.get("store")), seg_id=body.get("segment"),
        item=body.get("item"), reason=body.get("reason") or "outdated")


@app.get("/api/storemap/photo")
def storemap_photo(store: str = "", segment: str = ""):
    """The segment's best kept photo (people already scrubbed), or the
    walkthrough frame a seeded segment started from."""
    from api import storemap
    name = _map_store(store)
    data = storemap.best_image(name, segment)
    if data is not None:
        return Response(content=data, media_type="image/jpeg")
    frame = storemap.baseline_frame(name, segment)
    if frame and storemap.store_key(name) == storemap.store_key("Trader Joe's"):
        path = os.path.join(_PWA, "models", "trader-joes", "frames-web", frame)
        if os.path.isfile(path):
            with open(path, "rb") as fh:
                return Response(content=fh.read(), media_type="image/jpeg")
    raise HTTPException(404, "no photo for this part of the map yet")


@app.post("/api/storemap/capture")
async def storemap_capture(req: Request):
    """One guided capture: a photo, or one frame the app picked from a
    walk video. The frame goes through the SAM 3.1 people scrub first
    and fails closed; then the engine grades it, drops it if it
    repeats a better view, and keeps the best few per segment. A weak
    capture is refused with a one-line fix to retake."""
    from api import shelfscan, storemap
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    name = _map_store(req.query_params.get("store"))
    seg_id = req.query_params.get("segment", "")
    kind = req.query_params.get("kind", "photo")
    if seg_id not in storemap.load_map(name)["segments"]:
        raise HTTPException(404, "no such part of the map")
    try:
        storemap.score_image(body)
    except Exception:
        raise HTTPException(400, "that file is not a readable photo")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = MetaClient(ledger=_ledger())
    jpeg, people = await run_in_threadpool(
        shelfscan.scrub_people, body, client, media_type=media)
    if jpeg is None:
        raise HTTPException(
            503, "could not blur people out of the photo, so nothing was kept")
    # Shelf fill: live SAM returns one box per shelf bay, so fill is
    # the SUM of the box areas (capped at 1), not the largest box. It
    # is measured on the scrubbed JPEG, so no raw frame is sent twice.
    fill = None
    try:
        boxes, _u, _c = await run_in_threadpool(
            client.segment, jpeg, "grocery shelf", media_type="image/jpeg")
        if boxes:
            from PIL import Image
            import io
            w, h = Image.open(io.BytesIO(jpeg)).size
            fill = min(1.0, sum((b["box"][2] - b["box"][0])
                                * (b["box"][3] - b["box"][1])
                                for b in boxes) / float(w * h))
    except Exception:
        fill = None   # neutral: the fill check never blocks a capture
    try:
        out = storemap.ingest(name, seg_id, jpeg, kind=kind,
                              shelf_fill=fill, people=people)
    except ValueError as e:
        raise HTTPException(400, str(e))
    out["reward"] = storemap.award(name, out)
    return out


@app.post("/api/storemap/teach")
async def storemap_teach(req: Request):
    """Zero-entry teach (owner, 2026-10-28: "no user is going to
    enter data"). One frame with NO segment named: the people scrub
    runs first, the section reader names what the scrubbed frame
    shows, that section is found-or-created (both sides — the
    shopper never picks one), and the frame lands in it like any
    guided capture. The walk sends its sharpest frames one by one;
    sections the reader gets wrong come back out through the
    confirm card's discard, while they are still the teacher's own.
    """
    from api import mapread, shelfscan, storemap
    media = (req.headers.get("content-type") or "").split(";")[0].strip()
    if not media.startswith("image/"):
        raise HTTPException(415, "send a photo (image)")
    body = await req.body()
    if not body:
        raise HTTPException(400, "empty upload")
    if len(body) > 12_000_000:
        raise HTTPException(413, "photo too large (12 MB max)")
    name = _map_store(req.query_params.get("store"))
    kind = req.query_params.get("kind", "walk")
    if kind not in storemap.KINDS:
        raise HTTPException(400, "kind must be photo or walk")
    try:
        storemap.score_image(body)
    except Exception:
        raise HTTPException(400, "that file is not a readable photo")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    demo = _is_demo(req)
    _budget_guard(demo=demo)
    client = MetaClient(ledger=_ledger())
    jpeg, people = await run_in_threadpool(
        shelfscan.scrub_people, body, client, media_type=media)
    if jpeg is None:
        raise HTTPException(
            503, "could not blur people out of the photo, so nothing was kept")
    try:
        read = await run_in_threadpool(mapread.read_section, client, jpeg)
    except ValueError as e:
        raise HTTPException(422, str(e))
    if not read["label"]:
        raise HTTPException(422, "no shelf in that frame — nothing kept")
    try:
        seg, created = storemap.add_segment(name, read["label"], "both")
    except ValueError as e:
        raise HTTPException(400, str(e))
    fill = None
    try:
        boxes, _u, _c = await run_in_threadpool(
            client.segment, jpeg, "grocery shelf", media_type="image/jpeg")
        if boxes:
            from PIL import Image
            import io
            w, h = Image.open(io.BytesIO(jpeg)).size
            fill = min(1.0, sum((b["box"][2] - b["box"][0])
                                * (b["box"][3] - b["box"][1])
                                for b in boxes) / float(w * h))
    except Exception:
        fill = None   # neutral: the fill check never blocks a capture
    try:
        out = storemap.ingest(name, seg["id"], jpeg, kind=kind,
                              shelf_fill=fill, people=people)
    except ValueError as e:
        raise HTTPException(400, str(e))
    for item in read["items"]:
        storemap.note_sighting(name, item, read["label"])
    out.update({"label": seg["label"], "created": created,
                "items": read["items"]})
    out["reward"] = storemap.award(name, out)
    return out


@app.post("/api/storemap/discard")
async def storemap_discard(req: Request):
    """The confirm card's "Not a section": retract a section the
    signed-in shopper just taught, while it is still only theirs."""
    from api import storemap
    body = await _json_obj(req)
    try:
        label = storemap.discard_segment(
            _map_store(body.get("store")), str(body.get("segment") or ""))
    except KeyError:
        raise HTTPException(404, "no such part of the map")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"removed": True, "label": label}


@app.post("/api/storemap/split")
async def storemap_split(req: Request):
    """The app timed a walk and asks for the aisle to be split into
    sections. Idempotent: an already-split aisle returns its sections."""
    from api import storemap
    body = await _json_obj(req)
    try:
        kids, created = storemap.split_segment(
            _map_store(body.get("store")), str(body.get("segment") or ""),
            body.get("parts"))
    except KeyError:
        raise HTTPException(404, "no such part of the map")
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"created": created,
            "segments": [{"id": k["id"], "label": k["label"]} for k in kids]}


from api import haul_routes  # noqa: E402  (HAUL slice: review, card, Crew)
app.include_router(haul_routes.router)

_PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")
if os.path.isdir(_PWA):
    app.mount("/", StaticFiles(directory=_PWA, html=True), name="pwa")
