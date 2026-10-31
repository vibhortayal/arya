"""The sign-in waitlist (owner, 2026-10-30): a visitor leaves an email so
the owner can invite them while sign-in is closed. One append-only file in
the data root (waitlist.jsonl); each row is the lower-cased address and
the time it was added, nothing else (no name, IP or device). The address
is never logged or mailed; the owner invites by hand. Remove an address,
export, or purge with `python -m harness.waitlist`. Deterministic code,
$0, no model calls.
"""
import json, os, re, time

from api import state
from api.feedback import _root_call

MAX_EMAIL = 200
MAX_ROWS = int(os.environ.get("ARYA_WAITLIST_MAX", "5000"))
_FILE = "waitlist.jsonl"
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _path():
    return os.path.join(state.data_dir(), _FILE)


def rows():
    """All rows. The file lives in the data root, so read it with the
    per-user context cleared (a signed-in owner would otherwise read
    their own folder)."""
    return _root_call(_read)


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


def clean(email):
    email = (email or "").strip().lower()
    if len(email) > MAX_EMAIL or not _EMAIL.match(email):
        raise ValueError("that email does not look right")
    return email


def join(email):
    """Add an address. Returns "added", or "already" if it was listed."""
    email = clean(email)

    def _go():
        with state.file_lock(_FILE):
            have = rows()
            if any(r.get("email") == email for r in have):
                return "already"
            if len(have) >= MAX_ROWS:
                raise PermissionError("the waitlist is full for now")
            os.makedirs(os.path.dirname(_path()), exist_ok=True)
            with open(_path(), "a") as fh:
                fh.write(json.dumps({"email": email, "at": int(time.time())}) + "\n")
            return "added"
    return _root_call(_go)


def remove(email):
    """Delete one address. Returns True if it was there."""
    email = (email or "").strip().lower()

    def _go():
        with state.file_lock(_FILE):
            have = rows()
            keep = [r for r in have if r.get("email") != email]
            if len(keep) == len(have):
                return False
            _rewrite(keep)
            return True
    return _root_call(_go)


def _rewrite(keep):
    tmp = _path() + ".tmp"
    with open(tmp, "w") as fh:
        fh.write("".join(json.dumps(r) + "\n" for r in keep))
    os.replace(tmp, _path())


def approve(emails):
    """Mark addresses as invited (owner). They may then sign in with an
    email code or Google. Returns the addresses that were on the list and
    not approved yet. Nothing is mailed here."""
    want = {(e or "").strip().lower() for e in emails}

    def _go():
        with state.file_lock(_FILE):
            have, done, now = rows(), [], int(time.time())
            for r in have:
                if r.get("email") in want and not r.get("approved"):
                    r["approved"] = now
                    r.pop("rejected", None)
                    done.append(r["email"])
            if done:
                _rewrite(have)
            return done
    return _root_call(_go)


def reject(emails):
    """Mark addresses as rejected (owner, 2026-10-31). The row stays, so the
    person cannot rejoin and show up in Waiting again; they see nothing
    different (join still answers "already") and no mail is sent. Returns
    the addresses that were on the list and not rejected yet."""
    return _mark(emails, lambda r, now: (r.pop("approved", None), r.__setitem__("rejected", now)),
                 lambda r: not r.get("rejected"))


def restore(emails):
    """Put addresses back to waiting: clears approved and rejected."""
    return _mark(emails, lambda r, now: (r.pop("approved", None), r.pop("rejected", None)),
                 lambda r: r.get("approved") or r.get("rejected"))


def _mark(emails, change, applies):
    want = {(e or "").strip().lower() for e in emails}

    def _go():
        with state.file_lock(_FILE):
            have, done, now = rows(), [], int(time.time())
            for r in have:
                if r.get("email") in want and applies(r):
                    change(r, now)
                    done.append(r["email"])
            if done:
                _rewrite(have)
            return done
    return _root_call(_go)


def send_invite(email):
    """Email the sign-in code to an approved address through Supabase.
    Best effort: True if the mail was handed over."""
    from api import supabase_auth
    if not supabase_auth.configured():
        return False
    try:
        supabase_auth.send_code(clean(email))
        return True
    except (supabase_auth.AuthError, ValueError):
        return False


def is_approved(email):
    email = (email or "").strip().lower()
    return _root_call(lambda: any(r.get("email") == email and r.get("approved") and not r.get("rejected") for r in rows()))


def purge():
    """Delete the whole list (owner, once sign-in is open)."""
    def _go():
        with state.file_lock(_FILE):
            n = len(rows())
            if os.path.exists(_path()):
                os.remove(_path())
            return n
    return _root_call(_go)
