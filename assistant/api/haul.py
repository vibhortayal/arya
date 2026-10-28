"""Haul — the closed hunt's receipt review, points breakdown and card.

The hunt is closed before anyone reviews its receipt, so a fix here is
an ANNOTATION in a per-trip haul record (hauls.json). It changes the
haul view, the haul card and the Crew post. It never changes
quest.json, item.checked, points or badges. Matching is a suggestion
list the shopper confirms, never a verdict. Deterministic code, $0:
this module never calls a model and imports no model client.

hauls.json = {session_id: {receipts: [extra receipt ids],
                           fixes: {"x:<key>"|"g:<key>"|"s:<key>": kind},
                           hidden: [item keys],
                           post: {post_id, audience, posted_at,
                                  items: [{name, art}]} | None}}

The 'Same haul' queue (queued.json) also lives here: rows a friend's
haul offered. Nothing in it ever reaches the real list, the ledger or
the dictionary.
"""
import hashlib, json, math, os, re, secrets
from datetime import datetime

from api import quest, state

HAULS_FILE = "hauls.json"
QUEUED_FILE = "queued.json"

FIX_KINDS = ("extra_add", "extra_drop", "grabbed_keep", "grabbed_drop",
             "swap_ok", "swap_no")
# An undo deletes the fix of one family.
UNDO_KINDS = ("extra_none", "grabbed_none", "swap_none")
_FAMILY = {"extra_add": "x", "extra_drop": "x", "extra_none": "x",
           "grabbed_keep": "g", "grabbed_drop": "g", "grabbed_none": "g",
           "swap_ok": "s", "swap_no": "s", "swap_none": "s"}

QUEUE_MAX = 30
NAME_MAX = 60


# --- small helpers ----------------------------------------------------------

def key_of(name):
    """A haul item's key: the normalised name."""
    return state._norm_name(name)


