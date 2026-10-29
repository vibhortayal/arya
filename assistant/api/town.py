"""Demo Town: a simulated neighbourhood for the demo household.

The demo household reads as if hundreds of Arya shoppers live around it:
neighbours report items out of stock, stores closed, busy hours, and
community prices. Everything comes from demo_town/town.json, a pack the
scale simulator builds (harness/scalesim/make_town.py), so the data is
SIMULATED and labelled so on every screen. Real accounts never see it.

Off unless ARYA_DEMO_TOWN=1. Only the demo account is served; a demo
visitor's own reports and the Director's staged moments live in the
demo sandbox (state overlay) and vanish with the visit. Nothing here
reads or writes the household data, the ledger, or the store map.

Rules (SPEC FR-11.7 and the owner's Demo Town design):
- out of stock needs OUT_NEEDS households within OUT_WINDOW_H hours,
  and expires after OUT_SHOW_H hours;
- closed or incident needs CLOSED_NEEDS households within
  CLOSED_WINDOW_H hours, says "not confirmed by the store", and
  expires after CLOSED_SHOW_H hours;
- a community price shows only with 5 or more households behind it;
- nobody is named: reports are counts.
"""
import json
import os
import time
from datetime import datetime, timedelta, timezone

from api import state

PACK_PATH = os.path.join(os.path.dirname(__file__), "..", "demo_town", "town.json")
DOC = "town.json"            # the visitor's sandbox doc: {"events": [...]}

OUT_NEEDS, OUT_WINDOW_H, OUT_SHOW_H = 3, 24, 24
CLOSED_NEEDS, CLOSED_WINDOW_H, CLOSED_SHOW_H = 3, 2, 6
PRICE_NEEDS = 5
EVENTS_MAX = 40

# Real-style chain name -> the invented name the Demo Town uses.
NAMES = {
    "Trader Joe's": "Trader Jill's", "Safeway": "Safeday", "Costco": "Costcozy",
    "Whole Foods": "Whole Meadows", "Aldi": "Aldo's", "Target": "Targot",
    "Sprouts": "Sprout Street", "Corner Market": "Corner Market",
}


def enabled():
    return os.environ.get("ARYA_DEMO_TOWN") == "1"


def active():
    """The flag is on and this request is the demo household."""
    return enabled() and state._current_user.get() == state.DEMO_USER


_pack = None


def pack():
    global _pack
    if _pack is None:
        with open(PACK_PATH) as fh:
            _pack = json.load(fh)
    return _pack


def _key(s):
    return state._norm_name(s).replace(" ", "")


def _events():
    doc = state._load(DOC, {})
    return doc.get("events", []) if isinstance(doc, dict) else []


def _save_events(ev):
    state._save(DOC, {"events": ev[-EVENTS_MAX:]})


# --- turning the pack and the visitor's events into facts -----------------

def _reports(now):
    """Every report as {kind, store, item, at, households}: the pack's
    (aged from now, so the town always looks live) plus the visitor's."""
    out = []
    for r in pack()["reports"]:
        out.append({**r, "at": now - r["minutes_ago"] * 60})
    out.extend(_events())
    return out


def _groups(now):
    """Reports folded by (kind, store, item). households is the sum over
    the rule's window; ago_min is the newest report's age."""
    by = {}
    for r in _reports(now):
        win = (CLOSED_WINDOW_H if r["kind"] in ("closed", "incident") else OUT_WINDOW_H) * 3600
        age = now - r["at"]
        kind = "out" if r["kind"] == "in" else r["kind"]       # "I see them here" cancels one "out"
        sign = -1 if r["kind"] == "in" else 1
        g = by.setdefault((kind, r["store"], r.get("item") or ""),
                          {"kind": r["kind"], "store": r["store"], "item": r.get("item") or "",
                           "households": 0, "newest": 0, "note": r.get("note", ""), "mine": False})
        if age <= win:
            g["households"] += sign * r["households"]
        if sign > 0:
            g["newest"] = max(g["newest"], r["at"])
        if r.get("by") == "you":
            g["mine"] = True
        if r.get("note"):
            g["note"] = r["note"]
    for g in by.values():
        g["households"] = max(0, g["households"])
    return list(by.values())


def _live(g, now):
    """Is the group confirmed (enough households) and still showing?"""
    age_h = (now - g["newest"]) / 3600
    if g["kind"] in ("closed", "incident"):
        return g["households"] >= CLOSED_NEEDS and age_h <= CLOSED_SHOW_H
    if g["kind"] == "rush":
        return age_h <= 3
    return g["households"] >= OUT_NEEDS and age_h <= OUT_SHOW_H


def _local(now):
    return datetime.fromtimestamp(now, timezone(timedelta(hours=pack()["tz_offset_h"])))


def _busy(store, now, groups):
    """Quiet, Busy or Packed, relative to the store's own week."""
    for g in groups:
        if g["kind"] == "rush" and g["store"] == store["name"] and _live(g, now):
            return "packed"
    t = _local(now)
    v = store["busy"][t.weekday()][t.hour]
    return "packed" if v >= 0.7 else "busy" if v >= 0.4 else "quiet"


def _open_now(store, now):
    t = _local(now)
    h = t.hour + t.minute / 60
    return store["opens"] <= h < store["closes"]


def _match(name):
    """Which pack item is this list item? By keyword, first hit."""
    n = state._norm_name(name)
    for it in pack()["items"]:
        if any(m in n for m in it["match"]):
            return it
    return None


