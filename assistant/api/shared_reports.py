"""Shared "Not here" reports (owner, 2026-11-03: "build it").

Tapping Not here tells other Arya shoppers the item is gone. Each
report also lands here, in one shared file in the data root (the
storemap pattern), so the next shopper's hunt flags that stop and
their Today store alerts show it.

What is kept per report: the store, the item, its group, the kind,
the time and a short hash of the account (never the name, the
session, a photo or the list). A report clears after 3 days, sooner
when any shopper finds the item at that store, and when its reporter
takes it back. One open report per account per store and item; at
most 30 shared reports per account a day; at most 500 per store.
Other shoppers see a store and item only once ARYA_REPORT_QUORUM
distinct accounts (default 3) have reported it.

The file is root plane (one copy for everyone), so the lock and every
load and save run with the user context cleared, as storemap does.
Demo visitors write to their own sandbox overlay, so a judge never
adds to the real file (state._save routes sandbox writes there)."""
import datetime, hashlib, os

from api import state

FILE = "store_reports.json"
TTL_S = 3 * 86400
PER_DAY = 30
PER_STORE = 500


def quorum():
    """Distinct accounts needed before other shoppers see a report
    (owner, 2026-11-03). ARYA_REPORT_QUORUM, default 3, at least 1."""
    try:
        return max(1, int(os.environ.get("ARYA_REPORT_QUORUM") or 3))
    except ValueError:
        return 3


def store_key(name):
    """Store identity across accounts: the store family ("COSTCO WHSE
    #0423" and "Costco Fremont" are both costco), else the normalized
    name with spaces ignored."""
    from api.quest import _store_family
    fam = _store_family(name)
    return fam or state._norm_name(name or "").replace(" ", "")


def item_key(name):
    """Item identity across accounts: the normalized name with a plural
    last word made singular (quest._match_name). Never an account's own
    group id, which differs between accounts."""
    from api.quest import _match_name
    return _match_name(name)


def _store_key(name):
    return store_key(name)


def _item_key(group, name):
    return item_key(name)


def who():
    """A short stable hash of the signed-in account (as storemap does)."""
    user = state._current_user.get() or "anon"
    return hashlib.sha1(("reports|" + user).encode()).hexdigest()[:8]


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _age_s(iso, now):
    try:
        t = datetime.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=datetime.timezone.utc)
    except (TypeError, ValueError):
        return None
    return (now - t).total_seconds()


class _Root:
    """Run with the user context cleared, so _load/_save hit the data
    root (the sandbox overlay still catches a demo visitor's writes)."""
    def __enter__(self):
        self._tok = state._current_user.set(None)
        return self

    def __exit__(self, *exc):
        state._current_user.reset(self._tok)


def _load():
    with _Root():
        return state._load(FILE, {})


def _locked():
    with _Root():
        return state.file_lock(FILE)


def _save(doc):
    with _Root():
        state._save(FILE, doc)


def _fresh(rows, now):
    return [r for r in rows if (_age_s(r.get("at"), now) or TTL_S) < TTL_S]


def add(store, item, group, kind):
    """Share one report. Returns the shared row, the account's existing
    open row for the same store and item, or None over the daily cap."""
    me, now = who(), _now()
    sk, ik = _store_key(store), _item_key(group, item)
    if not sk or not ik:
        return None
    with _locked():
        doc = _load()
        today = 0
        for key in list(doc):
            doc[key] = _fresh(doc[key], now)
            if not doc[key]:
                del doc[key]
                continue
            today += sum(1 for r in doc[key] if r.get("by") == me
                         and (_age_s(r.get("at"), now) or 0) < 86400)
        rows = doc.get(sk, [])
        for r in rows:
            if r.get("by") == me and r.get("item_key") == ik:
                return r
        if today >= PER_DAY:
            return None
        row = {"store_key": sk, "item_key": ik, "kind": kind,
               "at": _iso(now), "by": me}
        rows.append(row)
        doc[sk] = rows[-PER_STORE:]
        _save(doc)
        return row


def take_back(store, item, group):
    """The reporter withdrew: drop their shared row for this item."""
    _drop(store, item, group, only=who())


def found(store, item, group):
    """Any shopper found the item at this store: every report clears."""
    _drop(store, item, group, only=None)


def _drop(store, item, group, only):
    sk = _store_key(store)
    keys = {item_key(item)}
    with _locked():
        doc = _load()
        rows = doc.get(sk)
        if not rows:
            return
        # The same item by its core words too (#577): grabbing "Large
        # eggs" clears an "Eggs" report, as the alert reached that shopper.
        from api.quest import _core_tokens
        core = _core_tokens(item)
        same = lambda k: k in keys or (core and _core_tokens(k) == core)
        keep = [r for r in rows if not (
            same(r.get("item_key")) and (only is None or r.get("by") == only))]
        if len(keep) == len(rows):
            return
        if keep:
            doc[sk] = keep
        else:
            del doc[sk]
        _save(doc)


def groups(store=None):
    """Store-and-item groups that passed the quorum, for one store or
    all: [{store_key, item_key, kind, count, latest, oldest, mine}]. count is
    distinct accounts (the hash, not repeats) with a fresh open report;
    expired and found reports are already gone, so they never count.
    mine says whether this account is one of them. Nothing here names
    an account or carries a reporter's typed words."""
    me, now, need = who(), _now(), quorum()
    doc = _load()
    keys = [store_key(store)] if store is not None else list(doc)
    out = []
    for k in keys:
        by_item = {}
        for r in _fresh(doc.get(k, []), now):
            g = by_item.setdefault(r.get("item_key"), {"who": set(), "latest": "", "kind": None,
                                                       "oldest": r.get("at") or ""})
            g["who"].add(r.get("by"))
            if (r.get("at") or "") < g["oldest"]:
                g["oldest"] = r.get("at") or ""
            if (r.get("at") or "") > g["latest"]:
                g["latest"], g["kind"] = r.get("at"), r.get("kind")
        for ik, g in by_item.items():
            others = g["who"] - {me}
            if len(g["who"]) < need or not others:
                continue
            out.append({"store_key": k, "item_key": ik, "kind": g["kind"],
                        "count": len(g["who"]), "latest": g["latest"],
                        "oldest": g["oldest"], "mine": me in g["who"]})
    return out