def _qty(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 1
    if n <= 0:
        return 1
    return int(n) if n == int(n) else round(n, 1)


def _line_name(ln):
    return (ln.get("decoded_name") or ln.get("raw") or "").strip()


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _new_id(prefix, seed):
    h = hashlib.sha1(f"{seed}|{secrets.token_hex(8)}".encode()).hexdigest()[:10]
    return f"{prefix}-{h}"


def _closed(sess):
    return sess is not None and sess.get("state") in ("finished", "done")


def _settled(sess):
    return bool(sess.get("settled")) or sess.get("state") == "done"


# --- the haul record --------------------------------------------------------

def _hauls():
    h = state._load(HAULS_FILE, {})
    return h if isinstance(h, dict) else {}


def record(session_id):
    """The haul record for a trip (a fresh one when none exists)."""
    r = _hauls().get(session_id) or {}
    return {"receipts": list(r.get("receipts") or []),
            "fixes": dict(r.get("fixes") or {}),
            "hidden": list(r.get("hidden") or []),
            "post": r.get("post") or None}


def _update(session_id, fn):
    with state.file_lock(HAULS_FILE):
        h = _hauls()
        r = h.get(session_id) or {}
        r.setdefault("receipts", [])
        r.setdefault("fixes", {})
        r.setdefault("hidden", [])
        r.setdefault("post", None)
        fn(r)
        h[session_id] = r
        state._save(HAULS_FILE, h)
        return r


def set_post(session_id, post):
    """Crew keeps the post block here: {post_id, audience, posted_at,
    items} or None."""
    _update(session_id, lambda r: r.__setitem__("post", post))


# --- receipt lines ------------------------------------------------------------

def receipt_lines(sess, rec=None):
    """Union of the item lines of the trip's receipt and any extra
    receipts (a split payment)."""
    rec = rec if rec is not None else record(sess["id"])
    ids = []
    if sess.get("receipt_id"):
        ids.append(sess["receipt_id"])
    ids += [i for i in rec["receipts"] if i not in ids]
    if not ids:
        return []
    by_id = {r["receipt_id"]: r for r in state.receipts()}
    out = []
    for rid in ids:
        r = by_id.get(rid)
        if not r:
            continue
        for ln in r.get("lines") or []:
            if ln.get("line_type", "item") != "item":
                continue
            name = _line_name(ln)
            if name:
                out.append(dict(ln, _name=name, _qty=_qty(ln.get("qty", 1))))
    return out


_SIZE_WORDS = {"oz", "lb", "lbs", "gal", "ct", "pk", "pack", "ml", "kg",
               "fl", "each", "dozen", "doz", "pcs", "pc", "the", "and"}


def _head(name):
    """The head noun of a product name: its last word that is not a
    size or unit. 'Oat Milk 64 oz' -> 'milk'."""
    toks = [t for t in state._norm_name(name).split()
            if len(t) > 2 and not any(c.isdigit() for c in t)
            and t not in _SIZE_WORDS]
    return toks[-1] if toks else ""


def _line_group(ln, gm):
    iid = ln.get("item_id")
    if iid:
        return gm.get(iid, iid)
    try:
        return quest.resolve_group(ln["_name"])
    except Exception:
        return None


def _entry(key, name, qty, fix=None, **more):
    e = {"key": key, "name": name, "qty": qty, "fix": fix}
    e.update(more)
    return e


def match(sess, lines, fixes=None):
    """Match the CHECKED items of a closed hunt against receipt lines.

    Pass 1 claims a line with the same group; pass 2 claims one by
    name (quest._name_match). What is left over is sorted into:
      matched         - item and line agree
      swapped         - the shopper swapped it (HUNT's swapped_from), or
                        Arya SUGGESTS a swap (same head noun) that the
                        shopper confirms or denies
      on_receipt_only - a receipt line no grabbed item claims
      grabbed_only    - a grabbed item no receipt line claims
    Returns the four buckets; each entry is {key, name, qty, fix, ...}.
    Swapped entries add 'from' (the other product) and 'suggested'.
    """
    fixes = fixes or {}
    gm = state.group_map()
    items = [it for it in sess.get("items") or [] if it.get("checked")]
    lgroups = [_line_group(ln, gm) for ln in lines]
    pair, claimed = {}, set()
    for i, it in enumerate(items):
        for j, ln in enumerate(lines):
            if j not in claimed and lgroups[j] and lgroups[j] == it.get("group"):
                pair[i] = j
                claimed.add(j)
                break
    for i, it in enumerate(items):
        if i in pair:
            continue
        for j, ln in enumerate(lines):
            if j not in claimed and quest._name_match(ln["_name"], it["name"]):
                pair[i] = j
                claimed.add(j)
                break
    matched, swapped, recv, grab = [], [], [], []
    for i, it in enumerate(items):
        if i in pair:
            ent = _entry(key_of(it["name"]), it["name"], _qty(it.get("qty", 1)))
            if it.get("swapped_from"):
                ent.update(suggested=False, **{"from": it["swapped_from"]})
                swapped.append(ent)
            else:
                matched.append(ent)
    g_left = [(i, it) for i, it in enumerate(items) if i not in pair]
    l_left = [(j, ln) for j, ln in enumerate(lines) if j not in claimed]
    # Weak swap suggestions: a grabbed-only item and a receipt-only line
    # that share a head noun. One line backs at most one suggestion.
    used_lines = set()
    for i, it in g_left:
        head = _head(it["name"])
        key = key_of(it["name"])
        hit = None
        if head:
            for j, ln in l_left:
                if j not in used_lines and _head(ln["_name"]) == head:
                    hit = (j, ln)
                    break
        decision = fixes.get("s:" + key)
        if hit and decision != "swap_no":
            used_lines.add(hit[0])
            swapped.append(_entry(key, it["name"], _qty(it.get("qty", 1)),
                                  decision if decision == "swap_ok" else None,
                                  suggested=True,
                                  **{"from": hit[1]["_name"],
                                     "from_key": key_of(hit[1]["_name"])}))
            continue
        grab.append(_entry(key, it["name"], _qty(it.get("qty", 1)),
                           _fix_for("g", key, fixes)))
    seen = {}
    for j, ln in l_left:
        if j in used_lines:
            continue
        key = key_of(ln["_name"])
        if key in seen:
            seen[key]["qty"] = _qty(seen[key]["qty"] + ln["_qty"])
            continue
        # 'decoded' is False when the name is raw receipt text ('KS ORG
        # BNNA 3LB'): the client makes no album sticker from that.
        seen[key] = _entry(key, ln["_name"], ln["_qty"], _fix_for("x", key, fixes),
                           decoded=bool(ln.get("decoded_name")))
        recv.append(seen[key])
    return {"matched": matched, "swapped": swapped,
            "on_receipt_only": recv, "grabbed_only": grab}


def _fix_for(family, key, fixes):
    k = fixes.get(family + ":" + key)
    return k if k and _FAMILY.get(k) == family else None


# --- boss, points -------------------------------------------------------------

def boss_found(sess):
    """The boss item is found only when a checked item sits in the
    boss group. Nothing is ever faked (contract C1)."""
    b = sess.get("boss")
    if not b:
        return False
    return any(it.get("checked") and it.get("group") == b.get("group")
               for it in sess.get("items") or [])


def points_breakdown(sess):
    """A pure decomposition of social.hunt_points. The receipt's +50 is
    always part of the total; it banks when the receipt settles the
    hunt and waits as 'pending' until then. Nothing here is a penalty."""
    from api import social
    items = sess.get("items") or []
    got = sum(1 for i in items if i.get("checked"))
    p_items = got * getattr(social, "POINTS_PER_ITEM", 10)
    full = getattr(social, "POINTS_FULL_HAUL", 25) if items and got == len(items) else 0
    boss = getattr(social, "POINTS_BOSS", 40) if boss_found(sess) else 0
    receipt = getattr(social, "POINTS_RECEIPT", 50)
    total = p_items + full + boss + receipt
    settled = _settled(sess)
    return {"items": p_items, "boss": boss, "full_haul": full,
            "receipt": receipt, "total": total,
            "banked": total if settled else 0,
            "pending": 0 if settled else total}


def stats(sess, items=None):
    """{items, level}: the haul's item count and the shopper's level."""
    from api import social
    pts = sum(social.hunt_points(s) for s in social._done_sessions())
    n = len(items) if items is not None else sum(
        1 for i in sess.get("items") or [] if i.get("checked"))
    return {"items": n, "level": social.level_for(pts)["level"]}


# --- trip name ----------------------------------------------------------------

_CHAR_MANIFEST = None


def _manifest():
    global _CHAR_MANIFEST
    if _CHAR_MANIFEST is None:
        p = os.path.join(os.path.dirname(__file__), "..", "pwa", "assets",
                         "characters", "manifest.json")
        try:
            with open(p, encoding="utf-8") as fh:
                _CHAR_MANIFEST = json.load(fh)
        except Exception:
            _CHAR_MANIFEST = {}
    return _CHAR_MANIFEST


_THEMES = {"fruit": "Fruit Bowl Run", "dairy": "Dairy Dash",
           "bakery": "Bakery Run", "frozen": "Cold Aisle Run",
           "pantry": "Pantry Restock", "vegetable": "Garden Run"}


def _category(name):
    tokens = state._norm_name(name).split()
    text = " ".join(tokens)
    for cat in _manifest().get("categories") or []:
        for kw in cat.get("keywords") or []:
            if f" {kw} " in f" {text} ":
                return cat.get("id")
    return None


def trip_name(items, when=None):
    """Arya names the trip: weekday + theme, from a fixed template.
    Fewer than 5 items is a 'Quick Run'; no clear theme is a 'Weekly
    Shop'. Same input, same name."""
    day = ""
    if isinstance(when, str):
        try:
            when = datetime.fromisoformat(when)
        except ValueError:
            when = None
    if when is not None:
        try:
            day = when.strftime("%A")
        except Exception:
            day = ""
    names = [i["name"] if isinstance(i, dict) else str(i) for i in items]
    if len(names) < 5:
        theme = "Quick Run"
    else:
        counts = {}
        for n in names:
            c = _category(n)
            if c in _THEMES:
                counts[c] = counts.get(c, 0) + 1
        theme = "Weekly Shop"
        if counts:
            top = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0]
            if top[1] >= max(2, math.ceil(0.4 * len(names))):
                theme = _THEMES[top[0]]
    return f"{day} {theme}".strip()


