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


def data_dir():
    base = os.environ.get("ARYA_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))
    user = _current_user.get()
    if user:
        return os.path.join(base, "users", user)
    return base


def set_current_user(name):
    _current_user.set(name)


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
    return lock_for(os.path.join(data_dir(), name))


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


def _load(name, default):
    p = os.path.join(data_dir(), name)
    ov = _overlay.get()
    if ov is not None and p in ov:
        return copy.deepcopy(ov[p])
    if pgstore.mode() == "pg" and pgstore.uses_pg(_owner(), name):
        v = pgstore.read(_owner(), name)
        return default if v is pgstore._MISSING else v
    if os.path.exists(p):
        with open(p) as fh:
            return json.load(fh)
    return default


def _save(name, obj):
    p = os.path.join(data_dir(), name)
    ov = _overlay.get()
    if ov is not None and name not in _WRITE_THROUGH:
        if len(json.dumps(obj)) > OVERLAY_MAX_BYTES:
            raise ValueError("the demo sandbox is full — sign out and open the demo again")
        ov[p] = copy.deepcopy(obj)
        return
    if pgstore.uses_pg(_owner(), name):
        if pgstore.mode() == "pg":
            pgstore.write(_owner(), name, obj)
            return
        write_json_atomic(p, obj)
        pgstore.mirror(_owner(), name, obj)
        return
    write_json_atomic(p, obj)


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


def receipts():
    rs = _load("receipts.json", [])
    if _current_user.get() == DEMO_USER:
        return _demo_shift(rs)
    return rs


def _media_dir():
    return os.path.join(data_dir(), "receipt-media")


def receipt_media(receipt_id):
    """The kept original's bytes, or None. The id is a server-minted
    slug; anything carrying a path separator is refused outright,
    so a crafted id can never walk out of the media store."""
    if not receipt_id or os.path.basename(receipt_id) != receipt_id:
        return None
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
        cur = receipts()
        seen = {r["receipt_id"] for r in cur}
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


def set_flag(item_id, flag):
    with file_lock("flags.json"):
        f = flags()
        f[item_id] = flag
        _save("flags.json", f)


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
        return f.get("never") or (f.get("snoozed_until") and today and f["snoozed_until"] >= today)
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
        if f.get("expired") or f.get("out"):
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
    for pid, f in fl.items():
        if f.get("manual") and pid not in have:
            smart["items"].append({"item_id": pid, "qty": 1, "due_reason": "Added by you",
                                    "source": "user"})
    kept = []
    for item in smart["items"]:
        f = fl.get(item["item_id"], {})
        if item.get("source") == "pattern" and f.get("dismissed_on") == today:
            continue  # removed for this cycle; returns when a new receipt lands
        if f.get("qty_override"):
            item["qty"] = f["qty_override"]
        if f.get("checked_on") and f.get("checked_on") == today:
            item["checked"] = True
        kept.append(item)
    smart["items"] = kept
    for item in smart["items"]:
        f = fl.get(item["item_id"], {})
        item["name"] = f.get("name") or names().get(item["item_id"], item["item_id"])
        j = judged.get(item["item_id"])
        if j:
            item["judge_reason"] = j.get("reason", "")
            item["judge_class"] = j.get("class", "")
    return {"entries": entries, "patterns": patterns, "smart_list": smart}


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


def _admitted(p, judged, fl):
    """May this pattern appear on the list? Judge says yes (or the user
    added it by hand); unresolved names and unjudged items stay off."""
    f = fl.get(p["item_id"], {})
    if f.get("manual") or f.get("out") or f.get("expired"):
        return True  # explicit user intent beats the judge
    v = judged.get(p["item_id"])
    if not v or not v.get("list_ok"):
        return False
    if p.get("history_state") == "lapsed":
        return False  # silent for over 4x its rhythm: not due, just gone
    if v.get("class") == "SEASONAL":
        months = (p.get("analysis") or {}).get("seasonal_months")
        if months and as_of():
            now_month = int(as_of()[5:7])
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
    for e in entries:
        if e["event_type"] != "purchase":
            continue
        by_month[e["date"][:7]] = round(by_month.get(e["date"][:7], 0) + e["price"], 2)
        by_store[e["store_id"]] = round(by_store.get(e["store_id"], 0) + e["price"], 2)
        by_item[e["item_id"]] = round(by_item.get(e["item_id"], 0) + e["price"], 2)
    nm = names()
    net_by_item = {}
    for e in entries:  # top items are net of returns, matching item pages
        net_by_item[e["item_id"]] = round(net_by_item.get(e["item_id"], 0) + e["price"], 2)
    top = sorted(((k, v) for k, v in net_by_item.items() if v > 0), key=lambda kv: -kv[1])[:10]
    return {"spend_total": spend, "returns_total": returns, "for_others_total": others,
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


def update_receipt_line(receipt_id, idx, fields):
    with file_lock("receipts.json"):
        rs = receipts()
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
    with file_lock("receipts.json"):
        rs = receipts()
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
