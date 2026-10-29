"""Sign-in, sessions, API tokens and account deletion."""
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from api import auth, supabase_auth
from api.demo_guard import _demo_auth_hits, _demo_rate
from api.deps import (_client_ip, _code_hits, _json_obj, _login_fails, _prune, _register_hits, _registration_open,
                      _set_session_cookie, _verify_hits)

router = APIRouter()


@router.get("/auth/status")
def auth_status():
    return {"has_users": len(auth.users()) > 0,
            "registration_open": _registration_open(),
            "email_signin": supabase_auth.configured()}


@router.post("/auth/setup")
async def auth_setup(req: Request):
    if len(auth.users()) > 0:
        raise HTTPException(403, "setup is closed; an account already exists")
    body = await _json_obj(req)
    try:
        name = auth.create_user(body.get("username", ""), body.get("password", ""))
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _set_session_cookie(JSONResponse({"user": name}), auth.new_session(name))


@router.post("/auth/register")
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


@router.post("/auth/login")
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


@router.post("/auth/email/start")
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


@router.post("/auth/email/verify")
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


@router.get("/auth/google")
def auth_google(req: Request):
    _need_supabase()
    return RedirectResponse(supabase_auth.google_url(
        str(req.base_url).rstrip("/") + "/auth/callback"))


@router.get("/auth/callback")
def auth_callback():
    """Supabase returns the token in the URL fragment, which only the
    browser can read. This page hands it to /auth/supabase and goes home."""
    return HTMLResponse(
        "<!doctype html><meta charset=utf-8><title>Signing in</title>"
        "<p>Signing you in...</p><script src=\"/auth-callback.js\"></script>")


@router.post("/auth/supabase")
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


@router.post("/auth/logout")
async def auth_logout(req: Request):
    auth.drop_session(req.cookies.get(auth.COOKIE))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(auth.COOKIE)
    return resp


@router.post("/auth/account/delete")
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


@router.get("/auth/me")
def auth_me(req: Request):
    # Signed-out is a normal state, not an error (review
    # 2026-10-28, U5): the boot probe reads user=None and shows
    # the sign-in screen, with no 401 noise in the console.
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info:
        return {"user": None, "demo": False}
    return info


@router.post("/auth/token")
def mint_token(req: Request):
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info or info["demo"]:
        raise HTTPException(401, "sign in with your account to create a connector token")
    return {"token": auth.new_api_token(info["user"]),
            "note": "Shown once. Creating a new token replaces the old one."}


@router.get("/auth/token")
def token_status(req: Request):
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info or info["demo"]:
        raise HTTPException(401, "login required")
    return {"has_token": auth.has_api_token(info["user"])}


@router.delete("/auth/token")
def revoke_token(req: Request):
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info or info["demo"]:
        raise HTTPException(401, "login required")
    auth.revoke_api_tokens(info["user"])
    return {"ok": True, "has_token": False}


@router.post("/auth/demo")
def auth_demo(req: Request):
    if not _demo_rate(_demo_auth_hits, _client_ip(req),
                      "ARYA_DEMO_AUTH_RATE", 120):
        raise HTTPException(429, "too many demo sessions — try again in a bit")
    return _set_session_cookie(JSONResponse({"user": "demo", "demo": True}),
                               auth.new_session("demo", demo=True))
