"""Use my own Meta key (BYOK; owner 2026-11-01, Fable review in
/mnt/project-files/arya-byok-review/REVIEW.md).

A real account may save its own Meta Model API key. Its Meta calls then
run on that key, are booked to the "own_key" ledger bucket, and skip
the app's dollar caps (it is the person's own money). Everything else
stays as it is: the owner's "paid reads paused" switch, the demo, the
scan frame cap, per-IP limits and every non-Meta service.

Rules (each one is a numbered change in the review):
- Always on (owner, 2026-11-01: a generic feature), but only with
  ARYA_KEY_VAULT_SECRET set; without it nothing is stored (fail closed, 5).
- Two kinds of account (review 2, change 5): "shared" (invited, Arya's
  key, may add its own) and "own" (signed up with its own key). An "own"
  account NEVER uses Arya's key or budget: with no usable key every AI
  read answers 402 and the rest of the app keeps working.
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
    """BYOK works: a vault secret to encrypt with."""
    return bool(_secret())


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


def key_hash(key):
    """A keyed hash of the key (the vault secret salts it), so a key can
    be matched across accounts without being readable."""
    import hmac
    return hmac.new(_secret().encode(), key.encode(), hashlib.sha256).hexdigest()


MAX_ACCOUNTS_PER_KEY = 3


def accounts_using(kh, but=None):
    """How many accounts hold a key with this hash (review 2, change 3)."""
    root = os.path.join(state.base_dir(), "users")
    n = 0
    try:
        names = os.listdir(root)
    except OSError:
        return 0
    for name in names:
        if name == but:
            continue
        try:
            rec = _read(name)
        except ValueError:
            continue
        if rec and rec.get("kh") == kh:
            n += 1
    return n


def save(user, key):
    _write(user, {"ct": _fernet().encrypt(key.encode()).decode(), "ends": ends(key),
                  "kh": key_hash(key), "status": OK,
                  "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S%z")})
    _resume_paused_jobs(user)


def _resume_paused_jobs(user):
    """Receipt jobs paused for want of a key carry on (review 2, 5)."""
    try:
        from api import receiptjobs
        with state.as_user(user):
            for j in (receiptjobs._load().get("jobs") or []):
                if j.get("status") == "paused":
                    receiptjobs.resume_job(j["id"])
    except Exception:   # best effort: the person can still tap Retry
        pass


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


def key_mode(user=None):
    """"own" for an account that signed up with its own key, else
    "shared". Kept in users.json, so removing the key keeps it."""
    from api import auth
    user = user if user is not None else state._owner()
    if not user or state.in_sandbox():
        return "shared"
    # The account registry lives in the data root; inside a request
    # data_dir() is the account's own folder, so read it with no user.
    tok = state._current_user.set(None)
    try:
        rec = auth.users().get(user) or {}
    finally:
        state._current_user.reset(tok)
    return rec.get("key_mode") or "shared"


def required(user=None):
    return key_mode(user) == "own"


NEEDS_KEY_MSG = "Add a valid Meta key in Settings to keep reading."


def needs_key_error():
    from fastapi import HTTPException
    return HTTPException(402, NEEDS_KEY_MSG, headers={OFFER_HEADER: "own-key-fix"})


def model_ready():
    """A Meta call can be made for this request: the person's own key,
    or (for a shared account) the app's. Replaces the bare MODEL_API_KEY
    checks; quiet callers use it as a yes/no."""
    if for_current_user() is not None:
        return True
    if required():
        return False
    return bool(os.environ.get("MODEL_API_KEY"))


def need_model():
    """For routes: raise the right error when no Meta call can be made.
    An own-key account with no usable key gets 402 with the Settings
    offer; otherwise the old 503."""
    if model_ready():
        return
    if required():
        raise needs_key_error()
    from fastapi import HTTPException
    raise HTTPException(503, "MODEL_API_KEY not provisioned on this runtime")


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


# ---- the sign-up door (review 2, changes 1 to 4)

DOOR_KEY = "own_key_signup_open"
PENDING_MINUTES = 15


def _site_doc():
    from api.deps import _site_path
    try:
        with open(_site_path()) as fh:
            doc = json.load(fh)
        return doc if isinstance(doc, dict) else {}
    except (OSError, ValueError):
        return {}


def door_switch():
    """The Ops door switch: site.json first, then ARYA_OWN_KEY_SIGNUP
    (default on). Shuts the door in seconds with no redeploy."""
    v = _site_doc().get(DOOR_KEY)
    if isinstance(v, bool):
        return v
    return os.environ.get("ARYA_OWN_KEY_SIGNUP", "1") != "0"


def set_door(open_):
    from api.deps import _site_path
    doc = _site_doc()
    doc[DOOR_KEY] = bool(open_)
    state.write_json_atomic(_site_path(), doc)
    return doc[DOOR_KEY]


def _count_path():
    return os.path.join(state.base_dir(), "own_key_signups.json")


def signups_today():
    try:
        with open(_count_path()) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return 0
    return int(doc.get(time.strftime("%Y-%m-%d"), 0)) if isinstance(doc, dict) else 0


def count_signup():
    state.write_json_atomic(_count_path(), {time.strftime("%Y-%m-%d"): signups_today() + 1})


def door_open():
    """Whether the "I have my own Meta key" sign-up shows: the vault,
    the Ops switch and today's sign-up cap."""
    from api import settings
    return enabled() and door_switch() and signups_today() < settings.get("own_key_signups_per_day")


