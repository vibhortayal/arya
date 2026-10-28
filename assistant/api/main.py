"""Arya API — FastAPI entry point.
All Meta calls go through api.meta_client; all money math is code.

Event-loop rule (review 2026-10-28, H1): MetaClient is blocking
urllib with timeouts up to 120 s, so no route may call a model —
or judge_pending, which calls the judge — on the event loop.
Model work runs through run_in_threadpool; a slow photo read then
stalls one worker thread, never every other request."""
import datetime, hashlib, json, math, os
from collections import OrderedDict
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from api import state, auth
from api.decode.service import decode_order_text, decode_photo, decode_text, extract_pdf_text, normalize_costco_json
from api.meta_client import MetaClient
from api.cost_ledger import CostLedger
from api.cart.build import approve

app = FastAPI(title="Arya API")
# The cost ledger is an operator artifact: it lives in the data root so it
# survives container redeploys (the app layer is ephemeral; /app/data is not).
_LEDGER = os.path.join(os.environ.get(
    "ARYA_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data")),
    "cost-ledger.jsonl")

_login_fails = {}
_register_hits = {}


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
        cap = float(os.environ.get("ARYA_DEMO_DAILY_BUDGET_USD", "2"))
        spent = CostLedger(_LEDGER).spent_today("demo")
    else:
        cap = float(os.environ.get("ARYA_DAILY_BUDGET_USD", "10"))
        spent = CostLedger(_LEDGER).spent_today("app")
    if spent >= cap:
        raise HTTPException(503, "daily model budget reached — Arya pauses paid reads until tomorrow")


def _ledger():
    """The cost ledger for this request: demo sandbox calls spend from
    the demo bucket, everything else from the app bucket."""
    return CostLedger(_LEDGER, bucket="demo" if state.in_sandbox() else "app")


# Per-IP sliding-window caps on the demo's unauthenticated surface:
# session minting and the live doors. Generous for a human judge,
# a hard stop for a script (review 2026-10-28, H4).
_demo_auth_hits = {}
_demo_door_hits = {}


def _demo_rate(bucket, key, limit_env, default):
    import time as _t
    limit = int(os.environ.get(limit_env, str(default)))
    now = _t.time()
    hits = [t for t in bucket.get(key, []) if now - t < 3600]
    if len(hits) >= limit:
        return False
    bucket[key] = hits + [now]
    return True

_OPEN_PREFIXES = ("/health", "/auth/", "/sw.js", "/manifest.json", "/icon.svg", "/styles.css", "/app.js", "/scene.js", "/quest.js", "/index.html", "/")

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
                "/api/quest/avatar/photo", "/api/feedback")
# Doors that can call the Meta API: the per-IP live-door cap applies.
_DEMO_LIVE_DOORS = ("/decode/photo", "/api/transcribe",
                    "/api/list/from-photo", "/api/list/from-text",
                    "/api/quest/scan-shelf", "/api/quest/locate",
                    "/api/chat", "/api/quest/sessions", "/api/quest/shopoff",
                    "/api/storemap")
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
                if path.startswith(_DEMO_LIVE_DOORS) and not _demo_rate(
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
            "registration_open": _registration_open()}


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
    fails = [t for t in _login_fails.get(ip, []) if _t.time() - t < 900]
    if len(fails) >= 8:
        raise HTTPException(429, "too many sign-in attempts — wait 15 minutes")
    body = await _json_obj(req)
    name = (body.get("username") or "").strip().lower()
    if not auth.verify(name, body.get("password", "")):
        _login_fails[ip] = fails + [_t.time()]
        raise HTTPException(401, "wrong username or password")
    return _set_session_cookie(JSONResponse({"user": name}), auth.new_session(name))


