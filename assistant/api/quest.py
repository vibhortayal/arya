"""Quest — Arya Quest game state (Stage A).
A session is one store trip: one store, one list, one mode, one state
(UX.md session model). Sessions, Shop-Off races, and friends live in one
per-account file, quest.json, beside receipts.json and friends. Derived
facts (progress, winners) are computed on read, like the ledger.
Play, scoring, and reports are deterministic code. Session creation
for a store with a shelf graph also runs item–shelf matching
(api/shelfmatch.py) — the one model-touching step, and it never
blocks or breaks creation.
"""
import base64, contextlib, hashlib, re, secrets
from datetime import date, datetime, timedelta, timezone

from api import itemmeta, state

MODES = ("quest", "express")
SESSION_STATES = ("not_started", "playing", "paused", "finished", "done",
                  "abandoned")
# The SceneView ladder: the session engine is the game, the scene is
# only a viewport. A session records which driver it started in;
# nothing in play, scoring, or the receipt finish reads it.
DRIVERS = ("photo", "cloud", "aisle", "strip", "art")


# --- store ---------------------------------------------------------------

def _store():
    s = state._load("quest.json", {})
    s.setdefault("sessions", [])
    s.setdefault("shopoffs", [])
    s.setdefault("friends", [])
    s.setdefault("reports", [])
    s.setdefault("sightings", [])
    return s


def _save_store(s):
    state._save("quest.json", s)


@contextlib.contextmanager
def _as_user(username):
    """Run a block against another account's per-user store (the
    friends mirror in social.py). Only a handle and a friend
    status ever cross accounts this way — no household data is
    read or written."""
    tok = state._current_user.set(username)
    try:
        yield
    finally:
        state._current_user.reset(tok)


def username_for_handle(handle):
    """The registered account whose handle this is, or None. The
    account registry lives in the root store, so it is read with
    the per-user context cleared. If two accounts share a
    local-part across domains, the first by name wins; the handle
    is the social spelling either way."""
    from api import auth
    tok = state._current_user.set(None)
    try:
        names = sorted(auth.users())
    finally:
        state._current_user.reset(tok)
    for name in names:
        if name.split("@")[0].strip().lower() == handle:
            return name
    return None


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _today():
    return date.today().isoformat()


def _new_id(prefix, seed):
    h = hashlib.sha1(f"{seed}|{secrets.token_hex(8)}".encode()).hexdigest()[:10]
    return f"{prefix}-{h}"


# --- item identity ---------------------------------------------------------
# A session item's "group" is its merge identity: the dictionary group
# representative when the name resolves to a known product (the same
# identity the Curator and group_map use), else a name: key of the
# normalized typed name. Two adds with the same group are one product.

def resolve_group(name):
    """Dictionary representative item_id for a typed name, or None.
    Exact normalized match first; then token-subset (typed "milk" is
    the "Whole Milk 1 gal" the dictionary knows) when every candidate
    collapses to one group. Ambiguity stays unresolved here — asking
    is the Optimizer's job, not the session's."""
    norm = state._norm_name(name)
    if not norm:
        return None
    from api.curator import _tokens
    gm = state.group_map()
    entries = state.dictionary()["entries"]

    def rep(e):
        return gm.get(e["item_id"], e["item_id"])

    for e in entries:
        names = [e["canonical_name"]] + list(e.get("aliases") or [])
        if any(state._norm_name(n) == norm for n in names):
            return rep(e)
    typed = set(_tokens(name))
    if not typed:
        return None
    groups = set()
    for e in entries:
        names = [e["canonical_name"]] + list(e.get("aliases") or [])
        for n in names:
            toks = set(_tokens(n))
            if toks and (typed <= toks or toks <= typed):
                groups.add(rep(e))
    if len(groups) == 1:
        return groups.pop()
    return None


def _item_key(name):
    return resolve_group(name) or ("name:" + state._norm_name(name))


def _canonical(name):
    """Display name for a typed name: the dictionary's, when resolved."""
    rep = resolve_group(name)
    if rep:
        return state.names().get(rep, name)
    return name


def _add_item(items, name, qty=1, group=None, extras=None):
    """Add to a session item list, merging quantity on same product.
    Extras (note, variant, by, src, aisle: api/itemmeta) pass through
    cleaned; a same-group merge keeps what the line has and only
    fills the empty extras."""
    name = (name or "").strip()
    if not name:
        return items
    qty = max(1, int(qty or 1))
    key = group or _item_key(name)
    for it in items:
        if it["group"] == key:
            it["qty"] += qty
            itemmeta.apply_extras(it, extras)
            return items
    line = {"name": _canonical(name), "qty": qty,
            "checked": False, "group": key}
    items.append(itemmeta.apply_extras(line, extras))
    return items


def make_items(raw_items):
    from api.list.intake import split_list_text
    items = []
    for raw in raw_items or []:
        if isinstance(raw, str):
            name, qty, group = raw, 1, None
        elif isinstance(raw, dict) and raw.get("name"):
            name, qty, group = raw["name"], raw.get("qty", 1), raw.get("group")
        else:
            continue
        # A whole sentence is a list, not an item ("I need some eggs,
        # eggs, bananas"): split it the way the Add box does.
        pieces = split_list_text(str(name)) if "," in str(name) else []
        if len(pieces) > 1:
            for piece in pieces:
                _add_item(items, piece, 1)
        else:
            _add_item(items, name, qty, group=group,
                      extras=raw if isinstance(raw, dict) else None)
    return items


