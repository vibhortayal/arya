"""Hunt operations — leave, restore, edit, swap, forgot, withdraw, boss.

The shopper is in the aisle and the plan changed: an item is out of
stock, the shopper forgot something, or a trip ends with items still
open. These operations change the hunt's own list and nothing else.
They never file a "not here" report, they never touch points except
through the list itself, and they never call a model (deterministic
code, $0). This module imports no model client.

Session shape (cross-slice contract C1). Items that leave the hunt
move from sess["items"] to sess["left"], so indexes, stops, Express,
progress, points and the share card keep working on the items that
remain:
  left entry = the item dict without "checked", plus
               how: "saved" | "dropped", idx: original position,
               at: ISO time, swapped_for: str (swaps only)
  sess["boss"] = {name, group, reports} | None, frozen when the
               session is created. The boss is a list item this
               account reported missing here on 2 or more earlier
               trips, with the reports still open. It is never faked.

The apply_* functions are pure over a session dict (the unit under
test, mirrored by huntmenu.js for offline use). The wrappers below
them take the quest.json lock through quest._mutate.
"""
from api import quest, state

NAME_MAX = 80
NOTE_MAX = 60
ITEMS_MAX = 200
QTY_MIN, QTY_MAX = 1, 99
BOSS_MIN_REPORTS = 2
HOWS = ("saved", "dropped")
_LEFT_ONLY = ("how", "idx", "at", "swapped_for")


class NotFound(LookupError):
    """The session has no such item (the route answers 404)."""


# --- small helpers ------------------------------------------------------

def _name(raw):
    name = " ".join(str(raw or "").split())
    if not name:
        raise ValueError("name is required")
    if len(name) > NAME_MAX:
        raise ValueError(f"name is too long (max {NAME_MAX})")
    return name


def _qty(raw):
    if isinstance(raw, bool):
        raise ValueError("qty must be a whole number")
    try:
        n = int(raw)
        if isinstance(raw, float) and raw != n:
            raise ValueError
    except (TypeError, ValueError, OverflowError):
        # OverflowError: JSON Infinity. NaN raises ValueError.
        raise ValueError("qty must be a whole number")
    if not QTY_MIN <= n <= QTY_MAX:
        raise ValueError(f"qty must be {QTY_MIN} to {QTY_MAX}")
    return n


def _note(raw):
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise ValueError("note must be text")
    note = raw.strip()
    if len(note) > NOTE_MAX:
        raise ValueError(f"note is too long (max {NOTE_MAX})")
    return note


def _find(items, name):
    """Index of the entry for this name, or -1. An exact normalised
    name wins; then the merge identity (group), like check_item."""
    norm = state._norm_name(name or "")
    for i, it in enumerate(items):
        if state._norm_name(it.get("name")) == norm:
            return i
    key = quest._item_key(name or "")
    for i, it in enumerate(items):
        if it.get("group") == key:
            return i
    return -1


def _left_entry(item, how, idx, at, swapped_for=None):
    entry = {k: v for k, v in item.items() if k != "checked"}
    entry.update(how=how, idx=idx, at=at)
    if swapped_for:
        entry["swapped_for"] = swapped_for
    return entry


def _item_from_left(entry):
    item = {k: v for k, v in entry.items() if k not in _LEFT_ONLY}
    item["checked"] = False
    return item


def _lists(sess):
    return sess.setdefault("items", []), sess.setdefault("left", [])


# --- pure operations (mutate the session dict in place) -------------------

