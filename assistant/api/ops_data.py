"""Owner data tools behind the Ops screen (2026-11-01): erase one
account's receipts or learned names, and the Supabase mirror backfill and
verify jobs. Each erase saves a copy first (ops-deleted/ in the data
folder) and the caller has already made the owner type the account name."""
import json
import os
import threading
import time

from api import groups, pgstore, state

WHAT = {"receipts": ("receipts.json", []), "names": ("dictionary.json", {"entries": []})}


def delete_data(acct, what):
    """Erase receipts or learned names for one account. A copy goes to
    ops-deleted/ first. Learned names of an account in a group belong to
    the group, so they are refused here (they would erase the others')."""
    name, empty = WHAT[what]
    gid = groups.group_id_for(acct)
    if what == "names" and gid:
        raise ValueError("this account is in a group; the learned names are shared with the group")
    with state.as_user(acct, gid):
        cur = state._load(name, empty)
        d = os.path.join(state.base_dir(), "ops-deleted")
        os.makedirs(d, exist_ok=True)
        stamp = time.strftime("%Y%m%dT%H%M%S")
        safe = acct.replace("/", "_")
        with open(os.path.join(d, f"{stamp}-{safe}-{what}.json"), "w") as fh:
            json.dump(cur, fh)
        state._save(name, empty)
    n = len(cur) if isinstance(cur, list) else len(cur.get("entries", []))
    return {"saved_copy": True, "removed": n}


# --- Supabase mirror job -----------------------------------------------------
_job = {"state": "idle", "kind": "", "started": 0, "finished": 0, "done": 0, "total": 0, "result": "", "ok": None}
_lock = threading.Lock()


def job():
    return dict(_job)


def _files():
    """(owner, name, path) for every document that pgstore would keep."""
    base = state.base_dir()
    out = []
    for fn in sorted(os.listdir(base)) if os.path.isdir(base) else []:
        p = os.path.join(base, fn)
        if fn.endswith(".json") and os.path.isfile(p) and pgstore.uses_pg("", fn):
            out.append(("", fn, p))
    ud = os.path.join(base, "users")
    for u in sorted(os.listdir(ud)) if os.path.isdir(ud) else []:
        for fn in sorted(os.listdir(os.path.join(ud, u))):
            p = os.path.join(ud, u, fn)
            if fn.endswith(".json") and os.path.isfile(p) and pgstore.uses_pg(u, fn):
                out.append((u, fn, p))
    gd = os.path.join(base, "groups")
    for g in sorted(os.listdir(gd)) if os.path.isdir(gd) else []:
        for fn in sorted(os.listdir(os.path.join(gd, g))):
            p = os.path.join(gd, g, fn)
            if fn.endswith(".json") and os.path.isfile(p) and pgstore.uses_pg("group:" + g, fn):
                out.append(("group:" + g, fn, p))
    return out


def _run(kind):
    try:
        files = _files()
        _job.update(total=len(files), done=0)
        bad = []
        for owner, name, p in files:
            try:
                with open(p) as fh:
                    obj = json.load(fh)
                if kind == "backfill":
                    pgstore.write(owner, name, obj)
                else:
                    got = pgstore.read(owner, name)
                    if got is pgstore._MISSING or got != obj:
                        bad.append(f"{owner or 'root'}/{name}")
            except Exception as e:   # one bad file never stops the job
                bad.append(f"{owner or 'root'}/{name}: {type(e).__name__}")
            _job["done"] += 1
        ok = not bad
        what = "copied" if kind == "backfill" else "match"
        _job.update(ok=ok, result=f"{len(files) - len(bad)} of {len(files)} {what}"
                    + ("" if ok else f". Problems: {', '.join(bad[:5])}" + (" and more" if len(bad) > 5 else "")))
    except Exception as e:
        _job.update(ok=False, result=f"Could not run: {type(e).__name__}")
    finally:
        _job.update(state="idle", finished=int(time.time()))


def start(kind):
    """Run backfill or verify in the background. False if one is running
    or the database is not configured."""
    if kind not in ("backfill", "verify"):
        raise ValueError("kind must be backfill or verify")
    if not os.environ.get("DATABASE_URL"):
        raise ValueError("DATABASE_URL is not set on the server")
    with _lock:
        if _job["state"] == "running":
            return False
        _job.update(state="running", kind=kind, started=int(time.time()), finished=0, done=0, total=0, result="", ok=None)
    threading.Thread(target=_run, args=(kind,), daemon=True).start()
    return True