@app.post("/auth/logout")
async def auth_logout(req: Request):
    auth.drop_session(req.cookies.get(auth.COOKIE))
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
    return {"status": "ok", "service": "arya-api", "stage": 3, "receipts": len(state.receipts())}


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
    return {"receipt_id": rid, "merchant": dec["merchant"], "added": added,
            "lines": len(lines), "totals_reconcile": reconcile,
            "unverified": sum(1 for l in lines if l["status"] != "auto")}


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
            from datetime import date as _d
            age = (_d.fromisoformat(state.as_of()) - _d.fromisoformat(p["last_bought"])).days
            if age >= prior:
                _lb = p["last_bought"]
                checks.append({"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
                               "text": f"{nm.get(p['item_id'], p['item_id'])} from {_MON[int(_lb[5:7]) - 1]} {int(_lb[8:10])} usually turns about now — still good?"})
    low = [{"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
            "judge_reason": (p.get("judge") or {}).get("reason", ""),
            "due_window": p["due_window"], "reason": p["due_reason"] if "due_reason" in p else
            f"every ~{p['median_interval_days']:.0f} days; last bought {p['days_since_last']} days ago"}
           for p in d["patterns"] if p["due"] and p["purchase_count"] >= 3 and p.get("admitted")]
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
    return {"as_of": state.as_of(), "running_low": low,
            "list": d["smart_list"], "cart": state.get_cart(),
            "seen": seen, "checks": checks, "price_by_store": pbs}


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
    lst = [{"item_id": gm.get(i.get("item_id"), i.get("item_id")),
            "name": i.get("name") or nm.get(i.get("item_id"), ""),
            "qty": i.get("qty") or 1}
           for i in d["smart_list"]["items"] if not i.get("checked")]
    return {"list": lst, "items": items}


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
    client = MetaClient(ledger=CostLedger(
        _LEDGER, bucket="demo" if demo else "app"))
    try:
        receipt = await run_in_threadpool(decode_photo, body, client,
                                          media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
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
    client = MetaClient(ledger=CostLedger(
        _LEDGER, bucket="demo" if demo else "app"))
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
        return await run_in_threadpool(run_chat, body.get("messages", []), client)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])


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
              "name"}


@app.post("/api/items/{item_id}/flag")
async def flag_route(item_id: str, req: Request):
    body = await _json_obj(req)
    updates = {k: v for k, v in body.items() if k in _FLAG_KEYS}
    if not updates:
        raise HTTPException(400, "no recognized flag fields")
    merged = dict(state.flags().get(item_id, {}))
    merged.update(updates)
    state.set_flag(item_id, merged)
    return {"item_id": item_id, "flags": merged}


def _merge_flag(item_id, fields):
    merged = dict(state.flags().get(item_id, {}))
    merged.update(fields)
    state.set_flag(item_id, merged)
    return merged


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
    client = MetaClient(ledger=_ledger())
    return {"judged": state.judge_pending(client)}


def _add_name_to_list(name):
    """A typed/pasted/read name joins the list as a manual item —
    the one add path every Add surface shares."""
    import re as _re
    name = (name or "").strip()
    item_id = "manual-" + _re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    _merge_flag(item_id, {"manual": True, "name": name,
                          "dismissed_on": None})
    return {"item_id": item_id, "name": name}


@app.post("/api/list/add")
async def list_add(req: Request):
    body = await _json_obj(req)
    item_id = body.get("item_id")
    if not item_id and body.get("name"):
        return {"item_id": _add_name_to_list(body["name"])["item_id"]}
    if not item_id:
        raise HTTPException(400, "item_id or name is required")
    _merge_flag(item_id, {"manual": True, "dismissed_on": None})
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
    from api.list.intake import split_list_text, extract_items_model
    names = split_list_text(text)
    source = "split"
    if not names:
        if not os.environ.get("MODEL_API_KEY"):
            raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
        _budget_guard()
        client = MetaClient(ledger=_ledger())
        names = extract_items_model(text, client)
        source = "model"
    added = [_add_name_to_list(n) for n in names]
    return {"added": len(added), "names": [a["name"] for a in added],
            "source": source}


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
    client = MetaClient(ledger=CostLedger(
        _LEDGER, bucket="demo" if demo else "app"))
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
    _merge_flag(item_id, {"qty_override": max(1, qty)})
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
        sess = await run_in_threadpool(
            quest.create_session, store, body.get("mode") or "quest",
            body.get("items") or [],
            driver=body.get("driver") or "strip",
            store_id=store_id, store_address=store_address,
            client=MetaClient(ledger=_ledger()))
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
    sess = quest.check_item(session_id, body["item"], body.get("checked", True))
    if sess is None:
        raise HTTPException(404, "no such item in this session")
    return sess


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
    client = MetaClient(ledger=CostLedger(
        _LEDGER, bucket="demo" if demo else "app"))
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
    client = MetaClient(ledger=CostLedger(
        _LEDGER, bucket="demo" if _is_demo(req) else "app"))
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
    client = MetaClient(ledger=CostLedger(
        _LEDGER, bucket="demo" if demo else "app"))
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


_PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")
if os.path.isdir(_PWA):
    app.mount("/", StaticFiles(directory=_PWA, html=True), name="pwa")