def apply_leave(sess, entries, now=None):
    """Move open items to sess["left"]. entries = [{item, how}].
    Idempotent by name: an item already left is skipped. All entries
    are checked before any item moves."""
    if not isinstance(entries, list) or not entries:
        raise ValueError("entries is required")
    if len(entries) > ITEMS_MAX:
        raise ValueError("too many entries")
    items, left = _lists(sess)
    plan, seen = [], set()
    for e in entries:
        if not isinstance(e, dict):
            raise ValueError("each entry needs an item and how")
        how = e.get("how", "saved")
        if how not in HOWS:
            raise ValueError(f"how must be one of {HOWS}")
        name = _name(e.get("item"))
        i = _find(items, name)
        if i < 0:
            if _find(left, name) >= 0:
                continue                      # already left: idempotent
            raise NotFound(name)
        if items[i].get("checked"):
            raise ValueError(f"{items[i]['name']} is in your cart. Put it back first.")
        if i not in seen:
            seen.add(i)
            plan.append((i, how))
    at = now or quest._now()
    moved = [_left_entry(items[i], how, i, at) for i, how in plan]
    sess["items"] = [it for j, it in enumerate(items) if j not in seen]
    left.extend(moved)
    return moved


def apply_restore(sess, name):
    """Bring a left item back to the hunt at its original position
    (or the end), unchecked. If the same product is on the hunt
    again, the quantities merge: an item is never lost."""
    items, left = _lists(sess)
    i = _find(left, _name(name))
    if i < 0:
        raise NotFound(name)
    entry = left[i]
    item = _item_from_left(entry)
    j = _find(items, item["name"])
    if j >= 0:
        items[j]["qty"] = min(QTY_MAX, int(items[j].get("qty") or 1) + int(item.get("qty") or 1))
        items[j]["checked"] = False
        left.pop(i)
        return items[j]
    if len(items) >= ITEMS_MAX:
        raise ValueError("the hunt is full")
    left.pop(i)
    pos = entry.get("idx")
    pos = len(items) if not isinstance(pos, int) else max(0, min(pos, len(items)))
    items.insert(pos, item)
    return item


def apply_edit(sess, name, qty=None, note=None):
    items, _ = _lists(sess)
    i = _find(items, _name(name))
    if i < 0:
        raise NotFound(name)
    if qty is None and note is None:
        raise ValueError("nothing to change")
    new_qty = _qty(qty) if qty is not None else None
    new_note = _note(note) if note is not None else None
    it = items[i]
    if new_qty is not None:
        it["qty"] = new_qty
    if new_note is not None:
        if new_note:
            it["note"] = new_note
        else:
            it.pop("note", None)
    return it


def apply_swap(sess, name, to, annotate=None, now=None):
    """Out of stock: the shopper picks a substitute. The original
    goes to sess["left"] as saved for next trip (swapped_for names
    the substitute). The substitute keeps the quantity and note,
    stays OPEN (no auto-grab), and takes the original's place."""
    items, left = _lists(sess)
    i = _find(items, _name(name))
    if i < 0:
        raise NotFound(name)
    orig = items[i]
    if orig.get("checked"):
        raise ValueError(f"{orig['name']} is in your cart. Put it back first.")
    to = _name(to)
    group = quest._item_key(to)
    if group == orig.get("group") or state._norm_name(to) == state._norm_name(orig["name"]):
        raise ValueError("That is the same item.")
    if _find(items, to) >= 0:
        raise ValueError(f"{quest._canonical(to)} is already on your list.")
    new = {"name": quest._canonical(to), "qty": orig.get("qty") or 1,
           "checked": False, "group": group, "swapped_from": orig["name"]}
    if orig.get("note"):
        new["note"] = orig["note"]
    if annotate is not None:
        annotate([new])
    prior = next((n for n, e in enumerate(left)
                  if orig.get("swapped_from")
                  and state._norm_name(e.get("swapped_for")) == state._norm_name(orig["name"])), -1)
    if prior >= 0:
        # A chain swap (A to B, then B to C): B was only a stand-in, so
        # it is not saved for next trip. A's entry now points at C, and
        # undoing this swap brings A back.
        left[prior]["swapped_for"] = new["name"]
        new["swapped_from"] = left[prior]["name"]
    else:
        left.append(_left_entry(orig, "saved", i, now or quest._now(),
                                swapped_for=new["name"]))
    items[i] = new
    return new


