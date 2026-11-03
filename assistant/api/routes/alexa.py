"""Alexa skill (owner, 2026-11-03), hidden behind ARYA_ALEXA: with it
off every path here answers 404 and nothing else in the app changes.

- /alexa/authorize, /alexa/token: account linking (api/alexa_link.py).
  Sign-in is the app's own; registration stays closed; the demo is
  refused.
- /alexa/skill: Amazon's requests, checked (api/alexa_verify.py), then
  an add (api/alexa_brain.py).
- /api/alexa/review: the unclear adds, for the app (api/alexa_review.py).

/alexa/* sits outside the login middleware's prefixes, like /auth/*,
so these routes resolve the account themselves."""
import base64, html, json, logging, time
from collections import OrderedDict
from urllib.parse import parse_qs, urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from api import alexa_link, auth, site_flags, state

router = APIRouter()
_log = logging.getLogger("arya.alexa")
LINK_COOKIE = "arya_alexa_link"
_seen = OrderedDict()          # Alexa requestId -> (time, response); retries answer the same
SEEN_S = 600


def _on():
    if not alexa_link.enabled():
        raise HTTPException(404, "Not Found")


def _cookie_secure():
    import os
    return os.environ.get("ARYA_INSECURE_COOKIE") != "1"


def _signed_in(req):
    """(user, demo) from the session cookie, or (None, False)."""
    tok = state._current_user.set(None)
    try:
        info = auth.session_info(req.cookies.get(auth.COOKIE))
    finally:
        state._current_user.reset(tok)
    if not info:
        return None, False
    return info["user"], bool(info.get("demo"))


async def _form(req):
    raw = (await req.body())[:8192].decode("utf-8", "replace")
    return {k: v[0] for k, v in parse_qs(raw, keep_blank_values=True).items()}


# --- the consent page ---

