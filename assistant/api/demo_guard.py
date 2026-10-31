"""Demo-household guard: the in-memory sandbox a demo visitor plays
in, the per-IP caps on the demo's open doors, and the login
middleware that ties sessions, tokens and the sandbox to a request."""
import os
from collections import OrderedDict

from fastapi.responses import JSONResponse

from api import state, auth
from api.cost_ledger import kind_for_path, usage_kind
from api.deps import _client_ip, _prune

# Per-IP sliding-window caps on the demo's unauthenticated surface:
# session minting and the live doors. Generous for a human judge,
# a hard stop for a script (review 2026-10-28, H4).
_demo_auth_hits = {}
_demo_door_hits = {}
_demo_feedback_hits = {}


# API-token calls per account (rolling hour): shared by the agent
# connector, the Lists API and every other route a token can reach.
_token_hits = {}

# What a token (agent or script) may not do on its own, whatever else
# it can reach: calls that spend model credits in bulk, and changes
# that touch other people or the account's privacy. The app itself
# (a signed-in cookie) is not affected. ARYA_TOKEN_GUARDS=off lifts it.
_TOKEN_BLOCKED = (
    # (path prefix, methods that are blocked; None = every method)
    ("/api/chat", None), ("/api/judge/", None), ("/api/curator/", None),
    ("/api/review/suggest", None), ("/api/list/judge", None),
    ("/api/list/from-photo", None), ("/api/list/suggest/guess", None),
    ("/api/transcribe", None), ("/api/quest/avatar/generate", None),
    ("/api/quest/avatar/photo", None), ("/api/storemap/", ("POST",)),
    ("/api/expiry/read", None), ("/api/quest/scan-shelf", None),
    ("/api/quest/haul-photo", None), ("/decode/", None), ("/eyes/photo", None),
    ("/api/group", None), ("/api/quest/friends", None),
    ("/api/feedback", None), ("/api/demo/feedback", None), ("/api/ops", None),
    ("/api/push/", None), ("/api/settings", ("POST",)),
    ("/api/powers/share", None), ("/api/account/export", None),
    ("/api/quest/receipts/", ("POST",)),
)


def _token_blocked(path, method):
    if os.environ.get("ARYA_TOKEN_GUARDS", "").lower() == "off":
        return False
    return any(path.startswith(p) and (m is None or method in m)
               for p, m in _TOKEN_BLOCKED)


def _retry_after(bucket, key):
    import time as _t
    oldest = min(bucket.get(key) or [_t.time()])
    return max(1, int(3600 - (_t.time() - oldest)))


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
                "/api/quest/avatar/photo", "/api/feedback", "/api/push/",
                "/api/group")
# Doors that can call the Meta API: the per-IP live-door cap applies.
_DEMO_LIVE_DOORS = ("/decode/photo", "/api/transcribe",
                    "/api/list/from-photo", "/api/list/from-text",
                    "/api/expiry/read",
                    "/api/quest/scan-shelf",
                    "/api/quest/share-look",
                    "/api/chat", "/api/quest/sessions", "/api/quest/shopoff",
                    "/api/storemap", "/api/quest/zones", "/api/quest/build")
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


async def require_login(request, call_next):
    path = request.url.path
    protected = path.startswith(("/api/", "/import", "/decode", "/eyes"))
    via_token = False
    # The Lists API (/api/v1) answers with a bearer token only, and its
    # schema is public.
    open_lists = path == "/api/v1" or path.startswith("/api/v1/")
    if path == "/api/v1/openapi.json":
        protected = False
    state.set_overlay(None)
    state.start_request_memo()
    # Which open tab sent this (live sync skips a tab's own echo).
    from api import live
    live.client_id.set(request.headers.get("x-arya-client", "")[:40])
    if protected:
        info = None
        authz = request.headers.get("authorization", "")
        if authz.startswith("Bearer "):
            user = auth.api_token_user(authz[7:])
            if user:
                info = {"user": user, "demo": False}
                via_token = True
        if open_lists and not info:
            return JSONResponse(
                {"error": {"code": "unauthorized",
                           "message": "send your API token: Authorization: Bearer <token>"}},
                status_code=401, headers={"WWW-Authenticate": "Bearer"})
        cookie = request.cookies.get(auth.COOKIE)
        if not info:
            info = auth.session_info(cookie)
        if not info:
            return JSONResponse({"detail": "login required"}, status_code=401)
        if via_token and not path.startswith(("/api/mcp", "/api/v1")):
            # /api/mcp and /api/v1 count their own calls. Every other
            # route a token reaches shares the same hourly allowance.
            if _token_blocked(path, request.method):
                return JSONResponse(
                    {"detail": "an API token cannot do this; use the app"},
                    status_code=403)
            if not _demo_rate(_token_hits, info["user"], "ARYA_MCP_RATE", 600):
                return JSONResponse(
                    {"detail": "too many calls this hour; try again later"},
                    status_code=429,
                    headers={"Retry-After": str(_retry_after(_token_hits, info["user"]))})
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
        usage_kind.set(kind_for_path(path))
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
