"""Use my own Meta key (BYOK; owner 2026-11-01, Fable review in
/mnt/project-files/arya-byok-review/REVIEW.md).

A real account may save its own Meta Model API key. Its Meta calls then
run on that key, are booked to the "own_key" ledger bucket, and skip
the app's dollar caps (it is the person's own money). Everything else
stays as it is: the owner's "paid reads paused" switch, the demo, the
scan frame cap, per-IP limits and every non-Meta service.

Rules (each one is a numbered change in the review):
- Off unless ARYA_BYOK=1 AND ARYA_KEY_VAULT_SECRET is set (fail closed, 5).
- The key is encrypted (Fernet) in data/users/<user>/own_key.json, its own
  per-user file: never in settings, exports or group docs, and removed
  with the account directory (1).
- The demo and any sandbox can neither save nor use one (2).
- Only "LLM_..." keys up to 200 characters; the input is never echoed (3).
- Only the last 4 characters are ever shown (3, 9).
- The key is read for the current user at call time, never cached
  across users (10).
- A key Meta rejects (401/403 on a Spark call) or that is out of credit
  (402, or a credit/billing error) is marked needs_attention and the
  read fails; nothing is retried on the app's key (17, 18). A Wonder
  403 is not the key's fault (20).
"""
import base64, contextvars, hashlib, json, os, re, time

from api import state

FILE = "own_key.json"
MAX_LEN = 200
PREFIX = "LLM_"
OK, NEEDS_ATTENTION = "ok", "needs_attention"

FAILED_MSG = "Your Meta key was rejected or is out of credit. Update it in Settings."
OFFER_HEADER = "X-Arya-Offer"


# One dict per request (offer_middleware): a failed own-key read marks
# it from whatever thread the call ran in, and the response then carries
# X-Arya-Offer: own-key-fix so the app can link to Settings.
_box = contextvars.ContextVar("arya_own_key_box", default=None)


class OwnKeyFailed(RuntimeError):
    """A read on the person's own key that Meta refused for the key
    itself. The message is safe to show."""

    def __init__(self):
        super().__init__(FAILED_MSG)
        box = _box.get()
        if box is not None:
            box["failed"] = True


async def offer_middleware(request, call_next):
    box = {}
    tok = _box.set(box)
    try:
        resp = await call_next(request)
    finally:
        _box.reset(tok)
    if box.get("failed"):
        resp.headers[OFFER_HEADER] = "own-key-fix"
    return resp


# ---- switches

def enabled():
    """BYOK is on: the flag, and a vault secret to encrypt with."""
    return os.environ.get("ARYA_BYOK", "0") == "1" and bool(_secret())


def _secret():
    return os.environ.get("ARYA_KEY_VAULT_SECRET", "").strip()


def available():
    """Whether this request's account may save or use its own key."""
    user = state._owner()
    return (enabled() and bool(user) and not state.in_sandbox()
            and user != state.DEMO_USER)


# ---- encryption

def _fernet():
    from cryptography.fernet import Fernet
    # Any secret string works: it is stretched to a Fernet key.
    raw = hashlib.sha256(_secret().encode()).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def _path(user):
    return os.path.join(state.user_dir(user), FILE)


def _read(user):
    try:
        with open(_path(user)) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _write(user, rec):
    os.makedirs(state.user_dir(user), exist_ok=True)
    state.write_json_atomic(_path(user), rec)


# ---- validation

_SHAPE = re.compile(r"^LLM_[A-Za-z0-9_\-|.:]+$")


def clean(key):
    """The key trimmed, or None when it is not a Meta Model API key."""
    k = str(key or "").strip()
    if not k or len(k) > MAX_LEN or not k.startswith(PREFIX) or not _SHAPE.match(k):
        return None
    return k


def ends(key):
    return key[-4:]


# ---- the stored key

def status(user=None):
    """{"set", "ends", "status"} for an account; never the key."""
    user = user or state._owner()
    rec = _read(user) if user else None
    if not rec:
        return {"set": False, "ends": None, "status": None}
    return {"set": True, "ends": rec.get("ends"), "status": rec.get("status", OK)}


def save(user, key):
    _write(user, {"ct": _fernet().encrypt(key.encode()).decode(), "ends": ends(key),
                  "status": OK, "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")})


def remove(user):
    try:
        os.remove(_path(user))
        return True
    except OSError:
        return False


def mark_needs_attention(user):
    rec = _read(user)
    if rec and rec.get("status") != NEEDS_ATTENTION:
        rec["status"] = NEEDS_ATTENTION
        _write(user, rec)


def for_current_user():
    """The decrypted key this request's Meta calls should use, or None
    (BYOK off, the demo, no key, or a key that needs attention). Read
    from the context user each time; nothing is cached."""
    if not available():
        return None
    user = state._owner()
    rec = _read(user)
    if not rec or rec.get("status", OK) != OK:
        return None
    try:
        return _fernet().decrypt(rec["ct"].encode()).decode()
    except Exception:
        # A changed vault secret: the key cannot be read, so the person
        # re-enters it (documented in OPS.md).
        mark_needs_attention(user)
        return None


def model_ready():
    """A Meta call can be made for this request: the app's key, or the
    person's own. Replaces the bare MODEL_API_KEY checks."""
    return bool(os.environ.get("MODEL_API_KEY")) or for_current_user() is not None


# ---- failures

_CREDIT = re.compile(r"credit|billing|quota|insufficient|payment", re.I)


def key_failure(status, payload, model=""):
    """Whether a Meta answer means the key itself is bad or out of
    credit. 429, 5xx and timeouts are transient; a Wonder 403 is model
    access (a preview with country limits), not the key."""
    credit = bool(_CREDIT.search(str(payload)))
    if status == 402:
        return True
    if status in (401, 403):
        return credit or not str(model).startswith("muse-wonder")
    return status == 400 and credit


def scrub(text, key):
    """The text with any copy of the key replaced."""
    return str(text).replace(key, "[key]") if key else str(text)


# ---- the save-time check, rate limited (review 4: it is an oracle)

SAVE_PER_HOUR = 5
SAVE_PER_IP_DAY = 20
_user_hits, _ip_hits = {}, {}


def allow_try(user, ip, now=None):
    now = time.time() if now is None else now
    u = [t for t in _user_hits.get(user, []) if now - t < 3600]
    i = [t for t in _ip_hits.get(ip, []) if now - t < 86400]
    if len(u) >= SAVE_PER_HOUR or len(i) >= SAVE_PER_IP_DAY:
        _user_hits[user], _ip_hits[ip] = u, i
        return False
    _user_hits[user] = u + [now]
    _ip_hits[ip] = i + [now]
    if len(_ip_hits) > 10000:
        for k in [k for k, v in _ip_hits.items() if not v or now - v[-1] >= 86400]:
            _ip_hits.pop(k, None)
    return True


def check(key, transport=None):
    """One tiny Spark call on the key. True when Meta accepts it,
    False when it rejects the key; a transient failure raises."""
    from api.meta_client import MODELS, MetaClient
    c = MetaClient(api_key=key, transport=transport)
    body = {"model": MODELS["standard"], "reasoning_effort": "low",
            "messages": [{"role": "user", "content": "Reply with the word ok."}]}
    status, payload = c._send_once("/chat/completions", body, timeout=20)
    if status == 200:
        return True
    if key_failure(status, payload, MODELS["standard"]):
        return False
    raise RuntimeError(f"Meta could not check the key right now (HTTP {status})")
