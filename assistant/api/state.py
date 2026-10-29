"""Household state — file-backed store (Stage 3 v1).
Files in ARYA_DATA_DIR: receipts.json (DecodedReceipts), dictionary.json,
cart.json, flags.json. Derived state (ledger/patterns/list) is recomputed
on read — at household scale that is milliseconds, and it can never drift
from the stored receipts. Postgres replaces the files when volume demands.
"""
import copy, json, os, tempfile, threading
from datetime import date, timedelta

from api.ledger.build import build_ledger
from api.patterns.engine import summarize
from api.list.build import build_list
from api.cart.build import prepare

import contextvars

from api import pgstore

_current_user = contextvars.ContextVar("arya_user", default=None)
# The demo sandbox (review 2026-10-28): a demo visitor's writes land in
# an in-memory overlay keyed by file path, never on disk. Reads see the
# overlay first, then the shipped demo household. One overlay per demo
# session (api/main.py), so two judges never see each other's hunts.
_overlay = contextvars.ContextVar("arya_overlay", default=None)
# Caches that hold no visitor state still write through from the
# sandbox, so a repeat item never costs a second model call.
_WRITE_THROUGH = {"shelf_matches.json"}
OVERLAY_MAX_BYTES = 2_000_000


def base_dir():
    return os.environ.get("ARYA_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))


def user_dir(user):
    # Belt and braces for auth.valid_name: a name that could
    # leave data/users/ never becomes a path.
    if os.sep in user or "/" in user or user.startswith("."):
        raise ValueError("invalid account name")
    return os.path.join(base_dir(), "users", user)


def data_dir():
    user = _current_user.get()
    if user:
        return user_dir(user)
    return base_dir()


# --- groups (owner, 2026-10-29) ---------------------------------------------
# People in one group share one set of lists. The stores below live in
# the group's plane (data/groups/<id>/, Postgres owner "group:<id>")
# while the account is in a group: the lists, the flags on items
# (list membership, ticks, quantities, "I'm out", expiry dates), the
# cart, and what Arya has learned about products. Receipts stay in
# each account's own plane and are read across every member
# (receipts()); everything else (profile, Quest, reminders, settings,
# photos) stays personal. api/groups.py owns joining and leaving.
GROUP_DOCS = {"lists.json", "flags.json", "cart.json", "dictionary.json",
              "judged.json", "grocery_verdicts.json", "curator.json",
              "second_seat.json"}
_current_group = contextvars.ContextVar("arya_group", default=None)


def group_dir(group_id):
    if not group_id or not all(c.isalnum() for c in group_id):
        raise ValueError("invalid group id")
    return os.path.join(base_dir(), "groups", group_id)


def group_owner(group_id):
    return "group:" + group_id


def current_group():
    return _current_group.get()


def _plane(name):
    """(directory, Postgres owner) a store name reads and writes."""
    gid = _current_group.get()
    if gid and name in GROUP_DOCS:
        return group_dir(gid), group_owner(gid)
    return data_dir(), _owner()


def set_current_user(name):
    _current_user.set(name)
    gid = None
    if name and name != DEMO_USER:
        from api import groups
        gid = groups.group_id_for(name)
    _current_group.set(gid)


class as_user:
    """Run a block as another account (a group member whose receipt is
    being changed, or a member being copied out on leave). The group
    follows the account."""
    def __init__(self, name, group_id=None):
        self.name, self.group_id = name, group_id

    def __enter__(self):
        self._t = (_current_user.set(self.name),
                   _current_group.set(self.group_id))
        return self

    def __exit__(self, *exc):
        _current_user.reset(self._t[0])
        _current_group.reset(self._t[1])
        return False


# --- store durability -------------------------------------------------------
# Writes are atomic and serialized per file (hardening, review
# 2026-10-28 H2): a save goes to a temp file in the same directory
# and lands with os.replace, so a reader sees the old file or the
# new one, never a half-written one; and a per-file RLock serializes
# writers so load-modify-save cycles cannot silently lose updates.
# The lock is re-entrant: a cycle holds file_lock(name) while _save
# takes the same lock again on the same thread.

_file_locks = {}
_file_locks_guard = threading.Lock()


def lock_for(path):
    with _file_locks_guard:
        lk = _file_locks.get(path)
        if lk is None:
            lk = _file_locks[path] = threading.RLock()
        return lk


def file_lock(name):
    """Hold the store lock for one file (by store name) across a
    load-modify-save cycle."""
    return lock_for(os.path.join(_plane(name)[0], name))


def file_lock_at(d, name):
    """The same lock for a store in an explicit plane."""
    return lock_for(os.path.join(d, name))


def write_json_atomic(path, obj):
    with lock_for(path):
        d = os.path.dirname(path)
        os.makedirs(d, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(obj, fh, indent=1)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise


def set_overlay(overlay):
    """Route this request's writes into overlay (a dict), or back to
    disk with None."""
    _overlay.set(overlay)


def in_sandbox():
    return _overlay.get() is not None


def _owner():
    return _current_user.get() or ""


def load_at(d, owner, name, default):
    """Read one store from an explicit plane (directory + Postgres
    owner). _load is this for the current account or group."""
    p = os.path.join(d, name)
    ov = _overlay.get()
    if ov is not None and p in ov:
        return copy.deepcopy(ov[p])
    if pgstore.mode() == "pg" and pgstore.uses_pg(owner, name):
        v = pgstore.read(owner, name)
        return default if v is pgstore._MISSING else v
    if os.path.exists(p):
        with open(p) as fh:
            return json.load(fh)
    return default


def save_at(d, owner, name, obj):
    p = os.path.join(d, name)
    ov = _overlay.get()
    if ov is not None and name not in _WRITE_THROUGH:
        if len(json.dumps(obj)) > OVERLAY_MAX_BYTES:
            raise ValueError("the demo sandbox is full — sign out and open the demo again")
        ov[p] = copy.deepcopy(obj)
        return
    if pgstore.uses_pg(owner, name):
        if pgstore.mode() == "pg":
            pgstore.write(owner, name, obj)
            return
        write_json_atomic(p, obj)
        pgstore.mirror(owner, name, obj)
        return
    write_json_atomic(p, obj)


def _load(name, default):
    d, owner = _plane(name)
    return load_at(d, owner, name, default)


def _save(name, obj):
    d, owner = _plane(name)
    save_at(d, owner, name, obj)


DEMO_USER = "demo"
DEMO_LAG_DAYS = 3


def _demo_shift(rs):
    """The demo household lives in the present week: its fictional
    trips shift so the last one falls DEMO_LAG_DAYS before today.
    The shipped file never changes; only what the app reads moves.
    Receipts a visitor files live (marked live) keep their dates."""
    last = max((r.get("purchased_at") or "" for r in rs
                if not r.get("live")), default="")
    if not last:
        return rs
    try:
        delta = (date.today() - timedelta(days=DEMO_LAG_DAYS)) - date.fromisoformat(last[:10])
    except ValueError:
        return rs
    if not delta.days:
        return rs
    out = []
    for r in rs:
        pa = r.get("purchased_at")
        if pa and not r.get("live"):
            try:
                r = dict(r, purchased_at=(date.fromisoformat(pa[:10]) + delta).isoformat() + pa[10:])
            except ValueError:
                pass
        out.append(r)
    return out


def own_receipts():
    """This account's own receipts: the ones it filed."""
    rs = _load("receipts.json", [])
    if _current_user.get() == DEMO_USER:
        return _demo_shift(rs)
    return rs


def group_members():
    """Account names in the current group, oldest member first; []
    outside a group."""
    gid = _current_group.get()
    if not gid:
        return []
    from api import groups
    return groups.member_names(gid)


def receipts():
    """Every receipt the account can see: its own, plus each group
    member's while it is in a group (owner, 2026-10-29: a receipt
    belongs to whoever filed it; the group sees all of them). In a
    group each one carries "member", the account that filed it.
    Patterns, spend and running low read this, so they recompute
    on their own when someone joins or leaves."""
    me = _current_user.get()
    members = group_members()
    if not members:
        return own_receipts()
    out = []
    for m in members:
        rs = own_receipts() if m == me else load_at(user_dir(m), m, "receipts.json", [])
        out += [dict(r, member=m) for r in rs]
    return out


def receipt_owner(receipt_id):
    """The account that filed a receipt the caller can see, or None."""
    me = _current_user.get()
    for m in group_members() or [me]:
        rs = own_receipts() if m == me else load_at(user_dir(m), m, "receipts.json", [])
        if any(r["receipt_id"] == receipt_id for r in rs):
            return m
    return None


def _media_dir():
    return os.path.join(data_dir(), "receipt-media")


def receipt_media(receipt_id):
    """The kept original's bytes, or None. The id is a server-minted
    slug; anything carrying a path separator is refused outright,
    so a crafted id can never walk out of the media store. In a
    group the bytes are read from the member who filed it."""
    if not receipt_id or os.path.basename(receipt_id) != receipt_id:
        return None
    owner = receipt_owner(receipt_id)
    if owner and owner != _current_user.get():
        with as_user(owner, _current_group.get()):
            return receipt_media(receipt_id)
    p = os.path.join(_media_dir(), receipt_id)
    if not os.path.exists(p):
        return None
    with open(p, "rb") as fh:
        return fh.read()


def add_receipts(new, media=None):
    """File decoded receipts. media maps receipt_id -> (bytes,
    media_type): the original upload for receipts filed from a
    photo or PDF (Discussion 42). The bytes are kept per account
    under receipt-media/, exactly as uploaded, and the record
    carries image_ref + media_type so the original can be served
    back to its owner. Doors that file without an upload (order
    text, JSON imports, the seeded history) pass no media — those
    receipts simply have no original. Retention lives here, in
    the filing path, so every door that files an uploaded
    original keeps it."""
    with file_lock("receipts.json"):
        cur = own_receipts()
        # A receipt another group member already filed is not filed twice.
        seen = {r["receipt_id"] for r in receipts()}
        # A receipt with no date cannot be placed in the ledger; it is refused
        # at the door rather than breaking pattern math later.
        added = [r for r in new if r["receipt_id"] not in seen and r.get("purchased_at")]
        media = media or {}
        for r in added:
            m = media.get(r["receipt_id"])
            if m and not in_sandbox():
                data, media_type = m
                os.makedirs(_media_dir(), exist_ok=True)
                with open(os.path.join(_media_dir(), r["receipt_id"]), "wb") as fh:
                    fh.write(data)
                r["image_ref"] = r["receipt_id"]
                r["media_type"] = media_type
        _save("receipts.json", cur + added)
        return len(added)


def delete_receipt(receipt_id):
    """Remove one filed receipt and its kept original (Tranche 1,
    production register #1). Derived state — ledger, patterns,
    spend — recomputes from the receipt list on every read, so
    removing the record is the whole correction; the caller
    detaches any session the receipt settled (quest)."""
    with file_lock("receipts.json"):
        cur = _load("receipts.json", [])
        gone = [r for r in cur if r["receipt_id"] == receipt_id]
        if not gone:
            return None
        _save("receipts.json",
              [r for r in cur if r["receipt_id"] != receipt_id])
    rec = gone[0]
    if rec.get("image_ref") and \
            os.path.basename(rec["image_ref"]) == rec["image_ref"]:
        p = os.path.join(_media_dir(), rec["image_ref"])
        if os.path.exists(p):
            os.remove(p)
    return rec


def dictionary():
    return _load("dictionary.json", {"entries": []})


def names():
    return {e["item_id"]: e["canonical_name"] for e in dictionary()["entries"]}


def fee_skus():
    return {e["sku"] for e in dictionary()["entries"] if e.get("kind") == "fee"}


def flags():
    return _load("flags.json", {})


MAX_LISTS = 30
MAX_LIST_STORES = 8


def named_lists():
    """The household's named lists (Costco, Indian Store, Party...), in
    creation order. A list is {id, name, stores}; stores are the store
    names a hunt from that list may start at. An item belongs to at
    most one list through its flag's "list" key; an id that matches no
    list here means "Everything else"."""
    return _load("lists.json", {"lists": []}).get("lists", [])


def save_named_lists(rows):
    with file_lock("lists.json"):
        _save("lists.json", {"lists": rows})


def set_flag(item_id, flag):
    with file_lock("flags.json"):
        f = flags()
        f[item_id] = flag
        _save("flags.json", f)


def update_flag(item_id, fn):
    """Read, change and save one item's flag under the flags lock, so
    two quick writes to the same item cannot drop each other's fields
    (codebase map 2026-10-29). fn takes the current flag dict (a copy)
    and returns the new one. Returns the saved flag."""
    with file_lock("flags.json"):
        f = flags()
        new = fn(dict(f.get(item_id, {})))
        f[item_id] = new
        _save("flags.json", f)
        return new


def as_of():
    rs = receipts()
    return max((r["purchased_at"] for r in rs), default=None)


def today_ref():
    """The day "days ago" and "due" are measured from: today, or the
    last receipt when that is later (a future-dated fixture). as_of()
    alone froze the clock at the last receipt, so staples never grew
    due as days passed (QA 2026-10-28). The per-cycle flags (dismissed,
    checked) still key on as_of(): they reset when a receipt lands."""
    from datetime import date as _date
    return max(as_of() or "", _date.today().isoformat())


def _norm_name(s):
    import re as _re
    return _re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def group_map():
    """item_id -> representative item_id. The group key is the entry's
    explicit "group" when the Curator has ruled on it, else the normalized
    canonical name (Costco re-SKUs the same eggs under one name)."""
    by_key = {}
    for e in dictionary()["entries"]:
        key = e.get("group") or _norm_name(e["canonical_name"])
        by_key.setdefault(key, []).append(e["item_id"])
    out = {}
    for ids in by_key.values():
        if len(ids) > 1:
            rep = sorted(ids)[0]
            for i in ids:
                out[i] = rep
    return out


def set_entry_group(item_ids, group_key, rename_rep=None):
    """Curator apply path: pin entries to an explicit group key. The key
    is the representative item_id for a merge, or the entry's own id for
    a split. rename_rep optionally renames the representative entry."""
    with file_lock("dictionary.json"):
        d = dictionary()
        by_id = {e["item_id"]: e for e in d["entries"]}
        for iid in item_ids:
            if iid in by_id:
                by_id[iid]["group"] = group_key
        if rename_rep and group_key in by_id:
            by_id[group_key]["canonical_name"] = rename_rep
        _save("dictionary.json", d)


def curator_store():
    return _load("curator.json", {"proposals": [], "dismissed": []})


def save_curator(store):
    _save("curator.json", store)


def _group_entries(entries):
    gm = group_map()
    if not gm:
        return entries
    for e in entries:
        e["item_id"] = gm.get(e["item_id"], e["item_id"])
    return entries


def derived():
    rs = receipts()
    entries = _group_entries(build_ledger(rs, fee_skus=fee_skus()))
    patterns = summarize(entries, as_of=today_ref())
    fl = flags()
    today = as_of()
    def hidden(pid):
        f = fl.get(pid, {})
        # A snooze runs to its date on the calendar, not to the last
        # receipt: measured from as_of() it never ended while no new
        # receipt landed.
        return f.get("never") or (f.get("snoozed_until") and f["snoozed_until"] >= today_ref())
    # Stage 4: Eyes corrections + user reports adjust the patterns.
    from datetime import date as _date
    gm = group_map()
    sightings = {}
    for k, v in confirmed_sightings().items():
        key = gm.get(k, k)
        if key not in sightings or v["date"] > sightings[key]["date"]:
            sightings[key] = v
    nm = names()
    for p in patterns:
        sg = sightings.get(p["item_id"])
        if sg and p.get("last_bought") and sg["date"] > p["last_bought"] and p["median_interval_days"]:
            seen_on = _date.fromisoformat(sg["date"])
            now = _date.fromisoformat(today_ref())
            since = (now - seen_on).days
            p["seen"] = {"date": sg["date"], "kind": sg.get("kind")}
            p["days_since_last"] = since
            if since < p["median_interval_days"]:
                p["due"] = False
        f = fl.get(p["item_id"], {})
        if _reported_out(p, f):
            p["due"] = True
            p["user_report"] = ("expired " + f["expired"]) if f.get("expired") else "you said you're out"
    unresolved_ids = {e["item_id"] for e in dictionary()["entries"]
                      if e.get("resolution", {}).get("status") == "unresolved"}
    judged = judgments()
    for p in patterns:
        if p["item_id"] in judged:
            p["judge"] = judged[p["item_id"]]
    visible = [p for p in patterns
               if not hidden(p["item_id"]) and p["item_id"] not in unresolved_ids
               and _admitted(p, judged, fl)]
    admitted_ids = {p["item_id"] for p in visible}
    for p in patterns:
        p["admitted"] = p["item_id"] in admitted_ids
    smart = build_list(visible)
    have = {i["item_id"] for i in smart["items"]}
    # "I'm out" / "expired" is the user's word and needs no history:
    # build_list wants 3 buys, so an item with fewer would be told
    # "it's on the list" and then not be there.
    for p in visible:
        if p.get("user_report") and p["item_id"] not in have:
            smart["items"].append({
                "item_id": p["item_id"], "qty": p["typical_qty"],
                "due_reason": p["user_report"].capitalize(),
                "source": "pattern"})
            have.add(p["item_id"])
    for pid, f in fl.items():
        if f.get("manual") and pid not in have:
            by = f.get("added_by")
            row = {"item_id": pid, "qty": 1,
                   "due_reason": f"Added by {by}" if by else "Added by you",
                   "source": "user"}
            if by:
                row["added_by"] = by
                if f.get("approved"):
                    row["approved"] = True
            smart["items"].append(row)
    kept = []
    list_ids = {l["id"] for l in named_lists()}
    pats = {p["item_id"]: p for p in patterns}
    for item in smart["items"]:
        f = fl.get(item["item_id"], {})
        if item.get("source") == "pattern" and f.get("dismissed_on") == today:
            continue  # removed for this cycle; returns when a new receipt lands
        # The List overhaul (owner, 2026-10-29): a list shows only what
        # the household put on it. Arya's due staples are suggestions
        # until the user adds one. "I'm out" is the user's own word and
        # goes straight on; an expired item stays a suggestion.
        p = pats.get(item["item_id"])
        out_now = bool(f.get("out")) and not f.get("expired") and (p is None or _reported_out(p, f))
        item["on_list"] = bool(f.get("manual")) or item.get("source") == "user" or out_now
        if p and p.get("median_interval_days"):
            item["every_days"] = round(p["median_interval_days"])
            item["days_since"] = p.get("days_since_last")
        if f.get("expired") and p is not None and _reported_out(p, f):
            item["expired_on"] = f["expired"]
        if f.get("qty_override"):
            item["qty"] = f["qty_override"]
        if f.get("unit"):
            item["unit"] = f["unit"]
        if f.get("added_by") and f.get("manual"):
            item["added_by"] = f["added_by"]
            if f.get("approved"):
                item["approved"] = True
        if f.get("checked_on") and f.get("checked_on") == today:
            item["checked"] = True
        if f.get("list") in list_ids:
            item["list"] = f["list"]
        kept.append(item)
    smart["items"] = kept
    verdicts = grocery_verdicts()
    for item in smart["items"]:
        f = fl.get(item["item_id"], {})
        item["name"] = f.get("name") or names().get(item["item_id"], item["item_id"])
        # Deterministic and cached only, never a model call here: the
        # list shows "Not a grocery item? Added anyway" for these.
        g = classify_grocery(item["name"], verdicts)
        if g["kind"] == "other":
            item["not_grocery"] = g["sub"] or "other"
        j = judged.get(item["item_id"])
        if j:
            item["judge_reason"] = j.get("reason", "")
            item["judge_class"] = j.get("class", "")
    return {"entries": entries, "patterns": patterns, "smart_list": smart}


def grocery_verdicts():
    return _load("grocery_verdicts.json", {})


def classify_grocery(name, verdicts=None):
    from api.list.grocery import classify
    return classify(name, grocery_verdicts() if verdicts is None else verdicts)


def running_low(d=None):
    """The patterns that are running low: due, admitted by the judge
    (or reported out by the user), and either 3+ kept buys or the
    user's own word. Today and Ask Arya both read this one rule."""
    d = d or derived()
    return [p for p in d["patterns"]
            if p["due"] and p.get("admitted")
            and (p["purchase_count"] >= 3 or p.get("user_report"))]


def judgments():
    return _load("judged.json", {})


def second_seat_store():
    return _load("second_seat.json", {"checked": 0, "agreed": 0,
                                      "disagreements": []})


def save_second_seat(report):
    _save("second_seat.json", report)


def judge_pending(client, limit=60):
    """Judge every pattern (2+ buys) whose verdict is missing or stale.
    Returns how many items were judged. Never raises to the caller."""
    from api.judge import judge_batch, facts_line
    if not getattr(client, "api_key", ""):
        return 0
    entries = _group_entries(build_ledger(receipts(), fee_skus=fee_skus()))
    patterns = summarize(entries, as_of=today_ref())
    judged = judgments()
    nm = names()
    pending = []
    for p in patterns:
        if p["purchase_count"] < 2:
            continue
        cur = judged.get(p["item_id"])
        if cur is None or p["purchase_count"] - cur.get("buys", 0) >= 2:
            pending.append(p)
    done = 0
    for i in range(0, min(len(pending), limit), 25):
        batch = pending[i:i + 25]
        try:
            verdicts = judge_batch(client, [(p["item_id"], facts_line(nm.get(p["item_id"], p["item_id"]), p))
                                            for p in batch])
        except Exception:
            break
        for p in batch:
            v = verdicts.get(p["item_id"])
            if v:
                judged[p["item_id"]] = {**v, "buys": p["purchase_count"]}
                done += 1
    if done:
        # Merge under the lock: a concurrent judge run's verdicts
        # are read fresh and kept, not overwritten by this run's
        # older snapshot.
        with file_lock("judged.json"):
            fresh = judgments()
            fresh.update(judged)
            _save("judged.json", fresh)
    return done


def _reported_out(p, f):
    """Did the user say this item is out or expired, and has no
    purchase landed since? A purchase dated on or after the report
    answers it: the flag stays in the store but stops counting, so a
    restocked item does not stay on the list as "last bought 0 days
    ago"."""
    day = f.get("expired") or f.get("out")
    if not day:
        return False
    return not (p.get("last_bought") and p["last_bought"] >= day)


# Fallback when the staple judge has no verdict: 4+ kept buys, a
# steady rhythm (longest gap at most twice the shortest), and in
# season when the buys bunch into four months. Stricter than the
# judge on purpose: precision over recall (AGENTS.md).
CADENCE_MIN_BUYS = 4
CADENCE_MAX_SPREAD = 2.0


def _cadence_staple(p):
    a = p.get("analysis") or {}
    spread = a.get("gap_spread")
    return (p.get("history_state") == "pattern"
            and p["purchase_count"] >= CADENCE_MIN_BUYS
            and spread is not None and spread <= CADENCE_MAX_SPREAD
            and (p.get("median_interval_days") or 0) >= 2)


def _admitted(p, judged, fl):
    """May this pattern appear on the list? Judge says yes (or the user
    added it by hand); unresolved names stay off. An unjudged item is
    admitted only on a steady cadence (_cadence_staple)."""
    f = fl.get(p["item_id"], {})
    if f.get("manual") or _reported_out(p, f):
        return True  # explicit user intent beats the judge
    v = judged.get(p["item_id"])
    if not v:
        # No verdict yet (no model key, or the judge call failed):
        # an item with an unmistakable rhythm still counts, so Today,
        # List and Ask are not empty. A verdict, once it lands, wins.
        if not _cadence_staple(p):
            return False
    elif not v.get("list_ok"):
        return False
    if p.get("history_state") == "lapsed":
        return False  # silent for over 4x its rhythm: not due, just gone
    if not v or v.get("class") == "SEASONAL":
        months = (p.get("analysis") or {}).get("seasonal_months")
        if months and as_of():
            now_month = int(today_ref()[5:7])
            grace = {((m) % 12) + 1 for m in months}
            if now_month not in months and now_month not in grace:
                return False
    return True


def eyes_records():
    return _load("eyes.json", [])


EYES_MAX = 200  # per account; the oldest photos age out (register #6)


def save_eyes_record(rec):
    with file_lock("eyes.json"):
        records = [r for r in eyes_records() if r["id"] != rec["id"]]
        records.append(rec)
        records.sort(key=lambda r: r["date"])
        pruned = records[:-EYES_MAX] if len(records) > EYES_MAX else []
        _save("eyes.json", records[-EYES_MAX:])
    for old in pruned:
        _drop_eyes_photo(old)


def _drop_eyes_photo(rec):
    photo = rec.get("photo")
    if photo and os.path.basename(photo) == photo:
        p = os.path.join(data_dir(), "eyes_photos", photo)
        if os.path.exists(p):
            os.remove(p)


def delete_eyes_record(rec_id):
    """Remove one Eyes record and its photo (Tranche 1)."""
    with file_lock("eyes.json"):
        records = eyes_records()
        gone = [r for r in records if r["id"] == rec_id]
        if not gone:
            return None
        _save("eyes.json", [r for r in records if r["id"] != rec_id])
    _drop_eyes_photo(gone[0])
    return gone[0]


def name_index():
    idx = {}
    for e in dictionary()["entries"]:
        idx[e["item_id"]] = [e["canonical_name"]] + list(e.get("aliases") or [])
    return idx


def confirmed_sightings():
    """item_id -> latest confirmed sighting {date, kind} (Stage 4)."""
    out = {}
    for rec in eyes_records():
        for sg in rec.get("sightings", []):
            if sg.get("state") == "confirmed" and sg.get("item_id"):
                cur = out.get(sg["item_id"])
                if cur is None or rec["date"] > cur["date"]:
                    out[sg["item_id"]] = {"date": rec["date"], "kind": rec.get("kind")}
    return out


def get_cart():
    d = derived()
    unchecked = {"list_id": d["smart_list"]["list_id"],
                 "items": [i for i in d["smart_list"]["items"] if not i.get("checked")]}
    with file_lock("cart.json"):
        cart = _load("cart.json", None)
        if cart is not None:
            def _sig(items):
                return [(i["item_id"], i.get("qty")) for i in items]
            same = _sig(cart["items"]) == _sig(unchecked["items"])
            fresh = cart["state"] == "waiting" and same
            new_cycle = cart["state"] == "approved" and cart.get("as_of") != as_of()
            if fresh or (cart["state"] == "approved" and not new_cycle):
                return cart
        cart = prepare(unchecked, names())
        cart["as_of"] = as_of()
        _save("cart.json", cart)
        return cart


def save_cart(cart):
    _save("cart.json", cart)


def dashboard():
    rs = receipts()
    entries = _group_entries(build_ledger(rs, fee_skus=fee_skus()))
    spend = round(sum(e["price"] for e in entries if e["event_type"] == "purchase"), 2)
    returns = round(-sum(e["price"] for e in entries if e["event_type"] == "return"), 2)
    others = round(sum(e["price"] for e in entries if e["allocation"] in ("FOR_OTHERS", "FOR-OTHERS")), 2)
    by_month, by_store, by_item = {}, {}, {}
    nm = names()
    for r in rs:  # a receipt line not yet in the dictionary still has a name
        for ln in r["lines"]:
            if ln.get("line_type") == "discount" or not ln.get("sku"):
                continue
            iid = ln.get("item_id") or f"costco-{ln['sku']}"
            nm.setdefault(iid, ln.get("decoded_name") or ln.get("raw") or iid)
    verdicts = grocery_verdicts()
    kind_of = {}      # item_id -> "other" sub, or None for groceries
    for e in entries:
        iid = e["item_id"]
        if iid not in kind_of:
            g = classify_grocery(nm.get(iid, iid), verdicts)
            kind_of[iid] = (g["sub"] or "other") if g["kind"] == "other" else None
    other_total, other_by_kind = 0.0, {}
    for e in entries:
        if e["event_type"] != "purchase":
            continue
        by_month[e["date"][:7]] = round(by_month.get(e["date"][:7], 0) + e["price"], 2)
        by_store[e["store_id"]] = round(by_store.get(e["store_id"], 0) + e["price"], 2)
        by_item[e["item_id"]] = round(by_item.get(e["item_id"], 0) + e["price"], 2)
        sub = kind_of[e["item_id"]]
        if sub:
            other_total += e["price"]
            other_by_kind[sub] = round(other_by_kind.get(sub, 0) + e["price"], 2)
    net_by_item = {}
    for e in entries:  # top items are net of returns, matching item pages
        net_by_item[e["item_id"]] = round(net_by_item.get(e["item_id"], 0) + e["price"], 2)
    # Top items are groceries; the rest is counted under "other", never dropped.
    top = sorted(((k, v) for k, v in net_by_item.items()
                  if v > 0 and not kind_of.get(k)), key=lambda kv: -kv[1])[:10]
    other_total = round(other_total, 2)
    return {"spend_total": spend, "returns_total": returns, "for_others_total": others,
            "spend_groceries": round(spend - other_total, 2),
            "spend_other": other_total, "other_by_kind": other_by_kind,
            "trip_count": len(rs), "spend_by_month": dict(sorted(by_month.items())),
            "spend_by_store": by_store,
            "top_items": [{"item_id": k, "name": nm.get(k, k), "spend": v} for k, v in top]}


def review_queue():
    lines = []
    for r in receipts():
        for li, ln in enumerate(r["lines"]):
            if ln.get("status") == "unverified":
                lines.append({"receipt_id": r["receipt_id"], "idx": li, "date": r["purchased_at"],
                              "raw": ln["raw"], "decoded_name": ln.get("decoded_name"),
                              "confidence": ln.get("confidence"),
                              "alternatives": ln.get("alternatives", []),
                              "suggested": ln.get("suggested")})
    unresolved = [{"item_id": e["item_id"], "name": e["canonical_name"],
                   "candidates": e["resolution"].get("candidates", []),
                   "sources": e["resolution"].get("sources", {})}
                  for e in dictionary()["entries"]
                  if e.get("resolution", {}).get("status") == "unresolved"]
    return {"lines": lines, "unresolved": unresolved}


class _as_receipt_owner:
    """Edit a receipt in the plane of the member who filed it: in a
    group a line fix from anyone lands in the filer's own store."""
    def __init__(self, receipt_id):
        self.owner = receipt_owner(receipt_id)

    def __enter__(self):
        me = _current_user.get()
        self._ctx = as_user(self.owner, _current_group.get()) \
            if self.owner and self.owner != me else None
        if self._ctx:
            self._ctx.__enter__()
        return self

    def __exit__(self, *exc):
        if self._ctx:
            self._ctx.__exit__(*exc)
        return False


def update_receipt_line(receipt_id, idx, fields):
    with _as_receipt_owner(receipt_id), file_lock("receipts.json"):
        rs = own_receipts()
        for r in rs:
            if r["receipt_id"] == receipt_id and 0 <= idx < len(r["lines"]):
                r["lines"][idx].update(fields)
                _save("receipts.json", rs)
                return r["lines"][idx]
    return None


def teach_name(sku, name):
    """A user-confirmed line name teaches the dictionary entry for its SKU."""
    if not sku:
        return
    with file_lock("dictionary.json"):
        d = dictionary()
        for e in d["entries"]:
            if e.get("sku") == sku:
                e["canonical_name"] = name
                e.setdefault("resolution", {})["status"] = "manual"
                _save("dictionary.json", d)
                return


def suggest_resolution(item_id, candidates):
    """Attach researched candidates (with source URLs) to an unresolved
    entry. Research is evidence, not a verdict: the entry stays
    unresolved until the user settles it."""
    with file_lock("dictionary.json"):
        d = dictionary()
        for e in d["entries"]:
            if e["item_id"] == item_id:
                res = e.setdefault("resolution", {})
                if res.get("status") != "unresolved":
                    return False
                res["candidates"] = [c["name"] for c in candidates]
                res["sources"] = {c["name"]: c.get("source", "")
                                  for c in candidates if c.get("source")}
                _save("dictionary.json", d)
                return True
    return False


def suggest_line(receipt_id, idx, name, source):
    """A researched name for one unverified receipt line, with its
    source. A proposal only: the line stays unverified until the user
    confirms or renames it."""
    with _as_receipt_owner(receipt_id), file_lock("receipts.json"):
        rs = own_receipts()
        for r in rs:
            if r["receipt_id"] == receipt_id and 0 <= idx < len(r["lines"]):
                ln = r["lines"][idx]
                if ln.get("status") != "unverified":
                    return False
                ln["suggested"] = {"name": name, "source": source}
                _save("receipts.json", rs)
                return True
    return False


def resolve_dictionary(item_id, name):
    with file_lock("dictionary.json"):
        d = dictionary()
        for e in d["entries"]:
            if e["item_id"] == item_id:
                e["canonical_name"] = name
                e.setdefault("resolution", {})["status"] = "manual"
                e["resolution"]["candidates"] = []
                _save("dictionary.json", d)
                return e
    return None


def item_detail(item_id):
    item_id = group_map().get(item_id, item_id)
    d = derived()
    entry = next((e for e in dictionary()["entries"] if e["item_id"] == item_id), None)
    pattern = next((p for p in d["patterns"] if p["item_id"] == item_id), None)
    history = [e for e in d["entries"] if e["item_id"] == item_id]
    prices = {}
    for e in history:
        if e["event_type"] == "purchase":
            prices.setdefault(e["store_id"], []).append(e["price"])
    price_by_store = {s: {"min": min(v), "median": sorted(v)[len(v) // 2], "max": max(v), "count": len(v)}
                      for s, v in prices.items()}
    return {"entry": entry, "pattern": pattern,
            "history": sorted(history, key=lambda e: e["date"], reverse=True),
            "price_by_store": price_by_store}