# --- sessions --------------------------------------------------------------

def create_session(store_name, mode="quest", raw_items=None, extra=None,
                   driver="strip", store_id=None, store_address=None,
                   client=None, persist=True):
    if mode not in MODES:
        raise ValueError("mode must be quest or express")
    if driver not in DRIVERS:
        raise ValueError(f"driver must be one of {DRIVERS}")
    # Item–shelf matching (stores with a shelf graph only): stops
    # gain their shelf label + path position and walk in shelf
    # order. A store with no graph keeps its items exactly as made.
    # Matching may call a model — it runs BEFORE the store lock is
    # taken, never under it.
    from api import shelfmatch
    items = shelfmatch.annotate_items(make_items(raw_items),
                                      store_name, client)
    # The boss (hunt slice): a list item this account reported
    # missing here on 2+ earlier trips, frozen now. Counting only.
    from api import hunt
    boss = hunt.pick_boss(store_name, items)
    sess = {"id": _new_id("qs", store_name),
            "store": store_name, "mode": mode, "driver": driver,
            "state": "not_started",
            "items": items, "boss": boss,
            "created_at": _now(), "started_at": None,
            "finished_at": None, "receipt_id": None, "settled": False}
    if store_id:
        # Started from the store directory (Stage E): the directory
        # id and address are snapshotted onto the session; the name
        # above stays the display string everywhere else. Free-text
        # sessions carry neither field (back-compat).
        sess["store_id"] = store_id
        sess["store_address"] = store_address
    if extra:
        sess.update(extra)
    if not persist:
        # A draft (Quest game, 2026-10-29): the shelf hints for a trip
        # not yet begun. Nothing is saved until the first grab, so a
        # trip opened and left never sits on Your trips.
        sess["draft"] = True
        return sess
    with state.file_lock("quest.json"):
        s = _store()
        s["sessions"].append(sess)
        _save_store(s)
    return sess


def list_sessions():
    """Today's sessions first, then newest first (UX: the day is a row
    of games)."""
    today = _today()
    # A Shop-Off opponent's placeholder lives in the creator's
    # account until cross-account play exists; it is not the
    # creator's hunt, so no list shows it (issue #15).
    # Abandoned quests are deleted from the player's world: no list
    # shows them (the record stays for honesty, like a closed hunt).
    out = sorted((x for x in _store()["sessions"]
                  if not x.get("placeholder")
                  and x.get("state") != "abandoned"),
                 key=lambda x: (x["created_at"][:10] != today,
                                -_ts(x["created_at"])))
    return out


def _ts(iso):
    try:
        return datetime.fromisoformat(iso).timestamp()
    except Exception:
        return 0.0


def get_session(session_id):
    for sess in _store()["sessions"]:
        if sess["id"] == session_id:
            return sess
    return None


def _mutate(session_id, fn):
    with state.file_lock("quest.json"):
        s = _store()
        for sess in s["sessions"]:
            if sess["id"] == session_id:
                fn(sess)
                _save_store(s)
                return sess
    return None


def add_item(session_id, name, qty=1, wild=False):
    def fn(sess):
        _add_item(sess["items"], name, qty)
        if wild:
            # A wild find (owner, 2026-10-28): grabbed on impulse,
            # already in the cart — it joins the hunt collected.
            key = _item_key(name or "")
            for it in sess["items"]:
                if it["group"] == key:
                    it["wild"] = True
                    it["checked"] = True
    return _mutate(session_id, fn)


def check_item(session_id, item_name, checked, instead=None):
    """Find the item by display name (or by merge identity) and set its
    checked flag. Returns the session, or None if no such item.
    `instead` names a substitute the shopper took in its place (Quest
    "Substitute", 2026-10-29): kept on the item so the trip records
    what was really bought; a put back clears it."""
    key = _item_key(item_name or "")
    norm = state._norm_name(item_name or "")
    found = []

    def fn(sess):
        for it in sess["items"]:
            if it["group"] == key or state._norm_name(it["name"]) == norm:
                it["checked"] = bool(checked)
                sub = (instead or "").strip()[:80] if checked else ""
                if sub:
                    it["instead"] = sub
                else:
                    it.pop("instead", None)
                found.append(it)
                return
    sess = _mutate(session_id, fn)
    if sess is None or not found:
        return None
    if checked and not (instead or "").strip():
        # Found it on the shelf: every shopper's "Not here" for it clears.
        from api import shared_reports
        shared_reports.found(sess.get("store"), found[0]["name"], found[0].get("group"))
    return sess


def set_state(session_id, new_state):
    if new_state not in SESSION_STATES:
        raise ValueError(f"state must be one of {SESSION_STATES}")
    if new_state == "done":
        # "done" is receipt-closed: only attach_receipt sets it, so a
        # client cannot claim hunts, streaks or a Shop-Off win
        # without the trip's receipt (Discussion 41).
        raise ValueError("a hunt closes when its receipt attaches")

    def fn(sess):
        if sess["state"] == "done":
            raise ValueError("this hunt is closed")
        sess["state"] = new_state
        if new_state == "playing" and not sess["started_at"]:
            sess["started_at"] = _now()
        if new_state in ("finished", "done") and not sess["finished_at"]:
            sess["finished_at"] = _now()
        if new_state in ("finished", "done"):
            # Settled means this trip's receipt is attached
            # (Discussion 41): a hunt may finish without it —
            # settled stays False until the receipt lands.
            sess["settled"] = bool(sess.get("receipt_id"))
    return _mutate(session_id, fn)


