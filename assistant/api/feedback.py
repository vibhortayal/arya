"""Feature requests and contact notes — one append-only file in the
data root (feedback.jsonl), shared by every account. A note carries
the kind, the text, the account's username and a timestamp; nothing
else is collected. Deterministic code, $0, no model calls.
Spam guard: a daily cap per account, a length cap, and an identical
repeat is refused. The owner (the first account) reads the list.
"""
import json, os, time

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


def is_owner(user):
    def _go():
        names = list(auth.users())
        return bool(names) and names[0] == user
    return _root_call(_go)


def list_all():
    return _root_call(lambda: list(reversed(_read())))
