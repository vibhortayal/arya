"""Arya API — FastAPI entry point.
All Meta calls go through api.meta_client; all money math is code."""
import hashlib, json, os
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
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


def _budget_guard():
    """Stage 6 hardening: a daily ceiling on model spend (default $10),
    far above real household use, bounding any single bad day."""
    cap = float(os.environ.get("ARYA_DAILY_BUDGET_USD", "10"))
    if CostLedger(_LEDGER).spent_today() >= cap:
        raise HTTPException(503, "daily model budget reached — Arya pauses paid reads until tomorrow")

_OPEN_PREFIXES = ("/health", "/auth/", "/sw.js", "/manifest.json", "/icon.svg", "/styles.css", "/app.js", "/index.html", "/")


@app.middleware("http")
async def require_login(request, call_next):
    path = request.url.path
    protected = path.startswith(("/api/", "/import", "/decode", "/eyes"))
    if protected:
        info = None
        authz = request.headers.get("authorization", "")
        if authz.startswith("Bearer "):
            user = auth.api_token_user(authz[7:])
            if user:
                info = {"user": user, "demo": False}
        if not info:
            info = auth.session_info(request.cookies.get(auth.COOKIE))
        if not info:
            return JSONResponse({"detail": "login required"}, status_code=401)
        if info["demo"] and request.method != "GET":
            return JSONResponse({"detail": "the demo household is read-only"}, status_code=403)
        state.set_current_user(info["user"])
    return await call_next(request)


def _set_session_cookie(resp, token):
    resp.set_cookie(auth.COOKIE, token, httponly=True, samesite="lax",
                    secure=os.environ.get("ARYA_INSECURE_COOKIE") != "1",
                    max_age=auth.SESSION_TTL)
    return resp


@app.get("/auth/status")
def auth_status():
    return {"has_users": len(auth.users()) > 0}


