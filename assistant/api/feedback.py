"""Feature requests and contact notes — one append-only file in the
data root (feedback.jsonl), shared by every account. A note carries
the kind, the text, the account's username and a timestamp; nothing
else is collected. Deterministic code, $0, no model calls.
Spam guard: a daily cap per account, a length cap, and an identical
repeat is refused. The owner (the first account) reads the list.
"""
import json, os, re, time

from api import auth, state

KINDS = ("idea", "bug", "question")
MAX_CHARS = 1000
DAILY_CAP = int(os.environ.get("ARYA_FEEDBACK_DAILY_CAP", "5"))
_FILE = "feedback.jsonl"


def _root_call(fn):
    """Run fn with the per-user context cleared: the file lives in
    the data root, not in one household's directory."""
    tok = state._current_user.set(None)
    try:
        return fn()
    finally:
        state._current_user.reset(tok)


def _path():
    return os.path.join(state.data_dir(), _FILE)


def _read():
    p = _path()
    if not os.path.exists(p):
        return []
    out = []
    with open(p) as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    return out


def submit(user, kind, text):
    kind = (kind or "").strip().lower()
    text = (text or "").strip()
    if kind not in KINDS:
        raise ValueError("pick Idea, Bug or Question")
    if not text:
        raise ValueError("write a few words first")
    if len(text) > MAX_CHARS:
        raise ValueError(f"keep it under {MAX_CHARS} characters")

    def _go():
        with state.file_lock(_FILE):
            notes = _read()
            now = int(time.time())
            mine = [n for n in notes if n.get("user") == user]
            if sum(1 for n in mine if now - n.get("at", 0) < 86400) >= DAILY_CAP:
                raise PermissionError("that is enough for today — try again tomorrow")
            if any(n.get("text") == text for n in mine):
                raise ValueError("you already sent that")
            note = {"at": now, "user": user, "kind": kind, "text": text}
            os.makedirs(os.path.dirname(_path()), exist_ok=True)
            with open(_path(), "a") as fh:
                fh.write(json.dumps(note) + "\n")
            return note
    return _root_call(_go)


# The demo door: a demo visitor has no account, so the note carries
# the visitor's email (how the owner invites them to the beta) and the
# name "demo-visitor". Capped per email per day, plus a day-wide cap so
# the one demo write that reaches disk stays bounded. The address is
# stored with the note and never logged or mailed.
DEMO_USER = "demo-visitor"
DEMO_DAILY_CAP = 200
DEMO_EMAIL_CAP = 3
MAX_EMAIL = 200
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def submit_demo(text, email):
    text = (text or "").strip()
    email = (email or "").strip().lower()
    if not text:
        raise ValueError("write a few words first")
    if len(text) > MAX_CHARS:
        raise ValueError(f"keep it under {MAX_CHARS} characters")
    if len(email) > MAX_EMAIL or not _EMAIL.match(email):
        raise ValueError("add the email you want to be invited at")

    def _go():
        with state.file_lock(_FILE):
            notes = _read()
            now = int(time.time())
            today = [n for n in notes if n.get("user") == DEMO_USER
                     and now - n.get("at", 0) < 86400]
            if len(today) >= DEMO_DAILY_CAP:
                raise PermissionError("feedback is full for today, please try tomorrow")
            if sum(1 for n in today if n.get("contact") == email) >= DEMO_EMAIL_CAP:
                raise PermissionError("that is enough for today, thank you")
            note = {"at": now, "user": DEMO_USER, "kind": "beta",
                    "text": text, "contact": email}
            os.makedirs(os.path.dirname(_path()), exist_ok=True)
            with open(_path(), "a") as fh:
                fh.write(json.dumps(note) + "\n")
            return note
    return _root_call(_go)


def is_owner(user):
    def _go():
        names = list(auth.users())
        return bool(names) and names[0] == user
    return _root_call(_go)


def anonymize_user(user):
    """Account deletion: the notes stay (they may carry a bug
    worth fixing) but the name goes — rewritten to a tombstone."""
    def go():
        p = _path()
        if not os.path.exists(p):
            return
        notes = _read()
        if not any(n.get("user") == user for n in notes):
            return
        tmp = p + ".tmp"
        with open(tmp, "w") as fh:
            for n in notes:
                if n.get("user") == user:
                    n = {**n, "user": "deleted-account"}
                fh.write(json.dumps(n) + "\n")
        os.replace(tmp, p)
    return _root_call(go)


def list_all():
    return _root_call(lambda: list(reversed(_read())))