def apply_unswap(sess, to):
    """Undo a swap: the substitute leaves and the original returns
    to the same place with the substitute's current quantity."""
    items, left = _lists(sess)
    j = _find(items, _name(to))
    if j < 0:
        raise NotFound(to)
    sub = items[j]
    if not sub.get("swapped_from"):
        raise ValueError("That item is not a swap.")
    if sub.get("checked"):
        raise ValueError(f"{sub['name']} is in your cart. Put it back first.")
    norm = state._norm_name(sub["name"])
    k = next((n for n, e in enumerate(left)
              if state._norm_name(e.get("swapped_for")) == norm), -1)
    if k < 0:
        raise NotFound(sub["swapped_from"])
    orig = _item_from_left(left.pop(k))
    orig["qty"] = sub.get("qty") or orig.get("qty") or 1
    if sub.get("note"):
        orig["note"] = sub["note"]
    else:
        orig.pop("note", None)
    items[j] = orig
    return orig


def apply_forgot(sess, name, qty=1, note="", annotate=None):
    """The shopper remembers an item in the aisle.
      - it is in sess["left"]: it comes back (restored);
      - it is on the hunt: quantity adds up, a grabbed one reopens
        (merged);
      - else a new open item is added (added), marked added_mid_hunt
        and placed by its shelf position when the store graph knows
        it, else at the end. annotate (client=None) never calls a model.
    A restore also applies the typed quantity (above 1, it sets the
    quantity) and the typed note.
    Returns {"result", "reopened", "prev_qty", "item", "how"}; how is
    the left entry's how for a restore, else None."""
    name = _name(name)
    n = _qty(qty)
    note = _note(note)
    items, left = _lists(sess)
    k = _find(left, name)
    if k >= 0:
        how = left[k].get("how")
        item = apply_restore(sess, name)
        if n > 1:
            item["qty"] = n
        if note:
            item["note"] = note
        return {"result": "restored", "reopened": False, "prev_qty": None,
                "item": item, "how": how}
    i = _find(items, name)
    if i >= 0:
        it = items[i]
        prev = int(it.get("qty") or 1)
        reopened = bool(it.get("checked"))
        it["qty"] = min(QTY_MAX, prev + n)
        it["checked"] = False
        if note:
            it["note"] = note
        return {"result": "merged", "reopened": reopened, "prev_qty": prev,
                "item": it, "how": None}
    if len(items) >= ITEMS_MAX:
        raise ValueError("the hunt is full")
    item = {"name": quest._canonical(name), "qty": n, "checked": False,
            "group": quest._item_key(name), "added_mid_hunt": True}
    if note:
        item["note"] = note
    if annotate is not None:
        annotate([item])
    pos = len(items)
    u = item.get("shelf_u")
    if u is not None:
        pos = next((p for p, it in enumerate(items)
                    if it.get("shelf_u") is None or it["shelf_u"] > u), len(items))
    items.insert(pos, item)
    return {"result": "added", "reopened": False, "prev_qty": None,
            "item": item, "how": None}


def apply_remove_added(sess, name):
    """Undo for 'Forgot something?': only items added on this trip."""
    items, _ = _lists(sess)
    i = _find(items, _name(name))
    if i < 0:
        raise NotFound(name)
    if not items[i].get("added_mid_hunt"):
        raise ValueError("Only items you added on this trip can be removed.")
    return items.pop(i)


# --- boss -------------------------------------------------------------------