# --- the haul view --------------------------------------------------------------

def _boss_of(sess, item_group):
    b = sess.get("boss")
    return bool(b and item_group and b.get("group") == item_group)


def build(sess, rec=None, private=True):
    """Everything the review, reveal and card screens need, computed
    from the session, the receipts and the haul record."""
    rec = rec if rec is not None else record(sess["id"])
    lines = receipt_lines(sess, rec)
    has_receipt = bool(sess.get("receipt_id"))
    groups = {key_of(i["name"]): i.get("group")
              for i in sess.get("items") or []}
    hidden = set(rec["hidden"])
    out_items = []

    def add(ent, source):
        out_items.append({"key": ent["key"], "name": ent["name"],
                          "qty": ent["qty"],
                          "boss": _boss_of(sess, groups.get(ent["key"])),
                          "source": source,
                          "hidden": ent["key"] in hidden})

    if lines:
        review = match(sess, lines, rec["fixes"])
        for e in review["matched"]:
            add(e, "matched")
        for e in review["swapped"]:
            if not e["suggested"] or e["fix"] == "swap_ok":
                add(e, "swap")
            elif _fix_for("g", e["key"], rec["fixes"]) != "grabbed_drop":
                # An unconfirmed suggestion is a question, not a verdict:
                # the grabbed item stays until the shopper says otherwise.
                add(e, "grabbed")
        # A grab with no receipt line stays in the haul. Nothing went
        # wrong on the shopper's side, so a receipt problem never costs
        # a sticker. Removing it is the shopper's choice.
        for e in review["grabbed_only"]:
            if e["fix"] != "grabbed_drop":
                add(e, "kept" if e["fix"] == "grabbed_keep" else "grabbed")
        for e in review["on_receipt_only"]:
            if e["fix"] == "extra_add":
                add(e, "receipt")
        review["read"] = len(lines)
    else:
        # No receipt, or a scan that read nothing: every grab stands.
        review = {"matched": [], "swapped": [], "on_receipt_only": [],
                  "grabbed_only": [], "read": 0}
        for it in sess.get("items") or []:
            if it.get("checked"):
                add(_entry(key_of(it["name"]), it["name"],
                           _qty(it.get("qty", 1))), "grabbed")
    # Items follow the hunt's order, then the extras.
    order = {key_of(i["name"]): n for n, i in enumerate(sess.get("items") or [])}
    out_items.sort(key=lambda e: order.get(e["key"], len(order)))
    shown = [i for i in out_items if not i["hidden"]]
    b = sess.get("boss")
    return {
        "session_id": sess["id"], "state": sess["state"],
        "receipt": ({"attached": True, "count": 1 + len(rec["receipts"])}
                    if has_receipt else None),
        "settled": _settled(sess),
        "name": trip_name(out_items, sess.get("started_at") or sess.get("created_at")),
        "items": out_items, "review": review,
        "points": points_breakdown(sess),
        "boss": ({"name": b.get("name"), "found": boss_found(sess)}
                 if b else None),
        "stats": stats(sess, shown),
        "private": private_block(sess, rec) if private else None,
        "post": {"posted": bool(rec["post"]),
                 "post_id": (rec["post"] or {}).get("post_id"),
                 "audience": list((rec["post"] or {}).get("audience") or [])},
    }