# --- Merchant families for the settle check (issue #11) --------------
# The receipt that settles a hunt must be this trip's (Discussion 41).
# Merchant strings are free text on both sides — decode files
# "TRADER JOES #452" for a hunt at "Trader Joe's" — so the check
# compares normalized store FAMILIES, never raw strings. A side that
# cannot be classified never blocks the settle.
_FAMILY_ALIASES = {
    "trader joes": "trader-joes", "trader joe": "trader-joes",
    "tjs": "trader-joes",
    "safeway": "safeway", "safeway inc": "safeway",
    "costco": "costco", "costco wholesale": "costco",
    "target": "target",
    "walmart": "walmart",
}


def _store_family(name):
    """Map a free-text store or merchant name to its family key, or
    None when the name cannot be classified."""
    if not name:
        return None
    s = str(name).lower().replace("'", "").replace("’", "")
    s = re.sub(r"#\s*\d+", " ", s)        # "trader joes #452"
    s = re.sub(r"\bno\.?\s*\d+", " ", s)  # "safeway no. 12"
    s = re.sub(r"[^a-z0-9 ]", " ", s)     # punctuation -> word breaks
    return _FAMILY_ALIASES.get(" ".join(s.split()))


def _check_receipt_is_this_trips(sess, receipt):
    """The settling receipt must be this trip's (issue #14). A
    receipt settles at most one hunt per account (the demo
    household is exempt: judges replay its sample trips), and a
    receipt dated before the hunt began is refused. The date check
    is date-granular with one day of grace, because hunts carry the
    server clock and receipts carry the store's local time."""
    if not state.in_sandbox():
        for other in _store()["sessions"]:
            if other["id"] != sess["id"] \
                    and other.get("receipt_id") == receipt["receipt_id"]:
                raise ValueError("this receipt already settled another hunt")
    began = (sess.get("started_at") or sess.get("created_at") or "")[:10]
    bought = (receipt.get("purchased_at") or "")[:10]
    try:
        early = date.fromisoformat(bought) < \
            date.fromisoformat(began) - timedelta(days=1)
    except ValueError:
        return  # an undated receipt or session: nothing to compare
    if early:
        raise ValueError(f"this receipt is from {bought}, before the hunt began")


def attach_receipt(session_id, receipt_id):
    """Attach a filed receipt: it scores the hunt and closes the
    session. The receipt must exist in the account's receipts, and —
    when both the hunt's store and the receipt's merchant name a
    known store family — the families must match (issue #11)."""
    receipts = {r["receipt_id"]: r for r in state.receipts()}
    receipt = receipts.get(receipt_id)
    if receipt is None:
        return None
    sess = get_session(session_id)
    if sess is not None:
        hunt_family = _store_family(sess.get("store"))
        receipt_family = _store_family(receipt.get("merchant"))
        if hunt_family and receipt_family and hunt_family != receipt_family:
            raise ValueError(
                f"this receipt is from {receipt.get('merchant')}; "
                f"the hunt is at {sess.get('store')}")
        _check_receipt_is_this_trips(sess, receipt)

    if sess is not None and sess.get("store_id"):
        state.link_receipt_store(receipt_id, sess["store_id"])

    def fn(sess):
        sess["receipt_id"] = receipt_id
        sess["state"] = "done"
        sess["settled"] = True
        if not sess["finished_at"]:
            sess["finished_at"] = _now()
    return _mutate(session_id, fn)


def detach_receipt(receipt_id):
    """Un-settle every hunt this receipt settled (the receipt is
    being deleted): the hunt returns to finished/unsettled — its
    play record stands, its proof is gone, and receipt-banked
    points stop crediting because boards read settled sessions."""
    with state.file_lock("quest.json"):
        s = _store()
        hit = False
        for sess in s["sessions"]:
            if sess.get("receipt_id") == receipt_id:
                sess["receipt_id"] = None
                sess["settled"] = False
                sess["state"] = "finished"
                hit = True
        if hit:
            _save_store(s)
    return hit


def delete_session(session_id):
    """Hard-remove one hunt from the player's history (Tranche 1).
    Points and badges recompute from the remaining sessions."""
    with state.file_lock("quest.json"):
        s = _store()
        kept = [x for x in s["sessions"] if x["id"] != session_id]
        if len(kept) == len(s["sessions"]):
            return False
        s["sessions"] = kept
        _save_store(s)
    return True


SAMPLE_PRICE = 3.99   # a sample line with no price history