def hints(now=None):
    """The whole Demo Town payload for this visitor. One call, computed
    from the pack, the visitor's events and the clock:
      stores   per store: status (open/closed/incident), busy, hours, why
      items    per list item id: where it is out, where it is in, prices
      feed     'Near you today' lines, newest first
    """
    now = now or time.time()
    p = pack()
    groups = _groups(now)
    live = [g for g in groups if _live(g, now)]

    stores = {}
    for s in p["stores"]:
        st = {"name": s["name"], "status": "open", "busy": _busy(s, now, groups),
              "closes": s["closes"], "why": "", "households": 0, "ago_min": 0}
        if not _open_now(s, now):
            st["status"] = "shut"
        for g in live:
            if g["store"] == s["name"] and g["kind"] in ("closed", "incident"):
                st.update(status=g["kind"], why=g["note"], households=g["households"],
                          ago_min=int((now - g["newest"]) / 60))
        stores[s["name"]] = st
    closed = {n for n, s in stores.items() if s["status"] in ("closed", "incident", "shut")}

    def item_view(it):
        row = {}
        for sname, info in p["stock"].get(it["key"], {}).items():
            state_, n, ago = ("in" if info["in"] else "none", info.get("bought_today", 0), 0)
            g = next((g for g in groups if g["kind"] == "out" and g["store"] == sname and g["item"] == it["key"]), None)
            pending = 0
            if g:
                if _live(g, now) and info["in"]:
                    state_, n, ago = "out", g["households"], int((now - g["newest"]) / 60)
                elif g["households"]:
                    pending = g["households"]
            row[sname] = {"state": state_, "households": n, "ago_min": ago, "pending": pending,
                          "price": info.get("price") if info.get("households", 0) >= PRICE_NEEDS else None,
                          "mine": bool(g and g["mine"])}
        return row

    cache = {}
    items = {}
    names = state.names()
    for it_id, nm in names.items():
        it = _match(nm)
        if not it:
            continue
        if it["key"] not in cache:
            cache[it["key"]] = item_view(it)
        view = cache[it["key"]]
        items[it_id] = {"key": it["key"], "name": it["name"], "stores": view,
                        "alt": _alternative(view, closed)}

    feed = []
    for g in sorted(live, key=lambda g: -g["newest"]):
        if g["kind"] == "rush" or (g["kind"] == "out" and stores[g["store"]]["status"] != "open"):
            continue                       # a closed store's stock does not matter
        entry = {"kind": g["kind"], "store": g["store"], "households": g["households"],
                 "ago_min": int((now - g["newest"]) / 60), "why": g["note"]}
        if g["kind"] == "out":
            it = next((i for i in p["items"] if i["key"] == g["item"]), None)
            entry["item"] = it["name"] if it else g["item"]
            entry["alt"] = _alternative(item_view(it), closed | {g["store"]}) if it else None
        feed.append(entry)
    for s in p["stores"]:
        if stores[s["name"]]["status"] == "open" and stores[s["name"]]["busy"] == "quiet":
            feed.append({"kind": "quiet", "store": s["name"]})
            break
    for g in live:
        if g["kind"] == "rush":
            feed.append({"kind": "rush", "store": g["store"]})
    best = p.get("deal")
    if best:
        feed.append({"kind": "price", **best})
    return {"label": "Simulated", "neighbours": p["neighbours"], "stores": stores,
            "items": items, "feed": feed[:6], "alternatives": _store_alternatives(stores)}


def _alternative(view, unavailable):
    """The nearest store that has the item in stock and is open."""
    near = {s["name"]: s["near"] for s in pack()["stores"]}
    ok = [(near[s], s, v) for s, v in view.items() if v["state"] == "in" and s not in unavailable]
    if not ok:
        return None
    _, s, v = min(ok, key=lambda t: t[0])
    return {"store": s, "price": v["price"], "households": v["households"]}


def _store_alternatives(stores):
    """For each store that cannot be shopped: the nearest open, not-packed one."""
    out = {}
    order = {s["name"]: s["near"] for s in pack()["stores"]}
    for n, st in stores.items():
        if st["status"] == "open":
            continue
        cand = [(order[m], m) for m, s2 in stores.items()
                if s2["status"] == "open" and s2["busy"] != "packed" and m != n]
        if cand:
            out[n] = min(cand)[1]
    return out


# --- the visitor's own moves ------------------------------------------------

SCENARIOS = ("eggs_out", "closes", "rush", "incident", "reset")


def stage(scenario, now=None):
    """The Director: add a staged moment to this visitor's sandbox."""
    if scenario not in SCENARIOS:
        raise ValueError("unknown scenario")
    now = now or time.time()
    if scenario == "reset":
        _save_events([])
        return
    ev = _events()
    for r in pack()["scenarios"][scenario]:
        ev.append({"kind": r["kind"], "store": r["store"], "item": r.get("item", ""),
                   "at": now - r.get("minutes_ago", 0) * 60, "households": r["households"],
                   "note": r.get("note", ""), "by": "director"})
    _save_events(ev)


REPORT_KINDS = ("out", "in", "closed", "incident")


def report(kind, store, item="", now=None):
    """A judge's own report: it counts as one more household."""
    if kind not in REPORT_KINDS:
        raise ValueError("unknown report kind")
    if store not in {s["name"] for s in pack()["stores"]}:
        raise ValueError("unknown store")
    if item and item not in {i["key"] for i in pack()["items"]}:
        raise ValueError("unknown item")
    ev = _events()
    ev.append({"kind": kind, "store": store, "item": item, "at": now or time.time(),
               "households": 1, "note": "", "by": "you"})
    _save_events(ev)