def _pending_dir():
    return os.path.join(state.base_dir(), "pending_own_key")


def _pending_path(email):
    return os.path.join(_pending_dir(), hashlib.sha256(email.encode()).hexdigest() + ".json")


def sweep_pending(now=None):
    """Delete held keys past their time: a stale encrypted key outside
    any account is a liability (review 2, note)."""
    now = time.time() if now is None else now
    try:
        names = os.listdir(_pending_dir())
    except OSError:
        return
    for n in names:
        p = os.path.join(_pending_dir(), n)
        try:
            with open(p) as fh:
                if json.load(fh).get("exp", 0) < now:
                    os.remove(p)
        except (OSError, ValueError):
            try:
                os.remove(p)
            except OSError:
                pass


def hold(email, key):
    """Keep a checked key until the email code is verified."""
    sweep_pending()
    os.makedirs(_pending_dir(), exist_ok=True)
    state.write_json_atomic(_pending_path(email), {
        "ct": _fernet().encrypt(key.encode()).decode(),
        "exp": time.time() + PENDING_MINUTES * 60})


def take(email):
    """The held key for this email (and forget it), or None when there
    is none or it expired."""
    p = _pending_path(email)
    try:
        with open(p) as fh:
            rec = json.load(fh)
    except (OSError, ValueError):
        return None
    try:
        os.remove(p)
    except OSError:
        pass
    if rec.get("exp", 0) < time.time():
        return None
    try:
        return _fernet().decrypt(rec["ct"].encode()).decode()
    except Exception:
        return None


def has_pending(email):
    sweep_pending()
    return os.path.exists(_pending_path(email))


START_PER_IP_HOUR = 3
START_PER_EMAIL_DAY = 3
CREATE_PER_IP_DAY = 10
_start_ip, _start_email, _create_ip = {}, {}, {}


def _hit(bucket, k, window, limit, now):
    hits = [t for t in bucket.get(k, []) if now - t < window]
    if len(hits) >= limit:
        bucket[k] = hits
        return False
    bucket[k] = hits + [now]
    if len(bucket) > 10000:
        for kk in [kk for kk, v in bucket.items() if not v or now - v[-1] >= window]:
            bucket.pop(kk, None)
    return True


def allow_start(ip, email, now=None):
    now = time.time() if now is None else now
    return (_hit(_start_ip, ip, 3600, START_PER_IP_HOUR, now)
            and _hit(_start_email, email, 86400, START_PER_EMAIL_DAY, now))


def allow_create(ip, now=None):
    now = time.time() if now is None else now
    return _hit(_create_ip, ip, 86400, CREATE_PER_IP_DAY, now)