def sample_receipt(session_id):
    """The demo's "Use a sample receipt" door (Hunt v2 plan item 8).
    Files a synthetic receipt for this trip — merchant = the hunt's
    store, dated today, one line per collected item at its last known
    price — and settles the hunt through attach_receipt, the same
    path a real receipt takes. Callers allow this in the demo
    sandbox only, so nothing reaches disk. Returns None when the
    session does not exist."""
    sess = get_session(session_id)
    if sess is None:
        return None
    prices = {}
    for e in state.derived()["entries"]:
        if e.get("event_type") == "purchase":
            prices[e["item_id"]] = e["price"]
    gm = state.group_map()
    lines = []
    for it in sess["items"]:
        if not it.get("checked"):
            continue
        price = prices.get(it["group"])
        if price is None:
            price = next((p for iid, p in prices.items()
                          if gm.get(iid, iid) == it["group"]), None)
        if price is None:
            # No price history: a $0.00 line would let a free trip
            # settle a hunt and bank its points (QA 2026-10-28).
            price = SAMPLE_PRICE
        qty = it.get("qty", 1)
        lines.append({"decoded_name": it["name"], "qty": qty,
                      "unit_price": price,
                      "line_total": round(price * qty, 2),
                      "line_type": "item", "status": "auto"})
    if not lines:
        raise ValueError("Grab something first, then the sample receipt "
                         "has something to list.")
    subtotal = round(sum(ln["line_total"] for ln in lines), 2)
    rid = _new_id("sample", session_id + _now())
    state.add_receipts([{
        "receipt_id": rid, "merchant": sess["store"],
        # Receipt dates are calendar days everywhere (decode's
        # _iso_day): a time here breaks the brain's date math.
        "purchased_at": _today(), "source_type": "sample", "live": True,
        "lines": lines, "subtotal": subtotal, "tax": 0,
        "total": subtotal, "totals_reconcile": True,
        "image_ref": None}])
    return attach_receipt(session_id, rid)


def sample_list_receipt(store, item_ids):
    """The demo's sample receipt for a tick-mode trip (retest 2026-10-31
    #16): the same lines as sample_receipt (the last price paid for
    each ticked item, else SAMPLE_PRICE), filed under the list's store,
    with no hunt to settle. Demo sandbox only (the route checks), so
    nothing reaches disk. Returns the filed receipt."""
    prices, names = {}, state.names()
    for e in state.derived()["entries"]:
        if e.get("event_type") == "purchase":
            prices[e["item_id"]] = e["price"]
    fl = state.flags()
    lines = []
    for iid in item_ids or []:
        name = fl.get(iid, {}).get("name") or names.get(iid)
        if not name:
            continue
        price = prices.get(iid, SAMPLE_PRICE)
        lines.append({"decoded_name": name, "item_id": iid, "qty": 1, "unit_price": price,
                      "line_total": price, "line_type": "item", "status": "auto"})
    if not lines:
        raise ValueError("Tick something first, then the sample receipt has something to list.")
    subtotal = round(sum(ln["line_total"] for ln in lines), 2)
    rec = {"receipt_id": _new_id("sample", (store or "") + _now()), "merchant": store or "Sample store",
           "purchased_at": _today(), "source_type": "sample", "live": True,
           "lines": lines, "subtotal": subtotal, "tax": 0, "total": subtotal,
           "totals_reconcile": True, "image_ref": None}
    state.add_receipts([rec])
    return rec


def progress(sess):
    total = len(sess["items"])
    done = sum(1 for i in sess["items"] if i.get("checked"))
    return {"checked": done, "total": total,
            "complete": total > 0 and done == total}


def finish_time(sess):
    """The photo-finish clock: the attached receipt's own timestamp
    when there is one, else the session's finish time."""
    if sess.get("receipt_id"):
        for r in state.receipts():
            if r["receipt_id"] == sess["receipt_id"]:
                return r.get("purchased_at")
    return sess.get("finished_at")


# --- Shop-Off ---------------------------------------------------------------
# Race mechanics are local: both players' sessions live in this
# account and the opponent's is a placeholder, marked as such.
# The opponent must still be a real registered account (review
# 2026-10-28, M10) — a race against a handle nobody owns can
# never be joined, finished, or verified.

def my_avatar():
    return _store().get("avatar")


def set_avatar(filename):
    """The player's character (owner, 2026-10-28): one of the cast
    portraits on disk, nothing else. Stored on the account's quest
    store; the client falls back to the basket when unset."""
    import os, re
    if not filename or not re.fullmatch(r"[a-z0-9_\-]+\.webp", filename):
        return None
    here = os.path.join(os.path.dirname(__file__), "..", "pwa",
                        "assets", "characters")
    if filename not in os.listdir(here):
        return None
    with state.file_lock("quest.json"):
        s = _store()
        s["avatar"] = filename
        _save_store(s)
    return filename


def sos_count(store_name, item_name):
    """How many of the player's own trips to this store ended with
    this item reported not there — distinct sessions, their reports
    only. The Shelf SOS card quotes this number, so it counts only
    what the reports prove."""
    me = my_handle()
    key = _item_key(item_name or "")
    sessions = {r["session_id"] for r in _store()["reports"]
                if r.get("reporter") == me
                and r.get("state") != "withdrawn"
                and _same_store(r.get("store"), store_name)
                and (r.get("item_group") == key
                     or state._norm_name(r.get("item") or "") == state._norm_name(item_name or ""))}
    return {"store": store_name, "item": item_name, "trips": len(sessions)}