def pick_boss(store, items, reports=None, me=None):
    """The boss item: a list item this account reported missing at
    this store on BOSS_MIN_REPORTS or more earlier sessions, with the
    reports still open. Most reports wins; a tie goes to the item
    first on the list. None when nothing qualifies."""
    if reports is None:
        reports = quest._store().get("reports", [])
    me = me or quest.my_handle()
    by_group, by_name = {}, {}
    for r in reports:
        if r.get("state") != "reported" or r.get("reporter") != me:
            continue
        if not quest._same_store(r.get("store"), store):
            continue
        sid = r.get("session_id")
        if not sid:
            continue
        if r.get("item_group"):
            by_group.setdefault(r["item_group"], set()).add(sid)
        by_name.setdefault(state._norm_name(r.get("item")), set()).add(sid)
    best = None
    for it in items or []:
        sids = by_group.get(it.get("group"), set()) | \
            by_name.get(state._norm_name(it.get("name")), set())
        if len(sids) >= BOSS_MIN_REPORTS and (best is None or len(sids) > best["reports"]):
            best = {"name": it["name"], "group": it["group"], "reports": len(sids)}
    return best


def boss_found(sess):
    """True when the boss item is on the hunt and grabbed. Left,
    dropped, swapped or reported items never count."""
    boss = sess.get("boss")
    if not boss:
        return False
    return any(it.get("checked") and it.get("group") == boss.get("group")
               for it in sess.get("items") or [])


# --- wrappers: take the quest.json lock ---------------------------------------

def _run(session_id, fn):
    """Apply fn to the stored session under the lock. Returns the
    session, or None for an unknown session. A closed (done) hunt
    refuses with ValueError; a finished or paused one accepts, so
    queued offline operations can still replay after Finish."""
    def inner(sess):
        if sess.get("state") == "done":
            raise ValueError("this hunt is closed")
        fn(sess)
    return quest._mutate(session_id, inner)


def _annotator(sess):
    from api import shelfmatch
    # client=None: the deterministic shelf match only. No model call.
    return lambda its: shelfmatch.annotate_items(its, sess.get("store"), None)


def leave(session_id, entries):
    return _run(session_id, lambda s: apply_leave(s, entries))


def restore(session_id, name):
    return _run(session_id, lambda s: apply_restore(s, name))


def update_item(session_id, name, qty=None, note=None):
    return _run(session_id, lambda s: apply_edit(s, name, qty, note))


def swap(session_id, name, to):
    return _run(session_id, lambda s: apply_swap(s, name, to, _annotator(s)))


def unswap(session_id, to):
    return _run(session_id, lambda s: apply_unswap(s, to))


def forgot(session_id, name, qty=1, note="", result=None):
    """result (a dict, optional) receives what apply_forgot did, so the
    route can answer with it. The client shows its message and builds
    its Undo from the server's answer, not from its own guess."""
    def fn(s):
        res = apply_forgot(s, name, qty, note, _annotator(s))
        if result is not None:
            result.update(res, item=dict(res["item"]))
    return _run(session_id, fn)


def remove_added(session_id, name):
    return _run(session_id, lambda s: apply_remove_added(s, name))


def withdraw_report(session_id, name):
    """Take back this account's open report for an item of this
    session: its state becomes 'withdrawn'. The report stays on file
    (nothing is erased) but no longer counts anywhere. Idempotent: no
    open report is a no-op. Returns the session, None if unknown."""
    name = _name(name)
    me = quest.my_handle()
    with state.file_lock("quest.json"):
        s = quest._store()
        sess = next((x for x in s["sessions"] if x["id"] == session_id), None)
        if sess is None:
            return None
        if sess.get("state") == "done":
            raise ValueError("this hunt is closed")
        entry = None
        for pool in (sess.get("items") or [], sess.get("left") or []):
            i = _find(pool, name)
            if i >= 0:
                entry = pool[i]
                break
        if entry is None:
            raise NotFound(name)
        for rep in s["reports"]:
            if rep.get("session_id") == session_id \
                    and rep.get("reporter") == me \
                    and rep.get("state") == "reported" \
                    and (rep.get("item_group") == entry.get("group")
                         or state._norm_name(rep.get("item")) == state._norm_name(entry.get("name"))):
                rep["state"] = "withdrawn"
                rep["withdrawn_at"] = quest._now()
        quest._save_store(s)
        return sess
