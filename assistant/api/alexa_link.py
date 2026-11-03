"""Alexa account linking (owner, 2026-11-03): Arya is the OAuth server
for the Alexa skill, authorization-code grant. Hidden behind ARYA_ALEXA
(off by default); with it off every /alexa/ path answers 404.

What is kept, all in alexa_link.json in the data root, every secret
stored only as its SHA-256:
- pending: a link the Alexa app started, waiting for sign-in and a yes
  (10 minutes);
- codes: the one-time code handed back to Alexa (5 minutes, single use);
- access: an access token (1 hour), good only on /alexa/skill;
- refresh: a refresh token, until the account is deleted or unlinked.
"""
import hashlib, hmac, os, secrets, time

from api import auth

PENDING_TTL = 600
CODE_TTL = 300
ACCESS_TTL = 3600
_DOC = "alexa_link.json"


def enabled():
    return os.environ.get("ARYA_ALEXA", "").strip().lower() in ("1", "on", "true", "yes")


def client_id():
    return os.environ.get("ARYA_ALEXA_CLIENT_ID", "").strip()


def skill_id():
    return os.environ.get("ARYA_ALEXA_SKILL_ID", "").strip()


def redirects():
    """The redirect URLs the Alexa developer console lists for the
    skill; nothing else may receive a code."""
    return [u.strip() for u in os.environ.get("ARYA_ALEXA_REDIRECTS", "").split(",") if u.strip()]


def client_ok(cid, secret):
    want_id, want_secret = client_id(), os.environ.get("ARYA_ALEXA_CLIENT_SECRET", "")
    if not want_id or not want_secret:
        return False
    return (hmac.compare_digest(str(cid or ""), want_id)
            and hmac.compare_digest(str(secret or ""), want_secret))


def _h(raw):
    return hashlib.sha256(str(raw).encode()).hexdigest()


def _empty():
    return {"pending": {}, "codes": {}, "access": {}, "refresh": {}}


def _load():
    d = auth._load(_DOC, None) or _empty()
    for k in _empty():
        d.setdefault(k, {})
    return d


def _prune(d, now):
    for k in ("pending", "codes", "access"):
        d[k] = {h: v for h, v in d[k].items() if v.get("exp", 0) > now}


def _change(fn):
    with auth._file_lock(_DOC):
        d = _load()
        _prune(d, time.time())
        out = fn(d)
        auth._save(_DOC, d)
        return out


# --- pending links (the Alexa app's request, waiting for a yes) ---

def start(redirect_uri, state_value, user=None):
    """Keep the Alexa app's request; the raw id goes in a cookie or a
    form field and is the only way back to it."""
    raw = secrets.token_urlsafe(24)

    def put(d):
        d["pending"][_h(raw)] = {"redirect_uri": redirect_uri, "state": state_value,
                                 "user": user, "exp": time.time() + PENDING_TTL}
    _change(put)
    return raw


def pending(raw):
    if not raw:
        return None
    rec = _load()["pending"].get(_h(raw))
    if not rec or rec.get("exp", 0) <= time.time():
        return None
    return rec


def bind(raw, user):
    """The signed-in account this request is for (set when the consent
    page is shown, checked again on the yes)."""
    def put(d):
        rec = d["pending"].get(_h(raw))
        if rec:
            rec["user"] = user
        return rec
    return _change(put)


def finish(raw, user):
    """The yes: drop the pending request and mint a one-time code.
    Returns (code, redirect_uri, state) or None."""
    def take(d):
        rec = d["pending"].pop(_h(raw), None)
        if not rec or rec.get("user") != user:
            return None
        code = secrets.token_urlsafe(24)
        d["codes"][_h(code)] = {"user": user, "redirect_uri": rec["redirect_uri"],
                                "exp": time.time() + CODE_TTL}
        return code, rec["redirect_uri"], rec["state"]
    return _change(take)


def cancel(raw):
    def take(d):
        return d["pending"].pop(_h(raw), None)
    return _change(take)


# --- tokens ---

def _mint(d, user):
    access = "arya_ax_" + secrets.token_urlsafe(32)
    d["access"][_h(access)] = {"user": user, "exp": time.time() + ACCESS_TTL}
    return access


def exchange_code(code, redirect_uri):
    """Code -> (access, refresh) or None. A code works once."""
    def take(d):
        rec = d["codes"].pop(_h(code or ""), None)
        if not rec or rec["exp"] <= time.time():
            return None
        if redirect_uri and redirect_uri != rec["redirect_uri"]:
            return None
        if not auth.users().get(rec["user"]):
            return None
        refresh = "arya_axr_" + secrets.token_urlsafe(32)
        d["refresh"][_h(refresh)] = {"user": rec["user"], "created": int(time.time())}
        return _mint(d, rec["user"]), refresh
    return _change(take)


def refresh(raw):
    """A new access token for a refresh token; the refresh token stays."""
    def take(d):
        rec = d["refresh"].get(_h(raw or ""))
        if not rec or not auth.users().get(rec["user"]):
            return None
        return _mint(d, rec["user"])
    return _change(take)


def user_for(access):
    """The account an access token belongs to, or None."""
    if not access:
        return None
    rec = _load()["access"].get(_h(access))
    if not rec or rec.get("exp", 0) <= time.time():
        return None
    return rec["user"] if auth.users().get(rec["user"]) else None


def revoke(user):
    """Unlink every Alexa token of an account (account deletion)."""
    def drop(d):
        for k in ("pending", "codes", "access", "refresh"):
            d[k] = {h: v for h, v in d[k].items() if v.get("user") != user}
    _change(drop)