# Words that say HOW a product is sold, not WHAT it is. Dropping them
# lets 'MILK ORGANIC HALF GALLON' meet 'Milk - 2%'. Conservative: a word
# that could change the food (oat, almond, juice, sauce) is never here.
_NOISE = {"org", "organic", "orgnc", "each", "ea", "half", "gallon", "gal",
          "oz", "lb", "lbs", "ct", "pk", "pack", "fl", "fresh", "large",
          "small", "medium", "lg", "sm", "md", "the", "and", "of", "per",
          "value", "family", "size", "natural", "non", "gmo", "kirkland",
          "signature", "ks"}
# Receipt shorthand seen on real receipts -> the full word.
_ABBR = {"bnna": "banana", "bnn": "banana", "bnnas": "banana",
         "chkn": "chicken", "strwbry": "strawberry", "blkbry": "blackberry",
         "blubry": "blueberry", "tom": "tomato", "brocc": "broccoli"}
# Apple varieties: dropped only when the name also says 'apple'.
_APPLE_KINDS = {"cosmic", "crisp", "fuji", "gala", "honeycrisp", "granny",
                "smith", "pink", "lady", "envy", "ambrosia", "braeburn",
                "jazz", "red", "golden", "delicious", "mcintosh", "opal"}
# A name that differs by one of these is a different product
# ('Apple Juice' is not 'Apple'; 'Peanut Butter' is not 'Peanut').
_FORMS = {"juice", "sauce", "butter", "milk", "oil", "vinegar", "chips",
          "bar", "bars", "cake", "pie", "cereal", "soda", "jam", "paste",
          "powder", "cheese", "yogurt", "cream", "bread", "candy", "snack",
          "almond", "oat", "soy", "coconut", "rice", "cashew", "chocolate",
          "peanut", "vanilla", "goat", "pizza", "salad", "soup",
          "snacks", "cookie", "cookies", "dried", "frozen", "canned"}


def _singular(w):
    if len(w) <= 3:
        return w
    if w.endswith("ies"):
        return w[:-3] + "y"
    if w.endswith(("oes", "ches", "shes", "xes")):
        return w[:-2]
    if w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def _core_tokens(name):
    """What a product name is, with plural, organic, size, unit, price
    and apple-variety noise removed. 'APPLES COSMIC CRISP 2 @ $1.19
    x2' -> {'apple'}; 'Milk - 2%' -> {'milk'}."""
    import re as _re
    out = set()
    for t in _re.split(r"[^a-z0-9]+", (name or "").lower()):
        t = _ABBR.get(t, t)
        if len(t) <= 2 or any(c.isdigit() for c in t) or t in _NOISE:
            continue
        out.add(_singular(t))
    if "apple" in out:
        out -= _APPLE_KINDS
    return out


def _name_match(a, b):
    """Receipt-line / sighting vs hunt item. Same product once plurals,
    organic, size and price noise are gone ('banana' = 'BANANA ORG EACH
    2 @ $0.29'), else token Jaccard >= 0.5 on those core words.
    'Greek Yogurt' matches 'Greek Yogurt 32 oz'; 'Oat Milk Chocolate'
    does NOT match 'Milk', and 'Apple Juice' does not match 'Apple': a
    longer product name that merely contains the word is a different
    product, and calling it the hunt item would hide a wild find."""
    ta, tb = _core_tokens(a), _core_tokens(b)
    if not ta or not tb or not (ta & tb):
        return False
    if ta == tb:
        return True
    if (ta ^ tb) & _FORMS:
        return False
    return len(ta & tb) / len(ta | tb) >= 0.5


def session_view(sess):
    """The session as the client sees it, plus its wild finds: when
    a receipt settled the hunt, the receipt lines that match no hunt
    item are the impulse buys — caught by the receipt, named, never
    guessed (a line that matches nothing was really bought)."""
    if sess is None:
        return None
    out = dict(sess)
    wild = []
    if sess.get("settled") and sess.get("receipt_id"):
        receipt = next((r for r in state.receipts()
                        if r["receipt_id"] == sess["receipt_id"]), None)
        if receipt:
            # Items left for next time are still list items: a receipt
            # line for one is not a wild find.
            names = [it["name"] for it in sess.get("items", [])] \
                + [it["name"] for it in sess.get("left", [])]
            for ln in receipt.get("lines", []):
                nm = ln.get("decoded_name") or ln.get("raw") or ""
                if nm and not any(_name_match(nm, n) for n in names) \
                        and nm not in wild:
                    wild.append(nm)
    out["wild_finds"] = wild
    me = my_handle()
    out["my_reports"] = [r["item"] for r in _store()["reports"]
                         if r.get("session_id") == sess.get("id")
                         and r.get("reporter") == me
                         and r.get("state") != "withdrawn"]
    return out


