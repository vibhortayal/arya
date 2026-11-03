"""Offline list changes (owner, 2026-11-01: "i want offline add to queue").

The phone saves list changes made with no signal and sends them when
it is back online (web/src/lib/listQueue.ts). Two rules make that safe:

1. No duplicates. Every list write from the app carries an op id
   (X-Arya-Op). The first time an id arrives the change is applied and
   its answer kept; the same id again (a retry after a timeout, a second
   tab replaying the same queue) gets the kept answer back and changes
   nothing. Kept per account, newest MAX_OPS.

2. Last change wins, per item. Every applied list write stamps the item
   with when it happened (list_changes.json, shared by a group like the
   lists). A queued change says when it was made (X-Arya-Op-At) and when
   it was sent (X-Arya-Op-Sent); the difference moves it onto the
   server's clock, so a phone whose clock is off still lines up. A
   queued change older than the item's stamp is skipped: someone (or
   another of your phones) changed that item after you did, and their
   change stays. The answer says {"ok": true, "stale": true}.

Live writes (no X-Arya-Op-At) always apply and stamp the item now.
"""
import json, re, threading, time

from starlette.responses import JSONResponse, Response

from api import state

OPS_FILE = "list_ops.json"
STAMPS_FILE = "list_changes.json"
MAX_OPS = 500
STAMP_DAYS = 30
MAX_AGE_S = 7 * 86400

_ITEM_PATHS = re.compile(r"^/api/list/(add|remove|qty|edit|check|check-ok|move|also|aisle)$")
_FLAG_PATH = re.compile(r"^/api/items/([^/]+)/flag$")
_TEXT_PATH = "/api/list/from-text"
_busy = set()           # op ids being applied right now (user, op)
_busy_lock = threading.Lock()


def queueable(path):
    return bool(_ITEM_PATHS.match(path) or _FLAG_PATH.match(path) or path == _TEXT_PATH)


def _item_of(path, body):
    m = _FLAG_PATH.match(path)
    if m:
        from urllib.parse import unquote
        return unquote(m.group(1))
    if isinstance(body, dict) and isinstance(body.get("item_id"), str):
        return body["item_id"]
    return None


def _num(v):
    try:
        return float(v) / 1000.0     # the phone sends milliseconds
    except (TypeError, ValueError):
        return None


def op_time(at, sent, now=None):
    """When a queued change was made, on the server's clock."""
    now = time.time() if now is None else now
    a, s = _num(at), _num(sent)
    if a is None:
        return now
    t = now - (s - a) if s is not None else a
    return max(now - MAX_AGE_S, min(now, t))


def stamp_of(item_id):
    return state._load(STAMPS_FILE, {}).get(item_id)


def _stamp(item_id, when):
    with state.file_lock(STAMPS_FILE):
        doc = state._load(STAMPS_FILE, {})
        if doc.get(item_id, 0) > when:
            return
        doc[item_id] = when
        floor = time.time() - STAMP_DAYS * 86400
        if len(doc) > 2000:
            doc = {k: v for k, v in doc.items() if v >= floor}
        state._save(STAMPS_FILE, doc)


def _seen(op):
    return state._load(OPS_FILE, {"ops": {}})["ops"].get(op)


def _keep(op, status, body):
    with state.file_lock(OPS_FILE):
        doc = state._load(OPS_FILE, {"ops": {}})
        ops = doc["ops"]
        ops[op] = {"at": time.time(), "status": status, "body": body}
        if len(ops) > MAX_OPS:
            for k, _v in sorted(ops.items(), key=lambda kv: kv[1]["at"])[:len(ops) - MAX_OPS]:
                del ops[k]
        state._save(OPS_FILE, doc)


async def middleware(request, call_next):
    """Runs inside require_login (the account is known)."""
    path = request.url.path
    if request.method != "POST" or not queueable(path) or not state._current_user.get():
        return await call_next(request)
    op = (request.headers.get("x-arya-op") or "")[:64]
    queued = request.headers.get("x-arya-op-at") is not None
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        body = None
    item = _item_of(path, body)
    when = op_time(request.headers.get("x-arya-op-at"),
                   request.headers.get("x-arya-op-sent")) if queued else time.time()
    if op:
        kept = _seen(op)
        if kept is not None:
            return JSONResponse({**kept["body"], "duplicate": True}
                                if isinstance(kept["body"], dict) else kept["body"],
                                status_code=kept["status"])
        key = (state._current_user.get(), op)
        with _busy_lock:
            if key in _busy:
                return JSONResponse({"ok": True, "duplicate": True})
            _busy.add(key)
    try:
        if queued and item:
            last = stamp_of(item)
            if last is not None and last > when:
                out = {"ok": True, "stale": True, "item_id": item}
                if op:
                    _keep(op, 200, out)
                return JSONResponse(out)
        resp = await call_next(request)
        raw = b"".join([chunk async for chunk in resp.body_iterator])
        if 200 <= resp.status_code < 300:
            try:
                parsed = json.loads(raw or b"null")
            except ValueError:
                parsed = None
            ids = [item] if item else []
            if not ids and isinstance(parsed, dict) and isinstance(parsed.get("item_id"), str):
                ids = [parsed["item_id"]]       # /api/list/add by name
            if path == _TEXT_PATH and isinstance(parsed, dict):
                ids = [i for i in parsed.get("all_item_ids") or [] if isinstance(i, str)]
            for i in ids:
                _stamp(i, when)
            if op and parsed is not None:
                _keep(op, resp.status_code, parsed)
        headers = {k: v for k, v in resp.headers.items() if k.lower() != "content-length"}
        return Response(raw, status_code=resp.status_code, headers=headers,
                        media_type=resp.media_type)
    finally:
        if op:
            with _busy_lock:
                _busy.discard((state._current_user.get(), op))
