"""Auth — household accounts + session cookies (Stage 3).
Passwords: PBKDF2-HMAC-SHA256 (stdlib), per-user salt, compare_digest.
Sessions: random tokens in a JSON store, httpOnly cookies.
Bootstrap rule: the first account is created via /auth/setup, which is
open only while zero users exist; the first account adopts the household
data already in the store (the seeded corpus).
Data is per-user: state lives under data/users/<username>/.
"""
import hashlib, hmac, json, os, re, secrets, threading, time
from collections import OrderedDict

SESSION_TTL = 30 * 24 * 3600
COOKIE = "arya_session"


def _root():
    from api.state import data_dir
    return data_dir()


def _path(name):
    return os.path.join(_root(), name)


def _owner():
    from api.state import _owner
    return _owner()


def _load(name, default):
    from api import pgstore
    if pgstore.mode() == "pg" and pgstore.uses_pg(_owner(), name):
        v = pgstore.read(_owner(), name)
        return default if v is pgstore._MISSING else v
    p = _path(name)
    if os.path.exists(p):
        with open(p) as fh:
            return json.load(fh)
    return default


def _save(name, obj):
    # Same durability contract as the household store (state.py):
    # temp file + os.replace, serialized per file.
    from api.state import write_json_atomic
    from api import pgstore
    if pgstore.uses_pg(_owner(), name):
        if pgstore.mode() == "pg":
            pgstore.write(_owner(), name, obj)
            return
        write_json_atomic(_path(name), obj)
        pgstore.mirror(_owner(), name, obj)
        return
    write_json_atomic(_path(name), obj)


def _file_lock(name):
    from api.state import lock_for
    return lock_for(_path(name))


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return salt, dk.hex()


def users():
    return _load("users.json", {})


RESERVED = {"demo"}

# An account name is also a folder name (data/users/<name>/), so it may
# only hold characters that cannot leave that folder: letters, digits
# and . _ % + - @, no leading dot, no "..". Plain names (tester-a) and
# email addresses both fit (codebase map 2026-10-29).
_NAME_OK = re.compile(r"[a-z0-9_%+@-][a-z0-9._%+@-]{0,253}")


def valid_name(name):
    return bool(_NAME_OK.fullmatch(name or "")) and ".." not in name


def create_user(username, password):
    username = username.strip().lower()
    if not username or not password:
        raise ValueError("username and password are required")
    if username in RESERVED:
        raise ValueError("that name is reserved")
    if not valid_name(username):
        raise ValueError("use letters, digits and . _ - + @ only")
    with _file_lock("users.json"):
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
                 "curator.json", "quest.json", "lists.json", "settings.json"):
        src = _path(name)
        if os.path.exists(src):
            shutil.move(src, os.path.join(dest, name))


def ensure_federated_user(email):
    """Account for an email that Supabase has verified. An existing
    account with that name is the same person, so it is reused; a new
    one is created with no password (password sign-in refuses it).
    Returns (name, created)."""
    name = (email or "").strip().lower()
    if not name or name in RESERVED or not valid_name(name):
        raise ValueError("that email cannot sign in")
    with _file_lock("users.json"):
        all_users = users()
        if name in all_users:
            return name, False
        first = len(all_users) == 0
        all_users[name] = {"salt": None, "hash": None, "via": "supabase",
                           "created": int(time.time())}
        _save("users.json", all_users)
    if first:
        _adopt_household_data(name)
    return name, True


def set_key_mode(username, mode):
    """"own" for an account that signed up with its own Meta key, or
    "shared" (Arya's key). Only the owner moves own to shared (BYOK
    review 2, change 8)."""
    with _file_lock("users.json"):
        all_users = users()
        if username in all_users:
            all_users[username]["key_mode"] = mode
            _save("users.json", all_users)