def haul_check(session_id, sightings):
    """Snap your haul (owner, 2026-10-28): the Eyes read of the
    haul photo, matched against the hunt. Sightings that match a
    hunt item are seen; the rest are extras the list never knew
    (impulse buys, caught by the camera); hunt items not sighted
    stay 'not seen' — a photo never proves an absence. The read is
    saved on the session; the photo itself is not kept."""
    sess = get_session(session_id)
    if sess is None:
        return None
    items = sess.get("items", [])
    seen, extras, used = [], [], set()
    for sg in sightings:
        nm = sg.get("name") or ""
        hit = next((i for i, it in enumerate(items)
                    if i not in used and _name_match(nm, it["name"])), None)
        if hit is None:
            extras.append(nm)
        else:
            used.add(hit)
            seen.append({"item": items[hit]["name"], "read": nm})
    result = {"seen": seen, "extras": extras,
              "not_seen": [it["name"] for i, it in enumerate(items)
                           if i not in used],
              "at": _now()}
    def fn(s):
        s["haul_check"] = result
    _mutate(session_id, fn)
    return result


def my_handle():
    user = state._current_user.get() or ""
    handle = user.split("@")[0].strip().lower()
    return handle or "you"


def create_shopoff(store_name, raw_items, opponent_handle, client=None):
    opponent = (opponent_handle or "").strip().lstrip("@").lower()
    if not opponent:
        raise ValueError("opponent_handle is required")
    if username_for_handle(opponent) is None:
        raise ValueError("no account with that handle")
    race_id = _new_id("race", store_name + opponent)
    mine = create_session(store_name, "quest", raw_items,
                          extra={"shopoff_id": race_id}, client=client)
    theirs = create_session(store_name, "quest", raw_items,
                            extra={"shopoff_id": race_id,
                                   "placeholder": True,
                                   "owner_handle": opponent}, client=client)
    race = {"id": race_id, "store": store_name, "state": "racing",
            "created_at": _now(), "winner": None,
            "players": [{"handle": my_handle(), "session_id": mine["id"]},
                        {"handle": opponent, "session_id": theirs["id"],
                         "placeholder": True}]}
    with state.file_lock("quest.json"):
        s = _store()
        s["shopoffs"].append(race)
        _save_store(s)
    return race_view(race)


def race_view(race):
    players = []
    for p in race["players"]:
        sess = get_session(p["session_id"])
        players.append({**p,
                        "progress": progress(sess) if sess else None,
                        "done": bool(sess) and sess["state"] == "done",
                        "finish_time": finish_time(sess) if sess else None})
    view = {**race, "players": players}
    if race["state"] != "finished" and len(players) == 2 \
            and all(p["done"] for p in players):
        times = [p["finish_time"] or "" for p in players]
        winner = None
        if times[0] and times[1] and times[0] != times[1]:
            winner = players[0]["handle"] if times[0] < times[1] \
                else players[1]["handle"]
        with state.file_lock("quest.json"):
            s = _store()
            for r in s["shopoffs"]:
                if r["id"] == race["id"]:
                    r["state"] = "finished"
                    r["winner"] = winner
                    _save_store(s)
        view["state"] = "finished"
        view["winner"] = winner
    return view


def get_shopoff(race_id):
    for race in _store()["shopoffs"]:
        if race["id"] == race_id:
            return race_view(race)
    return None


# --- Spotter: "not here" reports (GAME-DESIGN, store drift) ----------------
# A hunt is a shelf survey: COLLECT confirms presence, a report flags
# absence. A report edits nothing — it marks the stop "reported
# missing" and opens the resolution window. The lifecycle is
# reported -> resolved_stockout | verified_move; those transitions
# (a later collect clears it as a stockout; an independent confirm at
# a new spot applies the move) are rollout — this build carries the
# state field and the data shape only. Rewards land on truth, never
# on reports, so filing one earns nothing by itself.

REPORT_KINDS = ("empty_shelf", "replaced", "wrong_aisle", "cant_tell")
REPORT_STATES = ("reported", "resolved_stockout", "verified_move", "withdrawn")


SIGHTINGS_MAX = 2000


def record_sightings(session_id, pops):
    """Find it for me (owner, 2026-10-28) feeds the store map: each
    verified pop is kept as WHAT was seen WHERE and WHEN — the item,
    the store, the stop's shelf label when matched, the time. The
    frame itself is never kept (Discussion 37: bystanders); only
    these words are. Returns the sightings written."""
    sess = get_session(session_id)
    if sess is None or not pops:
        return []
    by_name = {it["name"]: it for it in sess["items"]}
    out = []
    with state.file_lock("quest.json"):
        s = _store()
        for p in pops:
            it = by_name.get(p.get("item"))
            if it is None:
                continue
            rec = {"store": sess["store"], "item": it["name"],
                   "item_group": it["group"],
                   "shelf_label": it.get("shelf_label"),
                   "grade": p.get("grade"), "seen_at": _now(),
                   "session_id": session_id}
            s["sightings"].append(rec)
            out.append(rec)
        s["sightings"] = s["sightings"][-SIGHTINGS_MAX:]
        _save_store(s)
    # Map my store: remember which segment each item was seen in.
    from api import storemap, shared_reports
    for rec in out:
        storemap.note_sighting(rec["store"], rec["item"],
                               rec.get("shelf_label"))
        shared_reports.found(rec["store"], rec["item"], rec.get("item_group"))
    return out


FRAMES_FILE = "shelf_frames.json"
FRAMES_MAX = 300          # one latest photo per (store, item)
FRAMES_MAX_SANDBOX = 12   # the demo overlay holds 2 MB


def _frame_key(store, item):
    norm = lambda t: re.sub(r"\s+", " ", (t or "").strip().lower())
    return f"{norm(store)}|{norm(item)}"