@app.post("/auth/setup")
async def auth_setup(req: Request):
    if len(auth.users()) > 0:
        raise HTTPException(403, "setup is closed; an account already exists")
    body = await req.json()
    try:
        name = auth.create_user(body.get("username", ""), body.get("password", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _set_session_cookie(JSONResponse({"user": name}), auth.new_session(name))


@app.post("/auth/login")
async def auth_login(req: Request):
    import time as _t
    ip = (req.headers.get("x-forwarded-for") or (req.client.host if req.client else "?")).split(",")[0].strip()
    fails = [t for t in _login_fails.get(ip, []) if _t.time() - t < 900]
    if len(fails) >= 8:
        raise HTTPException(429, "too many sign-in attempts — wait 15 minutes")
    body = await req.json()
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
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info:
        raise HTTPException(401, "login required")
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
def auth_demo():
    return _set_session_cookie(JSONResponse({"user": "demo", "demo": True}),
                               auth.new_session("demo", demo=True))


@app.get("/health")
def health():
    return {"status": "ok", "service": "arya-api", "stage": 3, "receipts": len(state.receipts())}


@app.post("/import/costco-json")
async def import_costco_json(req: Request):
    obj = await req.json()
    if not isinstance(obj, dict) or "itemArray" not in obj:
        raise HTTPException(422, "not a Costco warehouse receipt object")
    dec = normalize_costco_json(obj)
    state.add_receipts([dec])
    state.judge_pending(MetaClient(ledger=CostLedger(_LEDGER)))
    return dec


@app.post("/import/costco-json-bulk")
async def import_bulk(req: Request):
    objs = await req.json()
    if not isinstance(objs, list):
        raise HTTPException(422, "expected a list of Costco receipt objects")
    decs = [normalize_costco_json(o) for o in objs if isinstance(o, dict) and "itemArray" in o]
    added = state.add_receipts(decs)
    state.judge_pending(MetaClient(ledger=CostLedger(_LEDGER)))
    return {"received": len(decs), "added": added, "total_receipts": len(state.receipts())}


@app.post("/decode/text")
async def decode_text_route(req: Request):
    body = await req.json()
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    client = MetaClient(ledger=CostLedger(_LEDGER))
    dec = decode_text(body.get("text", ""), client)
    state.add_receipts([dec])
    state.judge_pending(MetaClient(ledger=CostLedger(_LEDGER)))
    return dec


@app.post("/api/intake/order-text")
async def intake_order_text(req: Request):
    """A pasted online order (Instacart, Amazon Fresh, ...) becomes a
    receipt through the same verify-and-queue path as a photo."""
    body = await req.json()
    text = body.get("text", "")
    if len(text.strip()) < 20:
        raise HTTPException(422, "paste the order confirmation text")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    client = MetaClient(ledger=CostLedger(_LEDGER))
    dec = decode_order_text(text, client)
    state.add_receipts([dec])
    state.judge_pending(MetaClient(ledger=CostLedger(_LEDGER)))
    return {"receipt_id": dec["receipt_id"], "merchant": dec["merchant"],
            "purchased_at": dec["purchased_at"], "lines": len(dec["lines"]),
            "total": dec["total"], "totals_reconcile": dec["totals_reconcile"]}


@app.post("/api/intake/structured")
async def intake_structured(req: Request):
    """A receipt already read by the user's own Muse. Arya spends no
    tokens on perception here: it verifies the arithmetic, assigns line
    statuses by confidence, and queues what does not verify — the client
    proposes, Arya disposes."""
    body = await req.json()
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
    state.judge_pending(MetaClient(ledger=CostLedger(_LEDGER)))
    return {"receipt_id": rid, "merchant": dec["merchant"], "added": added,
            "lines": len(lines), "totals_reconcile": reconcile,
            "unverified": sum(1 for l in lines if l["status"] != "auto")}


@app.post("/api/review/suggest")
async def review_suggest(req: Request):
    """Researched candidates for an unresolved item, posted by the
    user's Muse (the Resolver loop). Candidates carry their source;
    settling still takes the user's word."""
    body = await req.json()
    if body.get("receipt_id"):
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(422, "a line suggestion needs a name")
        if not state.suggest_line(body["receipt_id"], int(body.get("idx", -1)),
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
    n = run_curator(MetaClient(ledger=CostLedger(_LEDGER)))
    return {"proposals": n}


@app.get("/api/curator")
def curator_pending():
    from api.curator import pending
    return {"proposals": pending()}


@app.post("/api/curator/decide")
async def curator_decide(req: Request):
    body = await req.json()
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
    return {"as_of": state.as_of(), "running_low": low,
            "list": d["smart_list"], "cart": state.get_cart(),
            "seen": seen, "checks": checks}


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
        text = extract_pdf_text(body)
    except Exception:
        raise HTTPException(422, "could not read this PDF")
    if len(text.strip()) < 20:
        raise HTTPException(422, "no text layer in this PDF — scanned receipts use the photo path, which opens after verification")
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    _budget_guard()
    client = MetaClient(ledger=CostLedger(_LEDGER))
    receipt = decode_text(text, client)
    added = state.add_receipts([receipt])
    state.judge_pending(MetaClient(ledger=CostLedger(_LEDGER)))
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
    _budget_guard()
    client = MetaClient(ledger=CostLedger(_LEDGER))
    try:
        receipt = decode_photo(body, client, media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    added = state.add_receipts([receipt])
    state.judge_pending(MetaClient(ledger=CostLedger(_LEDGER)))
    return {"added": added, "total_receipts": len(state.receipts()), "receipt": receipt}


@app.post("/eyes/photo")
async def eyes_photo(req: Request, kind: str = "fridge"):
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
    client = MetaClient(ledger=CostLedger(_LEDGER))
    try:
        sightings = detect(body, client, media_type=media)
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
    body = await req.json()
    decision = body.get("state")
    if decision not in ("confirmed", "rejected"):
        raise HTTPException(400, "state must be confirmed or rejected")
    for rec in state.eyes_records():
        if rec["id"] == rec_id:
            if idx >= len(rec["sightings"]):
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
    body = await req.json()
    from api.chat_service import chat as run_chat
    client = MetaClient(ledger=CostLedger(_LEDGER))
    try:
        return run_chat(body.get("messages", []), client)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])


@app.post("/api/cart/approve")
def approve_route():
    cart = approve(state.get_cart())
    state.save_cart(cart)
    return cart


@app.post("/api/items/{item_id}/flag")
async def flag_route(item_id: str, req: Request):
    body = await req.json()
    merged = dict(state.flags().get(item_id, {}))
    merged.update(body)
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
    client = MetaClient(ledger=CostLedger(_LEDGER))
    return {"judged": state.judge_pending(client)}


@app.post("/api/list/add")
async def list_add(req: Request):
    body = await req.json()
    item_id = body.get("item_id")
    if not item_id and body.get("name"):
        import re as _re
        item_id = "manual-" + _re.sub(r"[^a-z0-9]+", "-", body["name"].strip().lower()).strip("-")
        _merge_flag(item_id, {"manual": True, "name": body["name"].strip(), "dismissed_on": None})
        return {"item_id": item_id}
    if not item_id:
        raise HTTPException(400, "item_id or name is required")
    _merge_flag(item_id, {"manual": True, "dismissed_on": None})
    return {"item_id": item_id}


@app.post("/api/list/remove")
async def list_remove(req: Request):
    body = await req.json()
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(400, "item_id is required")
    _merge_flag(item_id, {"manual": False, "dismissed_on": state.as_of()})
    return {"ok": True}


@app.post("/api/list/qty")
async def list_qty(req: Request):
    body = await req.json()
    qty = max(1, int(body.get("qty") or 1))
    _merge_flag(body.get("item_id"), {"qty_override": qty})
    return {"ok": True}


@app.post("/api/list/check")
async def list_check(req: Request):
    body = await req.json()
    _merge_flag(body.get("item_id"),
                {"checked_on": state.as_of() if body.get("checked") else None})
    return {"ok": True}


@app.post("/api/list/check-ok")
async def list_check_ok(req: Request):
    body = await req.json()
    if not body.get("item_id"):
        raise HTTPException(400, "item_id is required")
    _merge_flag(body["item_id"], {"check_ok": state.as_of()})
    return {"ok": True}


@app.post("/api/review/line")
async def review_line(req: Request):
    body = await req.json()
    action = body.get("action")
    if action == "confirm":
        line = state.update_receipt_line(body["receipt_id"], int(body["idx"]), {"status": "auto"})
    elif action == "rename":
        name = (body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "name is required to rename")
        line = state.update_receipt_line(body["receipt_id"], int(body["idx"]),
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
    body = await req.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    entry = state.resolve_dictionary(body.get("item_id"), name)
    if entry is None:
        raise HTTPException(404, "no such item")
    return {"ok": True}


# --- Arya Quest (Stage A): sessions, optimizer, Shop-Off, social ---

@app.post("/api/quest/sessions")
async def quest_create_session(req: Request):
    body = await req.json()
    store = (body.get("store") or "").strip()
    if not store:
        raise HTTPException(400, "store is required")
    from api import quest
    try:
        sess = quest.create_session(store, body.get("mode") or "quest",
                                    body.get("items") or [])
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
    return sess


@app.post("/api/quest/sessions/{session_id}/items")
async def quest_add_item(session_id: str, req: Request):
    body = await req.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    from api import quest
    sess = quest.add_item(session_id, name, body.get("qty", 1))
    if sess is None:
        raise HTTPException(404, "no such session")
    return sess


@app.post("/api/quest/sessions/{session_id}/check")
async def quest_check(session_id: str, req: Request):
    body = await req.json()
    if not body.get("item"):
        raise HTTPException(400, "item is required")
    from api import quest
    sess = quest.check_item(session_id, body["item"], body.get("checked", True))
    if sess is None:
        raise HTTPException(404, "no such item in this session")
    return sess


@app.post("/api/quest/sessions/{session_id}/state")
async def quest_set_state(session_id: str, req: Request):
    body = await req.json()
    from api import quest
    try:
        sess = quest.set_state(session_id, body.get("state", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if sess is None:
        raise HTTPException(404, "no such session")
    return sess


@app.post("/api/quest/sessions/{session_id}/receipt")
async def quest_attach_receipt(session_id: str, req: Request):
    body = await req.json()
    receipt_id = body.get("receipt_id")
    if not receipt_id:
        raise HTTPException(400, "receipt_id is required")
    from api import quest
    if quest.get_session(session_id) is None:
        raise HTTPException(404, "no such session")
    sess = quest.attach_receipt(session_id, receipt_id)
    if sess is None:
        raise HTTPException(404, "no such receipt")
    return sess


@app.post("/api/quest/optimize")
async def quest_optimize(req: Request):
    body = await req.json()
    items = body.get("items")
    if not isinstance(items, list) or not items:
        raise HTTPException(400, "items is required")
    from api.optimizer import optimize
    return optimize(items, store=body.get("store"))


@app.post("/api/quest/shopoff")
async def quest_create_shopoff(req: Request):
    body = await req.json()
    store = (body.get("store") or "").strip()
    if not store:
        raise HTTPException(400, "store is required")
    from api import quest
    try:
        race = quest.create_shopoff(store, body.get("items") or [],
                                    body.get("opponent_handle", ""))
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


@app.post("/api/quest/friends")
async def quest_request_friend(req: Request):
    body = await req.json()
    from api import social
    try:
        friend = social.request_friend(body.get("handle", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return friend


@app.post("/api/quest/friends/accept")
async def quest_accept_friend(req: Request):
    body = await req.json()
    from api import social
    friend = social.accept_friend(body.get("handle", ""))
    if friend is None:
        raise HTTPException(404, "no pending request from that handle")
    return friend


@app.get("/api/quest/profile")
def quest_profile():
    from api import social
    return social.profile()


_PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")
if os.path.isdir(_PWA):
    app.mount("/", StaticFiles(directory=_PWA, html=True), name="pwa")
