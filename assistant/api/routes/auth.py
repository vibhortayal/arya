"""Sign-in, sessions, API tokens and account deletion."""
import os
import secrets
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from api import auth, google_oauth, supabase_auth
from api.demo_guard import _demo_auth_hits, _demo_rate
from api.deps import (_client_ip, _code_hits, _is_owner, _json_obj, _login_fails, _prune, _register_hits,
                      _is_waitlist_admin, _registration_open, _set_registration_open, _set_session_cookie, _verify_hits,
                      _waitlist_hits)

router = APIRouter()


@router.get("/auth/status")
def auth_status():
    from api import own_key
    return {"has_users": len(auth.users()) > 0,
            "registration_open": _registration_open(),
            "email_signin": supabase_auth.configured(),
            # The "I have my own Meta key" door (BYOK review 2): needs
            # email codes, the vault secret, the Ops switch and room in
            # today's sign-up cap.
            "own_key_signup": supabase_auth.configured() and own_key.door_open()}


def _session_user(req: Request):
    """Who is asking, from the session cookie. The /auth/* routes
    sit outside the login middleware's prefixes, so — like
    /auth/me — they resolve the session themselves."""
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    return info if info and not info.get("demo") else None


@router.get("/auth/registration")
def registration_state(req: Request):
    """Registration state for a signed-in account. `can_manage`
    is true only for the owner (ARYA_OWNER_USERNAME), the one
    account allowed to flip the toggle."""
    info = _session_user(req)
    if not info:
        raise HTTPException(401, "login required")
    return {"registration_open": _registration_open(),
            "can_manage": _is_owner(info["user"])}


@router.post("/auth/registration")
async def registration_set(req: Request):
    """The owner's registration toggle (owner, 2026-10-29): flips
    sign-ups open or closed at once, no redeploy. The choice is
    stored in the data root and overrides the environment flag."""
    info = _session_user(req)
    if not info:
        raise HTTPException(401, "login required")
    if not _is_owner(info["user"]):
        raise HTTPException(403, "owner only")
    body = await _json_obj(req)
    if not isinstance(body.get("open"), bool):
        raise HTTPException(400, "open must be true or false")
    return {"registration_open": _set_registration_open(body["open"])}


# ---- Sign up with your own Meta key (owner 2026-11-01; BYOK review 2).
# Two steps, so no account is ever made from a key alone: the key is
# checked with Meta and held (encrypted, 15 minutes) while the email code
# goes out; the account is created only when the code is verified. It is
# an own-key account: it never reads on Arya's key or budget.

@router.post("/auth/own-key/start")
async def own_key_start(req: Request):
    from api import own_key
    _need_supabase()
    if not own_key.door_open():
        raise HTTPException(503, "Signing up with your own key is closed right now. Join the waitlist instead.")
    body = await _json_obj(req)
    email = (body.get("email") or "").strip().lower()
    if "@" not in email or len(email) > 254 or not auth.valid_name(email):
        raise HTTPException(400, "Enter a valid email.")
    key = own_key.clean(body.get("key"))
    if key is None:
        raise HTTPException(400, "That isn't a Meta Model API key. It starts with LLM_.")
    if body.get("accept") is not True:
        raise HTTPException(400, "Please accept the terms to continue.")
    if not own_key.allow_start(_client_ip(req), email):
        raise HTTPException(429, "Too many tries. Wait an hour and try again.")
    if email in auth.users():
        raise HTTPException(409, "That email already has an account. Sign in, then add your key in Settings.")
    if own_key.accounts_using(own_key.key_hash(key)) >= own_key.MAX_ACCOUNTS_PER_KEY:
        raise HTTPException(409, "This key is already used by 3 Arya accounts. Use a different key.")
    try:
        ok = await run_in_threadpool(own_key.check, key)
    except RuntimeError:
        raise HTTPException(503, "Meta couldn't check the key right now. Try again in a minute.")
    if not ok:
        raise HTTPException(422, "Meta didn't accept this key. Check it at dev.meta.ai and try again.")
    # Only someone holding a working Meta key gets this far, so only they
    # can make Arya send a code email.
    own_key.hold(email, key)
    try:
        await run_in_threadpool(supabase_auth.send_code, email)
    except supabase_auth.AuthError as e:
        own_key.take(email)
        raise HTTPException(502, str(e))
    return {"sent": True, "ends": own_key.ends(key)}