def haul_view(session_id):
    """The view, or None when the trip does not exist. Raises
    ValueError while the hunt is still open."""
    sess = quest.get_session(session_id)
    if sess is None:
        return None
    if not _closed(sess):
        raise ValueError("the hunt is still open")
    return build(sess)


# --- fixes, hide, second receipt ------------------------------------------------

def _valid_keys(sess, rec):
    """Keys each fix family may name, from the matching WITHOUT fixes."""
    lines = receipt_lines(sess, rec)
    if not lines:
        return {"x": set(), "g": set(), "s": set()}
    r = match(sess, lines, {})
    sug = [e for e in r["swapped"] if e["suggested"]]
    return {"x": {e["key"] for e in r["on_receipt_only"]}
                 | {e["from_key"] for e in sug},
            "g": {e["key"] for e in r["grabbed_only"]}
                 | {e["key"] for e in sug},
            "s": {e["key"] for e in sug}}


def fix(session_id, kind, key):
    """Set (or undo) one annotation. Idempotent; last write wins.
    Returns the haul view, or None when the trip does not exist."""
    if kind not in FIX_KINDS and kind not in UNDO_KINDS:
        raise ValueError("unknown fix")
    sess = quest.get_session(session_id)
    if sess is None:
        return None
    if not _closed(sess):
        raise ValueError("the hunt is still open")
    key = key_of(key)
    fam = _FAMILY[kind]
    if key not in _valid_keys(sess, record(session_id))[fam]:
        raise ValueError("that line is not in this review")

    def fn(r):
        slot = fam + ":" + key
        if kind in UNDO_KINDS:
            r["fixes"].pop(slot, None)
        else:
            r["fixes"][slot] = kind
    _update(session_id, fn)
    return haul_view(session_id)