def delete_user(username):
    """Erase an account (Tranche 1, register #2): the user record,
    every session, the connector tokens, and the whole per-user
    data directory. Friend mirrors in other accounts and feedback
    attribution are the caller's job (social.scrub_handle,
    feedback.anonymize_user). Runs with the per-user context
    cleared — the registry lives in the data root."""
    username = (username or "").strip().lower()
    with _file_lock("users.json"):
        all_users = users()
        if username not in all_users:
            return False
        del all_users[username]
        _save("users.json", all_users)
    with _file_lock("sessions.json"):
        all_sessions = _load("sessions.json", {})
        _save("sessions.json", {k: v for k, v in all_sessions.items()
                                if v.get("user") != username})
    revoke_api_tokens(username)
    import shutil
    dest = os.path.join(_root(), "users", username)
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    # In dual or pg mode the account's documents also live in Postgres;
    # erasing only the files left that copy behind (security review
    # 2026-11-01, M1). Best effort in dual mode: the files are the truth.
    from api import pgstore
    if pgstore.mode() != "json":
        try:
            pgstore.delete_owner(username)
        except Exception:
            if pgstore.mode() == "pg":
                raise
            pgstore.log.exception("could not drop Postgres rows for a deleted account")
    _delete_codes.pop(username, None)
    return True


def has_password(username):
    """True for an account that signs in with a password. Accounts made
    by email code or Google have none."""
    u = users().get((username or "").strip().lower()) or {}
    return bool(u.get("hash"))


# --- account-deletion codes (owner, 2026-11-01) ---
# An account with no password confirms "delete my account" with a
# 6-digit code emailed to it. Codes live in memory (one worker), last
# DELETE_CODE_TTL seconds, and allow DELETE_CODE_TRIES wrong guesses.
DELETE_CODE_TTL = 10 * 60
DELETE_CODE_TRIES = 5
DELETE_CODE_GAP = 60          # seconds between two sends for one account
_delete_codes = {}            # user -> {"hash", "expires", "tries", "sent"}
_delete_lock = threading.Lock()


def new_delete_code(username):
    """A fresh code for this account, replacing any earlier one. Raises
    PermissionError when one was sent less than DELETE_CODE_GAP ago."""
    now = time.time()
    with _delete_lock:
        cur = _delete_codes.get(username)
        if cur and now - cur["sent"] < DELETE_CODE_GAP:
            raise PermissionError("a code was just sent; wait a minute before asking again")
        code = f"{secrets.randbelow(1_000_000):06d}"
        _delete_codes[username] = {"hash": hashlib.sha256(code.encode()).hexdigest(),
                                   "expires": now + DELETE_CODE_TTL, "tries": 0, "sent": now}
    return code


def check_delete_code(username, code):
    """True once for the right, unexpired code; then it is used up. Too
    many wrong guesses also use it up."""
    code = re.sub(r"\D", "", str(code or ""))
    with _delete_lock:
        cur = _delete_codes.get(username)
        if not cur or cur["expires"] < time.time() or len(code) != 6:
            return False
        if hmac.compare_digest(cur["hash"], hashlib.sha256(code.encode()).hexdigest()):
            _delete_codes.pop(username, None)
            return True
        cur["tries"] += 1
        if cur["tries"] >= DELETE_CODE_TRIES:
            _delete_codes.pop(username, None)
        return False


def resolve_login_name(name):
    """Map what a person typed to an account name. Exact match wins; a
    short name without "@" (tester-a) also matches the one account whose
    email starts with it (tester-a@test.arya) when that is unambiguous."""
    name = (name or "").strip().lower()
    all_users = users()
    if name in all_users or "@" in name or not name:
        return name
    hits = [u for u in all_users if u.split("@", 1)[0] == name]
    return hits[0] if len(hits) == 1 else name


def verify(username, password):
    u = users().get(resolve_login_name(username))
    if not u or not u.get("hash"):
        return False
    _, digest = hash_password(password, u["salt"])
    return hmac.compare_digest(digest, u["hash"])


def _session_key(token):
    # Sessions are stored under the token's SHA-256 — the same
    # scheme as API tokens below — so a leaked sessions.json is
    # not a set of live logins (review 2026-10-28, M5).
    return hashlib.sha256(token.encode()).hexdigest()