def keep_frame(session_id, pops, jpeg, people_scrubbed):
    """A fresh shelf photo per item the scan verified (owner,
    2026-10-28: the shoppers' frames refresh the store photos). The
    jpeg is already people-scrubbed (shelfscan.scrub_people) — never
    call this with a raw frame. Latest wins per (store, item)."""
    sess = get_session(session_id)
    if sess is None or not pops or not jpeg:
        return 0
    b64 = base64.b64encode(jpeg).decode()
    names = {it["name"] for it in sess["items"]}
    n = 0
    with state.file_lock(FRAMES_FILE):
        frames = state._load(FRAMES_FILE, {})
        for p in pops:
            if p.get("item") not in names:
                continue
            frames.pop(_frame_key(sess["store"], p["item"]), None)
            frames[_frame_key(sess["store"], p["item"])] = {
                "store": sess["store"], "item": p["item"],
                "box": p.get("box"), "grade": p.get("grade"),
                "seen_at": _now(), "people_scrubbed": people_scrubbed,
                "jpeg_b64": b64}
            n += 1
        cap = FRAMES_MAX_SANDBOX if state.in_sandbox() else FRAMES_MAX
        while len(frames) > cap:
            frames.pop(next(iter(frames)))
        state._save(FRAMES_FILE, frames)
    return n


def shelf_photo(store, item):
    return state._load(FRAMES_FILE, {}).get(_frame_key(store, item))


def report_missing(session_id, item_name, kind, photo=None):
    """File a "not here" report for an item on a session's list.
    Returns the report, the existing open report for the same stop
    (reports are idempotent per stop), or None when the session or
    the item does not exist."""
    if kind not in REPORT_KINDS:
        raise ValueError(f"kind must be one of {REPORT_KINDS}")
    sess = get_session(session_id)
    if sess is None:
        return None
    key = _item_key(item_name or "")
    norm = state._norm_name(item_name or "")
    item = None
    for it in sess["items"]:
        if it["group"] == key or state._norm_name(it["name"]) == norm:
            item = it
            break
    if item is None:
        return None
    with state.file_lock("quest.json"):
        s = _store()
        for rep in s["reports"]:
            if rep["session_id"] == session_id \
                    and rep["item_group"] == item["group"] \
                    and rep["state"] == "reported":
                return rep
        rep = {"id": _new_id("rep", session_id + item["group"]),
               "session_id": session_id, "store": sess["store"],
               "item": item["name"], "item_group": item["group"],
               "kind": kind, "photo": photo or None,
               "state": "reported", "reported_at": _now(),
               "reporter": my_handle()}
        s["reports"].append(rep)
        _save_store(s)
    # Tell other Arya shoppers (owner, 2026-11-03): the shared copy
    # holds no name, session or photo (api/shared_reports.py).
    from api import shared_reports
    shared_reports.add(rep["store"], rep["item"], rep["item_group"], kind)
    return rep


def _same_store(a, b):
    """Store identity for report matching: the normalized names are
    equal, or equal with spaces removed — so "Trader Joe's" (whose
    apostrophe normalizes to a word break) and "trader joes" are one
    store, while genuinely different names stay different."""
    na, nb = state._norm_name(a or ""), state._norm_name(b or "")
    return na == nb or na.replace(" ", "") == nb.replace(" ", "")


def store_reports(store_name):
    """A store's open reports — the candidate queue a hunt reads to
    flag its stops. Open means still in the "reported" state. Other
    shoppers' reports that passed the quorum are added for items on
    this household's lists, in the household's own words (never the
    reporter's text or anything about the reporter)."""
    open_reps = [r for r in _store()["reports"]
                 if r["state"] == "reported"
                 and _same_store(r.get("store"), store_name)]
    from api import shared_reports
    groups = shared_reports.groups(store_name)
    if groups:
        names = _my_list_names()
        for g in groups:
            mine = _list_name_for(names, g["item_key"])
            if mine:
                open_reps.append({"store": store_name, "item": mine, "kind": g["kind"],
                                  "state": "reported", "reported_at": g["latest"],
                                  "shared": True, "count": g["count"]})
    return {"store": store_name, "count": len(open_reps),
            "reports": open_reps}


NEWS_SEEN = "news_seen.json"
NEWS_SHOW_H = 12      # an alert shows for 12 hours, then waits for a newer report
NEWS_HIDDEN = "news_hidden.json"
NEWS_HIDDEN_MAX = 200


def _news_hidden(open_groups):
    """This account's hidden store alerts ({store_key|item_key: hidden
    at}), keeping only those whose report is still open (owner,
    2026-11-03): a hide lasts while that report stays open, however
    many shoppers add to it, and is forgotten once it clears (3 days,
    or someone found the item). A report whose every entry is newer
    than the hide was opened again after a clear, so it shows again."""
    oldest = {g["store_key"] + "|" + g["item_key"]: g.get("oldest") or "" for g in open_groups}
    hidden = state._load(NEWS_HIDDEN, {})
    keep = {k: at for k, at in hidden.items() if k in oldest and oldest[k] <= at}
    if keep != hidden:
        state._save(NEWS_HIDDEN, keep)
    return keep