def hide(session_id, key, hidden):
    """Hide or show one haul item on the card and the post."""
    sess = quest.get_session(session_id)
    if sess is None:
        return None
    if not _closed(sess):
        raise ValueError("the hunt is still open")
    key = key_of(key)
    if key not in {i["key"] for i in build(sess, private=False)["items"]}:
        raise ValueError("that item is not in this haul")

    def fn(r):
        cur = [k for k in r["hidden"] if k != key]
        if hidden:
            cur.append(key)
        r["hidden"] = cur
    _update(session_id, fn)
    return haul_view(session_id)


def add_receipt(session_id, receipt_id):
    """A second receipt for a split payment. The trip must already have
    its own receipt. The same store-family and not-before-the-hunt rules
    as the first receipt apply. quest.json never changes."""
    sess = quest.get_session(session_id)
    if sess is None:
        return None
    if not _closed(sess):
        raise ValueError("the hunt is still open")
    if not sess.get("receipt_id"):
        raise ValueError("add this trip's own receipt first")
    receipt = next((r for r in state.receipts()
                    if r["receipt_id"] == receipt_id), None)
    if receipt is None:
        raise LookupError("no such receipt")
    if receipt_id == sess["receipt_id"] \
            or receipt_id in record(session_id)["receipts"]:
        return haul_view(session_id)  # idempotent
    hf = quest._store_family(sess.get("store"))
    rf = quest._store_family(receipt.get("merchant"))
    if hf and rf and hf != rf:
        raise ValueError(f"this receipt is from {receipt.get('merchant')}; "
                         f"the hunt is at {sess.get('store')}")
    quest._check_receipt_is_this_trips(sess, receipt)
    if not state.in_sandbox():
        for sid, r in _hauls().items():
            if sid != session_id and receipt_id in (r.get("receipts") or []):
                raise ValueError("this receipt already belongs to another trip")
    _update(session_id, lambda r: r["receipts"].append(receipt_id))
    return haul_view(session_id)


# --- private estimate vs actual (owner only) ------------------------------------

