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
import hashlib, secrets
from datetime import date, datetime

from api import state

MODES = ("quest", "express")
SESSION_STATES = ("not_started", "playing", "paused", "finished", "done")
# The SceneView ladder: the session engine is the game, the scene is
# only a viewport. A session records which driver it started in;
# nothing in play, scoring, or the receipt finish reads it.
DRIVERS = ("photo", "cloud", "aisle", "strip")


# --- store ---------------------------------------------------------------

def _store():
    s = state._load("quest.json", {})
    s.setdefault("sessions", [])
    s.setdefault("shopoffs", [])
    s.setdefault("friends", [])
    s.setdefault("reports", [])
    return s


def _save_store(s):
    state._save("quest.json", s)


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


def _add_item(items, name, qty=1, group=None):
    """Add to a session item list, merging quantity on same product."""
    name = (name or "").strip()
    if not name:
        return items
    qty = max(1, int(qty or 1))
    key = group or _item_key(name)
    for it in items:
        if it["group"] == key:
            it["qty"] += qty
            return items
    items.append({"name": _canonical(name), "qty": qty,
                  "checked": False, "group": key})
    return items


def make_items(raw_items):
    items = []
    for raw in raw_items or []:
        if isinstance(raw, str):
            _add_item(items, raw, 1)
        elif isinstance(raw, dict) and raw.get("name"):
            _add_item(items, raw["name"], raw.get("qty", 1),
                      group=raw.get("group"))
    return items


# --- sessions --------------------------------------------------------------

def create_session(store_name, mode="quest", raw_items=None, extra=None,
                   driver="strip", store_id=None, store_address=None,
                   client=None):
    if mode not in MODES:
        raise ValueError("mode must be quest or express")
    if driver not in DRIVERS:
        raise ValueError(f"driver must be one of {DRIVERS}")
    s = _store()
    # Item–shelf matching (stores with a shelf graph only): stops
    # gain their shelf label + path position and walk in shelf
    # order. A store with no graph keeps its items exactly as made.
    from api import shelfmatch
    items = shelfmatch.annotate_items(make_items(raw_items),
                                      store_name, client)
    sess = {"id": _new_id("qs", store_name),
            "store": store_name, "mode": mode, "driver": driver,
            "state": "not_started",
            "items": items,
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
    s["sessions"].append(sess)
    _save_store(s)
    return sess


def list_sessions():
    """Today's sessions first, then newest first (UX: the day is a row
    of games)."""
    today = _today()
    out = sorted(_store()["sessions"],
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
    s = _store()
    for sess in s["sessions"]:
        if sess["id"] == session_id:
            fn(sess)
            _save_store(s)
            return sess
    return None


def add_item(session_id, name, qty=1):
    def fn(sess):
        _add_item(sess["items"], name, qty)
    return _mutate(session_id, fn)


def check_item(session_id, item_name, checked):
    """Find the item by display name (or by merge identity) and set its
    checked flag. Returns the session, or None if no such item."""
    key = _item_key(item_name or "")
    norm = state._norm_name(item_name or "")
    found = []

    def fn(sess):
        for it in sess["items"]:
            if it["group"] == key or state._norm_name(it["name"]) == norm:
                it["checked"] = bool(checked)
                found.append(it)
                return
    sess = _mutate(session_id, fn)
    if sess is None or not found:
        return None
    return sess


def set_state(session_id, new_state):
    if new_state not in SESSION_STATES:
        raise ValueError(f"state must be one of {SESSION_STATES}")

    def fn(sess):
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


def attach_receipt(session_id, receipt_id):
    """Attach a filed receipt: it scores the hunt and closes the
    session. The receipt must exist in the account's receipts."""
    known = {r["receipt_id"] for r in state.receipts()}
    if receipt_id not in known:
        return None

    def fn(sess):
        sess["receipt_id"] = receipt_id
        sess["state"] = "done"
        sess["settled"] = True
        if not sess["finished_at"]:
            sess["finished_at"] = _now()
    return _mutate(session_id, fn)


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
# Demo-grade: both players' sessions live in this account; the
# opponent's is a local placeholder, marked as such, until real
# cross-account races exist.

def my_handle():
    user = state._current_user.get() or ""
    handle = user.split("@")[0].strip().lower()
    return handle or "you"


def create_shopoff(store_name, raw_items, opponent_handle, client=None):
    opponent = (opponent_handle or "").strip().lstrip("@").lower()
    if not opponent:
        raise ValueError("opponent_handle is required")
    race_id = _new_id("race", store_name + opponent)
    mine = create_session(store_name, "quest", raw_items,
                          extra={"shopoff_id": race_id}, client=client)
    theirs = create_session(store_name, "quest", raw_items,
                            extra={"shopoff_id": race_id,
                                   "placeholder": True,
                                   "owner_handle": opponent}, client=client)
    s = _store()
    race = {"id": race_id, "store": store_name, "state": "racing",
            "created_at": _now(), "winner": None,
            "players": [{"handle": my_handle(), "session_id": mine["id"]},
                        {"handle": opponent, "session_id": theirs["id"],
                         "placeholder": True}]}
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

REPORT_KINDS = ("empty_shelf", "replaced", "cant_tell")
REPORT_STATES = ("reported", "resolved_stockout", "verified_move")


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
    flag its stops. Open means still in the "reported" state."""
    open_reps = [r for r in _store()["reports"]
                 if r["state"] == "reported"
                 and _same_store(r.get("store"), store_name)]
    return {"store": store_name, "count": len(open_reps),
            "reports": open_reps}
