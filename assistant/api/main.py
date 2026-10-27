"""Arya API — FastAPI entry point.
All Meta calls go through api.meta_client; all money math is code."""
import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from api import state, auth
from api.decode.service import decode_photo, decode_text, extract_pdf_text, normalize_costco_json
from api.meta_client import MetaClient
from api.cost_ledger import CostLedger
from api.cart.build import approve

app = FastAPI(title="Arya API")
_LEDGER = os.path.join(os.path.dirname(__file__), "..", "loops", "cost-ledger.jsonl")

_OPEN_PREFIXES = ("/health", "/auth/", "/sw.js", "/manifest.json", "/icon.svg", "/styles.css", "/app.js", "/index.html", "/")


@app.middleware("http")
async def require_login(request, call_next):
    path = request.url.path
    protected = path.startswith(("/api/", "/import", "/decode"))
    if protected:
        user = auth.session_user(request.cookies.get(auth.COOKIE))
        if not user:
            return JSONResponse({"detail": "login required"}, status_code=401)
        state.set_current_user(user)
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
    body = await req.json()
    name = (body.get("username") or "").strip().lower()
    if not auth.verify(name, body.get("password", "")):
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
    user = auth.session_user(req.cookies.get(auth.COOKIE))
    if not user:
        raise HTTPException(401, "login required")
    return {"user": user}


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
    return dec


@app.post("/import/costco-json-bulk")
async def import_bulk(req: Request):
    objs = await req.json()
    if not isinstance(objs, list):
        raise HTTPException(422, "expected a list of Costco receipt objects")
    decs = [normalize_costco_json(o) for o in objs if isinstance(o, dict) and "itemArray" in o]
    added = state.add_receipts(decs)
    return {"received": len(decs), "added": added, "total_receipts": len(state.receipts())}


@app.post("/decode/text")
async def decode_text_route(req: Request):
    body = await req.json()
    if not os.environ.get("MODEL_API_KEY"):
        raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")
    client = MetaClient(ledger=CostLedger(_LEDGER))
    dec = decode_text(body.get("text", ""), client)
    state.add_receipts([dec])
    return dec


@app.get("/api/home")
def home():
    d = state.derived()
    nm = state.names()
    low = [{"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
            "due_window": p["due_window"], "reason": p["due_reason"] if "due_reason" in p else
            f"every ~{p['median_interval_days']:.0f} days; last bought {p['days_since_last']} days ago"}
           for p in d["patterns"] if p["due"] and p["purchase_count"] >= 3]
    return {"as_of": state.as_of(), "running_low": low,
            "list": d["smart_list"], "cart": state.get_cart()}


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
    client = MetaClient(ledger=CostLedger(_LEDGER))
    receipt = decode_text(text, client)
    added = state.add_receipts([receipt])
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
    client = MetaClient(ledger=CostLedger(_LEDGER))
    try:
        receipt = decode_photo(body, client, media_type=media)
    except RuntimeError as e:
        raise HTTPException(502, str(e)[:200])
    added = state.add_receipts([receipt])
    return {"added": added, "total_receipts": len(state.receipts()), "receipt": receipt}


@app.post("/api/cart/approve")
def approve_route():
    cart = approve(state.get_cart())
    state.save_cart(cart)
    return cart


@app.post("/api/items/{item_id}/flag")
async def flag_route(item_id: str, req: Request):
    body = await req.json()
    state.set_flag(item_id, body)
    return {"item_id": item_id, "flags": body}


_PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")
if os.path.isdir(_PWA):
    app.mount("/", StaticFiles(directory=_PWA, html=True), name="pwa")
