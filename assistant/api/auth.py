"""Auth — household accounts + session cookies (Stage 3).
Passwords: PBKDF2-HMAC-SHA256 (stdlib), per-user salt, compare_digest.
Sessions: random tokens in a JSON store, httpOnly cookies.
Bootstrap rule: the first account is created via /auth/setup, which is
open only while zero users exist; the first account adopts the household
data already in the store (the seeded corpus).
Data is per-user: state lives under data/users/<username>/.
"""
import hashlib, hmac, json, os, secrets, time

SESSION_TTL = 30 * 24 * 3600
COOKIE = "arya_session"


def _root():
    from api.state import data_dir
    return data_dir()


def _path(name):
    return os.path.join(_root(), name)


def _load(name, default):
    p = _path(name)
    return json.load(open(p)) if os.path.exists(p) else default


def _save(name, obj):
    os.makedirs(_root(), exist_ok=True)
    json.dump(obj, open(_path(name), "w"), indent=1)


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return salt, dk.hex()


def users():
    return _load("users.json", {})


RESERVED = {"demo"}


def create_user(username, password):
    username = username.strip().lower()
    if not username or not password:
        raise ValueError("username and password are required")
    if username in RESERVED:
        raise ValueError("that name is reserved")
    all_users = users()
    if username in all_users:
        raise ValueError("user exists")
    first = len(all_users) == 0
    salt, digest = hash_password(password)
    all_users[username] = {"salt": salt, "hash": digest, "created": int(time.time())}
    _save("users.json", all_users)
    if first:
        _adopt_household_data(username)
    return username


def _adopt_household_data(username):
    """Move pre-auth household files under the first user's directory."""
    import shutil
    dest = os.path.join(_root(), "users", username)
    os.makedirs(dest, exist_ok=True)
    for name in ("receipts.json", "dictionary.json", "cart.json", "flags.json",
                 "curator.json", "quest.json"):
        src = _path(name)
        if os.path.exists(src):
            shutil.move(src, os.path.join(dest, name))


def verify(username, password):
    u = users().get((username or "").strip().lower())
    if not u:
        return False
    _, digest = hash_password(password, u["salt"])
    return hmac.compare_digest(digest, u["hash"])


def new_session(username, demo=False):
    token = secrets.token_urlsafe(32)
    all_sessions = _load("sessions.json", {})
    all_sessions[token] = {"user": username, "demo": bool(demo),
                           "expires": int(time.time()) + SESSION_TTL}
    _save("sessions.json", all_sessions)
    return token


def session_info(token):
    if not token:
        return None
    s = _load("sessions.json", {}).get(token)
    if not s or s["expires"] < time.time():
        return None
    return {"user": s["user"], "demo": bool(s.get("demo"))}


def session_user(token):
    if not token:
        return None
    s = _load("sessions.json", {}).get(token)
    if not s or s["expires"] < time.time():
        return None
    return s["user"]


# --- API tokens (connector access, e.g. the Muse connector) ---
# One live token per account; minting replaces. Only the SHA-256 hash is
# stored; the raw token is shown once, at mint time, in the app.

def _token_hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def new_api_token(username):
    raw = "arya_" + secrets.token_urlsafe(32)
    tokens = _load("api_tokens.json", {})
    tokens = {h: v for h, v in tokens.items() if v["user"] != username}
    tokens[_token_hash(raw)] = {"user": username, "created": int(time.time())}
    _save("api_tokens.json", tokens)
    return raw


def api_token_user(raw):
    if not raw:
        return None
    rec = _load("api_tokens.json", {}).get(_token_hash(raw.strip()))
    return rec["user"] if rec else None


def has_api_token(username):
    return any(v["user"] == username
               for v in _load("api_tokens.json", {}).values())


def revoke_api_tokens(username):
    tokens = _load("api_tokens.json", {})
    _save("api_tokens.json",
          {h: v for h, v in tokens.items() if v["user"] != username})


def drop_session(token):
    all_sessions = _load("sessions.json", {})
    all_sessions.pop(token, None)
    _save("sessions.json", all_sessions)