def private_block(sess, rec=None):
    """{estimate, estimate_items, grabbed_items, actual} for the owner's
    eyes. The estimate is the last known price per product BEFORE the
    hunt began, times the quantity grabbed. It covers only the grabbed
    items that have a known price: estimate_items of grabbed_items. The
    client must say so and never set a partial estimate against the whole
    receipt as if both were the same thing. It stays on this response:
    it is never posted, never on a card, never sent to another account.
    None when nothing here can be priced."""
    rec = rec if rec is not None else record(sess["id"])
    ids = ([sess["receipt_id"]] if sess.get("receipt_id") else []) + rec["receipts"]
    if not ids:
        return None
    trip = set(ids)
    began = (sess.get("started_at") or sess.get("created_at") or "")[:10]
    prices = {}
    for e in state.derived()["entries"]:
        if e.get("event_type") != "purchase" or e.get("receipt_id") in trip:
            continue
        # A replayed old trip must not borrow prices from after it.
        if began and str(e.get("date") or "")[:10] >= began:
            continue
        q = e.get("qty") or 1
        prices[e["item_id"]] = e["price"] / q if q else e["price"]
    gm = state.group_map()
    est, known, grabbed = 0.0, 0, 0
    for it in sess.get("items") or []:
        if not it.get("checked"):
            continue
        grabbed += 1
        p = prices.get(it.get("group"))
        if p is None:
            p = next((v for iid, v in prices.items()
                      if gm.get(iid, iid) == it.get("group")), None)
        if p is None:
            continue
        est += p * _qty(it.get("qty", 1))
        known += 1
    by_id = {r["receipt_id"]: r for r in state.receipts()}
    totals = [by_id[i].get("total") for i in ids
              if i in by_id and by_id[i].get("total") is not None]
    actual = round(sum(totals), 2) if totals else None
    if not known and not actual:
        return None
    return {"estimate": round(est, 2) if known else None,
            "estimate_items": known, "grabbed_items": grabbed,
            "actual": actual}


# --- the 'Same haul' queue (queued.json) -----------------------------------------

def _queued():
    q = state._load(QUEUED_FILE, {})
    rows = q.get("queued") if isinstance(q, dict) else None
    return rows if isinstance(rows, list) else []


def queued_list():
    return _queued()


def _clean_handle(h):
    h = (h or "").strip().lstrip("@").lower()
    if not re.fullmatch(r"[a-z0-9._\-]{1,24}", h):
        raise ValueError("handle looks wrong")
    return h


def queued_add(from_handle, post_id, names):
    """Queue a friend's items for the next hunt's plan. Dedupes by
    normalised name (also against what is already queued) and caps the
    queue. Returns the whole queue."""
    handle = _clean_handle(from_handle)
    post_id = (post_id or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_\-]{1,40}", post_id):
        raise ValueError("post id looks wrong")
    with state.file_lock(QUEUED_FILE):
        rows = _queued()
        have = {key_of(r["name"]) for r in rows}
        for n in names or []:
            name = re.sub(r"\s+", " ", str(n or "")).strip()[:NAME_MAX]
            k = key_of(name)
            if not k or k in have or len(rows) >= QUEUE_MAX:
                continue
            have.add(k)
            rows.append({"id": _new_id("qh", handle + post_id + name),
                         "name": name, "qty": 1, "from": handle,
                         "post_id": post_id, "added_at": _now()})
        state._save(QUEUED_FILE, {"queued": rows})
        return rows


def queued_remove(row_id):
    with state.file_lock(QUEUED_FILE):
        rows = _queued()
        keep = [r for r in rows if r.get("id") != row_id]
        if len(keep) != len(rows):
            state._save(QUEUED_FILE, {"queued": keep})
        return keep


def queued_finish(ids):
    """A hunt took these rows: drop them."""
    gone = {str(i) for i in ids or []}
    with state.file_lock(QUEUED_FILE):
        rows = _queued()
        keep = [r for r in rows if r.get("id") not in gone]
        if len(keep) != len(rows):
            state._save(QUEUED_FILE, {"queued": keep})
        return keep