@router.post("/auth/own-key/verify")
async def own_key_verify(req: Request):
    from api import own_key, waitlist
    _need_supabase()
    _email_guard(req, _verify_hits, 10)
    body = await _json_obj(req)
    email = (body.get("email") or "").strip().lower()
    code = str(body.get("code") or "").strip()
    if not own_key.has_pending(email):
        raise HTTPException(410, "This sign-up expired. Start again.")
    try:
        verified = await run_in_threadpool(supabase_auth.verify_code, email, code)
    except supabase_auth.AuthError:
        raise HTTPException(401, "That code didn't work. Check it or ask for a new one.")
    if verified != email:
        raise HTTPException(401, "That code didn't work. Check it or ask for a new one.")
    key = own_key.take(email)
    if key is None:
        raise HTTPException(410, "This sign-up expired. Start again.")
    if email in auth.users():
        raise HTTPException(409, "That email already has an account. Sign in, then add your key in Settings.")
    if not own_key.door_open():
        raise HTTPException(503, "Signing up with your own key is closed right now. Join the waitlist instead.")
    if not own_key.allow_create(_client_ip(req)):
        raise HTTPException(429, "Too many tries. Wait an hour and try again.")
    try:
        name, created = auth.ensure_federated_user(email)
    except ValueError as e:
        raise HTTPException(400, str(e))
    auth.set_key_mode(name, "own")
    own_key.save(name, key)
    own_key.count_signup()
    waitlist.remove(name)
    return _set_session_cookie(JSONResponse({"user": name, "created": created}),
                               auth.new_session(name))


@router.get("/auth/own-key/door")
def own_key_door_state(req: Request):
    from api import own_key
    info = _session_user(req)
    if not info:
        raise HTTPException(401, "login required")
    return {"open": own_key.door_switch(), "showing": own_key.door_open(),
            "today": own_key.signups_today(), "can_manage": _is_owner(info["user"])}


@router.post("/auth/own-key/door")
async def own_key_door_set(req: Request):
    """The Ops switch for the own-key sign-up door (review 2, change 4):
    shuts it at once with no redeploy, like registration."""
    from api import own_key
    info = _session_user(req)
    if not info:
        raise HTTPException(401, "login required")
    if not _is_owner(info["user"]):
        raise HTTPException(403, "owner only")
    body = await _json_obj(req)
    if not isinstance(body.get("open"), bool):
        raise HTTPException(400, "open must be true or false")
    return {"open": own_key.set_door(body["open"])}


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


def _quiet(fn, *a):
    """Run a background mail; whatever happens, the visitor's join stands."""
    try:
        fn(*a)
    except Exception as e:  # noqa: BLE001
        import logging
        logging.getLogger("arya.mailer").warning("background mail failed: %s", type(e).__name__)