# Demo sessions live in memory, like the demo sandbox they point at
# (api/main.py): each "Try the demo" used to add a 30-day row to
# sessions.json (and to Postgres in dual mode) that only expiry ever
# removed (codebase map 2026-10-29). A restart drops them together with
# their sandboxes; the visitor taps "Try the demo" again.
DEMO_SESSIONS_MAX = 5000
_demo_sessions = OrderedDict()   # token hash -> {"user", "demo", "expires"}
_demo_lock = threading.Lock()


def _demo_session(token):
    key = _session_key(token)
    with _demo_lock:
        rec = _demo_sessions.get(key)
        if rec is not None:
            _demo_sessions.move_to_end(key)
        return rec


def new_session(username, demo=False):
    token = secrets.token_urlsafe(32)
    if demo:
        with _demo_lock:
            _demo_sessions[_session_key(token)] = {
                "user": username, "demo": True,
                "expires": int(time.time()) + SESSION_TTL}
            while len(_demo_sessions) > DEMO_SESSIONS_MAX:
                _demo_sessions.popitem(last=False)
        return token
    with _file_lock("sessions.json"):
        # Expired sessions are dead weight — prune them on write so
        # the store cannot grow without bound (review H4).
        now = int(time.time())
        all_sessions = {k: v for k, v in
                        _load("sessions.json", {}).items()
                        if v.get("expires", 0) > now}
        all_sessions[_session_key(token)] = {
            "user": username, "demo": bool(demo),
            "expires": int(time.time()) + SESSION_TTL}
        _save("sessions.json", all_sessions)
    return token


def _session_record(all_sessions, token):
    """Find a session by raw token. A pre-hardening plaintext key
    still authenticates once and is migrated to the hashed key.
    Caller holds the sessions lock."""
    rec = all_sessions.get(_session_key(token))
    if rec is not None:
        return rec
    rec = all_sessions.get(token)
    if rec is not None:
        all_sessions[_session_key(token)] = rec
        del all_sessions[token]
        _save("sessions.json", all_sessions)
    return rec


_SESSIONS_SEEN = (None, {})  # (file key, parsed sessions), swapped whole


def _session_fast(token):
    """The session for a hashed token from an in-memory copy of
    sessions.json, re-read only when the file changes (speed audit #9:
    the login check parsed the file on every request). None when the
    store is Postgres or the token is not there under its hashed key;
    the caller then takes the locked path as before."""
    from api import pgstore
    if pgstore.mode() == "pg" and pgstore.uses_pg(_owner(), "sessions.json"):
        return None
    p = _path("sessions.json")
    try:
        st = os.stat(p)
    except OSError:
        return None
    global _SESSIONS_SEEN
    key = (p, st.st_mtime_ns, st.st_size)
    seen_key, data = _SESSIONS_SEEN
    if seen_key != key:
        try:
            with open(p) as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return None
        _SESSIONS_SEEN = (key, data)
    return data.get(_session_key(token))


def session_info(token):
    if not token:
        return None
    s = _demo_session(token)
    if s is None:
        s = _session_fast(token)
    if s is None:
        with _file_lock("sessions.json"):
            s = _session_record(_load("sessions.json", {}), token)
    if not s or s["expires"] < time.time():
        return None
    return {"user": s["user"], "demo": bool(s.get("demo"))}


def session_user(token):
    if not token:
        return None
    s = _demo_session(token)
    if s is None:
        with _file_lock("sessions.json"):
            s = _session_record(_load("sessions.json", {}), token)
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
    with _file_lock("api_tokens.json"):
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
    with _file_lock("api_tokens.json"):
        tokens = _load("api_tokens.json", {})
        _save("api_tokens.json",
              {h: v for h, v in tokens.items() if v["user"] != username})


def drop_session(token):
    if not token:
        return
    with _demo_lock:
        _demo_sessions.pop(_session_key(token), None)
    with _file_lock("sessions.json"):
        all_sessions = _load("sessions.json", {})
        all_sessions.pop(token, None)            # pre-hardening key
        all_sessions.pop(_session_key(token), None)
        _save("sessions.json", all_sessions)