# The owner-approved consent page (UI/UX mockup, 2026-11-03). Light
# only, as approved. No script; the forms post back here. The error
# screens have no Close button: the Alexa app's own browser closes them.
_PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Link Alexa to Arya</title>
<style>
:root{{--acc:#C2410C;--acc-press:#A3370A;--ink:#1B1B1E;--ink2:#55555C;--ink3:#8B8B93;--line:#D9D9DE;--bg:#EFEFF1;--panel:#FFFFFF;--fill:#F4F4F6;--fill2:#E7E7EB;color-scheme:light}}
*{{box-sizing:border-box}}
body{{margin:0;min-height:100dvh;background:var(--bg);color:var(--ink);font:17px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}}
main,form.page{{flex:1;display:flex;flex-direction:column;max-width:420px;width:100%;margin:0 auto}}
.mark{{display:flex;align-items:center;gap:10px;margin:8px 0 28px}}
.mark img{{width:44px;height:44px;border-radius:11px}}
.mark b{{font-size:22px;font-weight:800;letter-spacing:-.01em}}
h1{{font-size:28px;line-height:1.15;font-weight:800;margin:0 0 12px;text-wrap:balance}}
p{{margin:0 0 14px;color:var(--ink2)}}
.card{{background:var(--panel);border-radius:14px;padding:14px 16px;margin:6px 0 0;box-shadow:0 1px 2px rgba(0,0,0,.05)}}
.can,.cannot{{display:flex;gap:10px;align-items:flex-start;margin:0;color:var(--ink)}}
.cannot{{margin-top:10px;color:var(--ink2)}}
.can i,.cannot i{{flex:none;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-size:13px;font-weight:800;margin-top:1px}}
.can i{{background:#FDEEE8;color:var(--acc)}}
.cannot i{{background:var(--fill2);color:var(--ink2)}}
.who{{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;padding:4px 16px}}
.who span{{color:var(--ink2);font-size:15px;min-width:0;overflow-wrap:anywhere}}
.who b{{color:var(--ink)}}
button.link{{appearance:none;background:none;border:0;padding:0;font:inherit;color:var(--acc);font-weight:600;font-size:15px;min-height:44px;display:inline-flex;align-items:center;flex:none;cursor:pointer}}
.actions{{margin-top:auto;padding-top:24px;display:flex;flex-direction:column;gap:10px}}
.btn{{appearance:none;border:0;border-radius:980px;min-height:50px;font:inherit;font-weight:700;width:100%;cursor:pointer}}
.btn.primary{{background:var(--acc);color:#fff}}
.btn.primary:active{{background:var(--acc-press)}}
.btn.secondary{{background:var(--fill2);color:var(--ink)}}
.note{{font-size:13px;color:var(--ink3);text-align:center;margin:10px 0 0}}
.err{{background:var(--panel);border-radius:14px;padding:18px 16px;box-shadow:0 1px 2px rgba(0,0,0,.05)}}
.err h1{{font-size:22px;margin-bottom:8px}}
.err p{{margin:0}}
</style></head><body><main>
<div class="mark"><img src="/icons/icon-192.png" alt=""><b>Arya</b></div>
{body}
</main></body></html>"""


def _page(body, status=200):
    return HTMLResponse(_PAGE.format(body=body), status_code=status,
                        headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY",
                                 "Referrer-Policy": "no-referrer"})


def _error(title, text, status=400):
    return _page(f'<div class="err"><h1>{html.escape(title)}</h1><p>{html.escape(text)}</p></div>', status)


EXPIRED = ("This link has expired", "This link has expired. Start again from the Alexa app.")
DEMO = ("Alexa needs a real Arya account", "Alexa works with a real Arya account, not the demo.")


def _consent(raw, user):
    from api import groups
    who = html.escape(groups.handle(user) or user)
    rid = html.escape(raw)
    return _page(
        f'<form class="page" method="post" action="/alexa/authorize"><input type="hidden" name="link" value="{rid}">'
        "<h1>Link Alexa to Arya</h1>"
        '<div class="card">'
        '<p class="can"><i>\u2713</i><span>Alexa will be able to add items to your lists.</span></p>'
        '<p class="cannot"><i>\u2715</i><span>It cannot read receipts, spending or anything else.</span></p>'
        "</div>"
        f'<div class="who"><span>Signed in as <b>{who}</b></span>'
        '<button class="link" type="submit" name="decision" value="switch">Not you? Sign out</button></div>'
        '<div class="actions">'
        '<button class="btn primary" type="submit" name="decision" value="allow">Allow</button>'
        '<button class="btn secondary" type="submit" name="decision" value="cancel">Cancel</button>'
        '<p class="note">You can unlink Alexa any time in the Alexa app.</p>'
        "</div></form>")


def _to_sign_in(raw):
    resp = RedirectResponse("/?alexa=1", status_code=302)
    resp.set_cookie(LINK_COOKIE, raw, httponly=True, samesite="lax", secure=_cookie_secure(),
                    max_age=alexa_link.PENDING_TTL, path="/alexa")
    return resp


@router.get("/alexa/authorize", include_in_schema=False)
def alexa_authorize(req: Request):
    _on()
    q = req.query_params
    if (q.get("response_type") != "code" or not alexa_link.client_id()
            or q.get("client_id") != alexa_link.client_id()
            or q.get("redirect_uri") not in alexa_link.redirects()):
        # Never redirect to an address Amazon did not give us.
        return _error(*EXPIRED)
    user, demo = _signed_in(req)
    if demo:
        return _error(*DEMO, status=403)
    raw = alexa_link.start(q["redirect_uri"], q.get("state", ""), user)
    if not user:
        return _to_sign_in(raw)
    return _consent(raw, user)


@router.get("/alexa/authorize/resume", include_in_schema=False)
def alexa_resume(req: Request):
    """Back from sign-in: the request kept in the link cookie."""
    _on()
    raw = req.cookies.get(LINK_COOKIE, "")
    if not alexa_link.pending(raw):
        return _error(*EXPIRED)
    user, demo = _signed_in(req)
    if demo:
        return _error(*DEMO, status=403)
    if not user:
        return _to_sign_in(raw)
    alexa_link.bind(raw, user)
    return _consent(raw, user)


@router.post("/alexa/authorize", include_in_schema=False)
async def alexa_decide(req: Request):
    _on()
    f = await _form(req)
    raw, decision = f.get("link", ""), f.get("decision")
    rec = alexa_link.pending(raw)
    if not rec:
        return _error(*EXPIRED)
    user, demo = _signed_in(req)
    if demo:
        return _error(*DEMO, status=403)
    if decision == "switch" or not user or user != rec.get("user"):
        # Sign out here, sign in as the right account, come back.
        resp = _to_sign_in(raw)
        if user:
            auth.drop_session(req.cookies.get(auth.COOKIE))
        resp.delete_cookie(auth.COOKIE)
        alexa_link.bind(raw, None)
        return resp
    sep = "&" if "?" in rec["redirect_uri"] else "?"
    if decision != "allow":
        alexa_link.cancel(raw)
        to = rec["redirect_uri"] + sep + urlencode({"state": rec["state"], "error": "access_denied"})
    else:
        done = alexa_link.finish(raw, user)
        if not done:
            return _error(*EXPIRED)
        code, uri, st = done
        to = uri + sep + urlencode({"state": st, "code": code})
    resp = RedirectResponse(to, status_code=302)
    resp.delete_cookie(LINK_COOKIE, path="/alexa")
    return resp


# --- tokens ---

def _token_error(code, status=400):
    return JSONResponse({"error": code}, status_code=status,
                        headers={"Cache-Control": "no-store", "Pragma": "no-cache"})


@router.post("/alexa/token", include_in_schema=False)
async def alexa_token(req: Request):
    """Alexa's code and refresh exchanges. Client credentials come by
    HTTP Basic or in the form body (either console setting works)."""
    _on()
    f = await _form(req)
    cid, secret = f.get("client_id"), f.get("client_secret")
    authz = req.headers.get("authorization", "")
    if authz.lower().startswith("basic "):
        try:
            from urllib.parse import unquote
            a, _, b = base64.b64decode(authz[6:]).decode().partition(":")
            cid, secret = unquote(a), unquote(b)
        except Exception:
            return _token_error("invalid_client", 401)
    if not alexa_link.client_ok(cid, secret):
        return _token_error("invalid_client", 401)
    grant = f.get("grant_type")
    if grant == "authorization_code":
        got = alexa_link.exchange_code(f.get("code"), f.get("redirect_uri"))
        if not got:
            return _token_error("invalid_grant")
        access, refresh = got
        body = {"access_token": access, "token_type": "bearer",
                "expires_in": alexa_link.ACCESS_TTL, "refresh_token": refresh}
    elif grant == "refresh_token":
        access = alexa_link.refresh(f.get("refresh_token"))
        if not access:
            return _token_error("invalid_grant")
        body = {"access_token": access, "token_type": "bearer",
                "expires_in": alexa_link.ACCESS_TTL, "refresh_token": f.get("refresh_token")}
    else:
        return _token_error("unsupported_grant_type")
    return JSONResponse(body, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})


# --- the skill ---

def _say(text, end=True, reprompt=None, link=False, attrs=None):
    out = {"outputSpeech": {"type": "PlainText", "text": text}, "shouldEndSession": end}
    if reprompt:
        out["reprompt"] = {"outputSpeech": {"type": "PlainText", "text": reprompt}}
    if link:
        out["card"] = {"type": "LinkAccount"}
    r = {"version": "1.0", "response": out}
    if attrs:
        r["sessionAttributes"] = attrs
    return r


HELP = "Say, add milk. Or, add milk to my Costco list."
NEED_LINK = "To use Arya, open the Alexa app and link your Arya account."


def _slot(intent, name):
    s = (intent.get("slots") or {}).get(name) or {}
    v = s.get("value")
    return " ".join(str(v).split())[:80] if v else ""


def _add_now(user, item, heard_list):
    """Runs as the account. Returns the response body."""
    from api import alexa_brain
    p = alexa_brain.plan(item, heard_list or None)
    if p.get("ask"):
        names = p["ask"]
        q = "Which list: " + ", ".join(names[:-1]) + " or " + names[-1] + "?"
        return _say(q, end=False, reprompt=q, attrs={"item": item})
    if p.get("now"):
        applied, skipped = alexa_brain.add(item, p.get("list"))
        if applied:
            return _say(alexa_brain.spoken(applied))
        if skipped and " already " in skipped[0]:
            return _say(skipped[0])
        if not skipped:
            return _say("Sent to Arya.")
    alexa_brain.enqueue(user, item, heard_list, p.get("list"))
    return _say("Sent to Arya.")


def _handle(body, user):
    r = body.get("request") or {}
    kind = r.get("type")
    attrs = (body.get("session") or {}).get("attributes") or {}
    if kind == "LaunchRequest":
        return _say("Arya here. What should I add?", end=False, reprompt=HELP)
    if kind == "SessionEndedRequest":
        return {"version": "1.0", "response": {}}
    if kind != "IntentRequest":
        return _say(HELP)
    intent = r.get("intent") or {}
    name = intent.get("name")
    if name in ("AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.NavigateHomeIntent"):
        return _say("Okay.")
    if name == "AMAZON.HelpIntent":
        return _say(HELP, end=False, reprompt=HELP)
    if name == "AddItemIntent":
        item, lst = _slot(intent, "item"), _slot(intent, "list")
        if not item:
            return _say("What should I add?", end=False, reprompt=HELP)
        return _add_now(user, item, lst)
    if name == "ListAnswerIntent" and attrs.get("item"):
        lst = _slot(intent, "list")
        if not lst:
            return _say("Which list?", end=False, reprompt="Which list?", attrs=attrs)
        return _add_now(user, str(attrs["item"])[:80], lst)
    if name == "AMAZON.FallbackIntent" and attrs.get("item"):
        return _say("Which list?", end=False, reprompt="Which list?", attrs=attrs)
    return _say("Sorry, I can only add to your Arya lists. " + HELP, end=False, reprompt=HELP)


def _remember(rid, resp):
    now = time.time()
    _seen[rid] = (now, resp)
    while _seen and (len(_seen) > 2000 or now - next(iter(_seen.values()))[0] > SEEN_S):
        _seen.popitem(last=False)


@router.post("/alexa/skill", include_in_schema=False)
async def alexa_skill(req: Request):
    _on()
    from api import alexa_verify
    raw = await req.body()
    try:
        await run_in_threadpool(alexa_verify.verify, req.headers, raw)
        body = json.loads(raw)
    except alexa_verify.Refused as e:
        _log.warning("alexa: refused a request (%s)", e)
        return JSONResponse({"detail": "bad request"}, status_code=400)
    except ValueError:
        return JSONResponse({"detail": "bad request"}, status_code=400)
    r = body.get("request") or {}
    if not alexa_verify.fresh(r.get("timestamp")):
        return JSONResponse({"detail": "bad request"}, status_code=400)
    ctx = (body.get("context") or {}).get("System") or {}
    app_id = ((ctx.get("application") or {}).get("applicationId")
              or ((body.get("session") or {}).get("application") or {}).get("applicationId"))
    if not alexa_link.skill_id() or app_id != alexa_link.skill_id():
        return JSONResponse({"detail": "bad request"}, status_code=400)
    rid = r.get("requestId")
    hit = _seen.get(rid) if rid else None
    if hit:
        return hit[1]
    token = ((ctx.get("user") or {}).get("accessToken")
             or ((body.get("session") or {}).get("user") or {}).get("accessToken"))
    user = alexa_link.user_for(token)
    if not user:
        resp = _say(NEED_LINK, link=True) if r.get("type") != "SessionEndedRequest" \
            else {"version": "1.0", "response": {}}
        return resp
    if site_flags.disabled(user):
        return _say("This Arya account is switched off.")
    from api.demo_guard import _demo_rate, _token_hits
    if not _demo_rate(_token_hits, user, "ARYA_MCP_RATE", 600):
        return _say("Arya is busy. Try again in a little while.")
    from api import groups
    from api.cost_ledger import usage_kind

    def run():
        with state.as_user(user, groups.group_id_for(user)):
            state.set_overlay(None)
            state.start_request_memo()
            usage_kind.set("ask")
            return _handle(body, user)
    try:
        resp = await run_in_threadpool(run)
    except Exception:
        _log.exception("alexa: request failed")
        resp = _say("Sorry, Arya could not do that just now.")
    if rid:
        _remember(rid, resp)
    return resp


# --- unclear adds, for the app ---

def _review_on(req):
    _on()
    from api.demo_guard import _is_demo
    if _is_demo(req):
        raise HTTPException(404, "Not Found")


@router.get("/api/alexa/review", include_in_schema=False)
def review_list(req: Request):
    _review_on(req)
    from api import alexa_review
    return {"items": alexa_review.open_rows()}


@router.post("/api/alexa/review/{row_id}/{action}", include_in_schema=False)
async def review_close(row_id: str, action: str, req: Request):
    """confirm | move {list_id} | rename {name} | remove | reopen (the
    Undo for confirm). Each answers the same body as the GET."""
    _review_on(req)
    from api import alexa_review
    from api.deps import _json_obj
    if action not in ("confirm", "move", "rename", "remove", "reopen"):
        raise HTTPException(404, "Not Found")
    body = await _json_obj(req) if action in ("move", "rename") else {}
    try:
        if action == "reopen":
            row = await run_in_threadpool(alexa_review.reopen, row_id)
        else:
            row = await run_in_threadpool(alexa_review.close, row_id, action,
                                          body.get("list_id"), body.get("name"))
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not row:
        raise HTTPException(404, "no such item")
    return {"items": await run_in_threadpool(alexa_review.open_rows)}