@router.post("/auth/waitlist")
async def auth_waitlist(req: Request, bg: BackgroundTasks):
    """Join the sign-in waitlist (owner, 2026-10-30): public, an email
    and nothing else (api/waitlist.py). A hidden field a person never
    fills, and 5 tries an hour per IP, keep it quiet. Answers
    {"status": "added" | "already" | "approved"} ("approved": the address
    was already invited, so the page says to sign in)."""
    import os as _os, time as _t
    from api import waitlist
    ip = _client_ip(req)
    body = await _json_obj(req)
    if body.get("website"):   # honeypot: look like success, store nothing
        return {"status": "added"}
    limit = int(_os.environ.get("ARYA_WAITLIST_IP_RATE", "5"))
    _prune(_waitlist_hits, 3600)
    hits = [t for t in _waitlist_hits.get(ip, []) if _t.time() - t < 3600]
    if len(hits) >= limit:
        raise HTTPException(429, "Too many tries. Wait a few minutes and try again.")
    _waitlist_hits[ip] = hits + [_t.time()]
    try:
        status = waitlist.join(body.get("email", ""))
        if status == "added":
            from api import mailer
            addr = waitlist.clean(body.get("email", ""))
            url = os.environ.get("ARYA_PUBLIC_URL") or str(req.base_url).rstrip("/")
            # best effort, after the answer is sent: a slow or failing mail
            # never blocks or breaks joining
            if mailer.configured():
                bg.add_task(_quiet, mailer.waitlist_joined, addr, url)
            bg.add_task(mailer.waitlist_owner_notice, addr, url)
        return {"status": status}
    except PermissionError as e:
        raise HTTPException(429, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


def _owner_only(req: Request):
    info = _session_user(req)
    if not info:
        raise HTTPException(401, "login required")
    if not _is_waitlist_admin(info["user"]):
        raise HTTPException(403, "waitlist admins only")


async def _emails(req: Request):
    body = await _json_obj(req)
    emails = body.get("emails")
    if not isinstance(emails, list) or not 0 < len(emails) <= 50 \
            or not all(isinstance(e, str) for e in emails):
        raise HTTPException(400, "emails must be a list of 1 to 50 addresses")
    return body, emails


@router.get("/auth/waitlist/list")
def waitlist_list(req: Request):
    """Owner only: who is waiting, oldest first."""
    from api import waitlist
    _owner_only(req)
    return {"rows": [{"email": r["email"], "at": r.get("at", 0), "approved": bool(r.get("approved")) and not r.get("rejected"),
                      "rejected": bool(r.get("rejected"))}
                     for r in sorted(waitlist.rows(), key=lambda r: r.get("at", 0))]}


@router.post("/auth/waitlist/approve")
async def waitlist_approve(req: Request):
    """Owner only: let these addresses sign in. With send_email true each
    gets the sign-in code mail now (Supabase sends it)."""
    from api import waitlist
    _owner_only(req)
    body, emails = await _emails(req)
    done = waitlist.approve(emails)
    sent = 0
    if body.get("send_email") is True:
        for e in done:
            sent += bool(await run_in_threadpool(waitlist.send_invite, e))
    return {"approved": len(done), "emailed": sent}


@router.post("/auth/waitlist/reject")
async def waitlist_reject(req: Request):
    """Owner only: say no. The row stays marked rejected; nothing is mailed."""
    from api import waitlist
    _owner_only(req)
    _, emails = await _emails(req)
    return {"rejected": len(waitlist.reject(emails))}


@router.post("/auth/waitlist/restore")
async def waitlist_restore(req: Request):
    """Owner only: move approved or rejected addresses back to waiting."""
    from api import waitlist
    _owner_only(req)
    _, emails = await _emails(req)
    return {"restored": len(waitlist.restore(emails))}


@router.post("/auth/waitlist/remove")
async def waitlist_remove(req: Request):
    from api import waitlist
    _owner_only(req)
    _, emails = await _emails(req)
    return {"removed": sum(bool(waitlist.remove(e)) for e in emails)}


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


def _email_allowed(email):
    """May this verified-or-typed email sign in by code or Google? Yes for
    an existing account, an address the owner approved from the waitlist,
    or anyone while the owner's registration switch is open (and
    ARYA_SUPABASE_SIGNUP is not 0)."""
    from api import waitlist
    if email in auth.users() or waitlist.is_approved(email):
        return True
    return _registration_open() and os.environ.get("ARYA_SUPABASE_SIGNUP") != "0"


def _federated_login(email):
    """Sign in (or create) the account for a Supabase-verified email.
    The waitlist row is deleted once the person is in."""
    from api import waitlist
    try:
        name, created = auth.ensure_federated_user(email) if _email_allowed(email) else (None, False)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not name:
        # The address is proven by the code or by Google, so it is safe to
        # hand back: the page offers to put it on the waitlist.
        return JSONResponse({"detail": "that email is not invited yet", "email": email}, status_code=403)
    waitlist.remove(name)
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
    if not _email_allowed(email):
        return {"ok": True}   # same answer for every address: no one can probe who is invited
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
    # Behind Caddy the request reads as http, so the return address comes
    # from the configured public URL, as in the waitlist email.
    base = (os.environ.get("ARYA_PUBLIC_URL") or str(req.base_url)).rstrip("/")
    if google_oauth.configured():
        state = google_oauth.new_state()
        resp = RedirectResponse(google_oauth.start_url(base + "/auth/google/callback", state))
        resp.set_cookie("arya_goauth", state, max_age=600, httponly=True, samesite="lax",
                        secure=base.startswith("https"))
        return resp
    return RedirectResponse(supabase_auth.google_url(base + "/auth/callback"))


@router.get("/auth/google/callback")
async def auth_google_callback(req: Request):
    """Arya's own Google flow (GOOGLE_OAUTH_CLIENT_ID/SECRET set): Google
    sends the code here, the server exchanges it, then signs in as for
    the Supabase paths and lands on the same pages."""
    _need_supabase()
    if not google_oauth.configured():
        raise HTTPException(404, "Google sign-in is not set up")
    _email_guard(req, _verify_hits, 10)
    state = req.cookies.get("arya_goauth") or ""
    code = req.query_params.get("code") or ""
    if not code or not state or not secrets.compare_digest(state, req.query_params.get("state") or ""):
        return RedirectResponse("/?signin=failed")
    base = (os.environ.get("ARYA_PUBLIC_URL") or str(req.base_url)).rstrip("/")
    try:
        email = await run_in_threadpool(google_oauth.email_for_code, code, base + "/auth/google/callback")
    except google_oauth.GoogleError:
        return RedirectResponse("/?signin=failed")
    login = _federated_login(email)
    if login.status_code == 403:
        return RedirectResponse("/auth/callback#notinvited=" + quote(email, safe=""))
    out = RedirectResponse("/", status_code=303)
    out.headers.append("set-cookie", login.headers["set-cookie"])
    out.delete_cookie("arya_goauth")
    return out


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


@router.post("/auth/account/delete/code")
async def auth_delete_code(req: Request):
    """Email the 6-digit code that confirms deleting an account with no
    password (signed in by email code or Google). Password accounts
    confirm with their password instead (owner, 2026-11-01)."""
    from api import mailer, state
    info = auth.session_info(req.cookies.get(auth.COOKIE))
    if not info or info["demo"]:
        raise HTTPException(403, "the demo household has no account to delete")
    user = info["user"]
    tok = state._current_user.set(None)
    try:
        if auth.has_password(user):
            raise HTTPException(400, "this account confirms with its password")
    finally:
        state._current_user.reset(tok)
    if "@" not in user or not mailer.configured():
        raise HTTPException(503, "Arya can't email a code right now. "
                            "Write to support@teamnightshift.org and we will delete your data.")
    _email_guard(req, _code_hits, 5)
    try:
        code = auth.new_delete_code(user)
    except PermissionError as e:
        raise HTTPException(429, str(e))
    minutes = auth.DELETE_CODE_TTL // 60
    if not await run_in_threadpool(mailer.account_delete_code, user, code, minutes):
        auth._delete_codes.pop(user, None)   # let them ask again at once
        raise HTTPException(502, "Arya couldn't send the email. Try again in a minute, "
                            "or write to support@teamnightshift.org.")
    return {"sent": True, "to": user, "minutes": minutes}


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
    if _root_call(lambda: auth.has_password(user)):
        if not _root_call(lambda: auth.verify(user, body.get("password", ""))):
            raise HTTPException(401, "that password does not match this account")
    elif not auth.check_delete_code(user, body.get("code", "")):
        # Email-code and Google accounts have no password: they confirm
        # with the code /auth/account/delete/code emailed them.
        raise HTTPException(401, "that code is wrong or has expired")
    social.scrub_handle(user.split("@")[0], everyone, skip=user)
    # Leave any group first, so the others keep their lists and the
    # group's owner passes on (owner, 2026-10-29).
    from api import groups
    groups.leave(user)
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
    # Settings shows the owner rows only to their accounts, so nobody
    # else calls the owner-only routes and logs a 401 or 403 (audit L7).
    real = not info["demo"]
    # has_password picks the confirm box on "Delete my account":
    # a password, or a code emailed to the account (owner, 2026-11-01).
    return {**info, "owner": real and _is_owner(info["user"]),
            "has_password": real and auth.has_password(info["user"]),
            "waitlist_admin": real and _is_waitlist_admin(info["user"])}


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