def hide_news(news_id, hide=True):
    """Hide one store alert for this account only, or (hide=False)
    bring it back (Undo). Other shoppers still see it, and the list
    does not change. Only an open report can be hidden. Returns False
    when there is no such open report."""
    from api import shared_reports
    news_id = str(news_id or "")
    with state.file_lock(NEWS_HIDDEN):
        groups = shared_reports.groups()
        hidden = _news_hidden(groups)
        if hide:
            if news_id not in {g["store_key"] + "|" + g["item_key"] for g in groups}:
                return False
            hidden[news_id] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if len(hidden) > NEWS_HIDDEN_MAX:
                hidden = dict(sorted(hidden.items(), key=lambda kv: kv[1])[-NEWS_HIDDEN_MAX:])
        else:
            hidden.pop(news_id, None)
        state._save(NEWS_HIDDEN, hidden)
    return True


def _match_name(name):
    """Item identity for the news filter: the normalized name (case,
    punctuation and extra spaces ignored) with a plural ending on the
    last word dropped, so "Bananas" matches "banana" and "Berries"
    matches "berry". Sizes and extra words still count: "Greek Yogurt
    32 oz" is not "Greek Yogurt"."""
    words = state._norm_name(name or "").split()
    if not words:
        return ""
    w = words[-1]
    if len(w) > 4 and w.endswith("ies"):
        w = w[:-3] + "y"
    elif len(w) > 4 and w.endswith(("ches", "shes", "sses", "xes", "zes")):
        w = w[:-2]
    elif len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        w = w[:-1]
    return " ".join(words[:-1] + [w])


def _my_list_names():
    """Items on one of this household's lists now, not yet checked off,
    as {match key: the household's own name}."""
    try:
        items = state.derived()["smart_list"]["items"]
    except Exception:
        return {}
    out = {}
    for i in items:
        if i.get("on_list") and not i.get("checked"):
            k = _match_name(i.get("name"))
            if k:
                out.setdefault(k, i.get("name"))
    return out


def _list_name_for(names, item_key):
    """The household's own name for a shared report's item: the same
    key first, else a list item with the same core words as the report
    (owner, 2026-11-04: "Large eggs" and "Eggs 12 ct" are eggs). Equal
    core words only, never the looser receipt Jaccard: "Egg noodles"
    and "Almond milk" never take an eggs or milk alert."""
    hit = names.get(item_key)
    if hit:
        return hit
    want = _core_tokens(item_key)
    if not want:
        return None
    for name in names.values():
        if _core_tokens(name) == want:
            return name
    return None


def _my_store_names():
    """Stores this household uses: My stores plus the stores named on
    its lists."""
    names = []
    try:
        from api import stores
        names += [s.get("name") for s in stores.mine()]
    except Exception:
        pass
    for l in state.named_lists():
        names += list(l.get("stores") or [])
    return [n for n in names if n]


def store_news(limit=20):
    """Store news: other shoppers' "Not here" reports, only where they
    help this household (owner, 2026-11-03, "I don't want to be
    spammed"):
    - the item is on one of its lists now (see _match_name);
    - the store is one it uses (My stores, or a list's stores);
    - a store and item needs ARYA_REPORT_QUORUM distinct accounts
      (default 3) before anyone else sees it (shared_reports.others);
    - reports for the same store and item fold into one alert that
      counts the distinct shoppers ("3 shoppers say not here");
    - its own reports never alert it;
    - an alert shows for NEWS_SHOW_H hours, then stays quiet until a
      newer report for that store and item arrives;
    - feed only: nothing here sends a push or an email;
    - an alert the household hid (✕ on Today) stays out while that
      report is open (_news_hidden).
    Each alert carries an id (store key | item key) for hiding.
    Newest first."""
    from api import shared_reports
    wanted = _my_list_names()
    if not wanted:
        return {"news": []}
    from api.shared_reports import store_key
    my_stores = {}
    for m in _my_store_names():
        my_stores.setdefault(store_key(m), m)
    found = []
    groups = shared_reports.groups()
    with state.file_lock(NEWS_HIDDEN):
        hidden = _news_hidden(groups)
    for g in groups:
        item = _list_name_for(wanted, g["item_key"])
        store = my_stores.get(g["store_key"])
        key = g["store_key"] + "|" + g["item_key"]
        if item and store and key not in hidden:
            found.append({"store": store, "item": item, "kind": g["kind"],
                          "count": g["count"], "reported_at": g["latest"],
                          "shared": True, "id": key, "_key": key})
    if not found:
        return {"news": []}
    now = datetime.now(timezone.utc)
    news = []
    with state.file_lock(NEWS_SEEN):
        seen = state._load(NEWS_SEEN, {})
        changed = False
        for n in found:
            k = n.pop("_key")
            mark = seen.get(k)
            if mark is None or mark.get("latest") != n["reported_at"]:
                seen[k] = {"latest": n["reported_at"], "first": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
                changed = True
            else:
                try:
                    first = datetime.strptime(mark["first"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                except (KeyError, ValueError):
                    first = now
                if (now - first).total_seconds() >= NEWS_SHOW_H * 3600:
                    continue
            news.append(n)
        if changed:
            state._save(NEWS_SEEN, seen)
    news.sort(key=lambda g: g["reported_at"] or "", reverse=True)
    return {"news": news[:limit]}
