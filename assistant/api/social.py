"""Quest social — friends, profile, badges (Stage A).
Friends are handle-based: no contact scraping, no chat, boards and
badges only (GAME-DESIGN community rules). The profile's public card
is computed from the account's real data — done sessions and filed
receipts — and every badge is receipt- or session-verified. All
deterministic code, $0, no model calls.
"""
from datetime import date, datetime, timedelta

from api import quest, state
from api.optimizer import _squash
from api.curator import _tokens


# --- friends ---------------------------------------------------------------

def _norm_handle(handle):
    return (handle or "").strip().lstrip("@").lower()


def list_friends():
    return quest._store()["friends"]


def _mirror_friend(their_username, my_handle, status, create):
    """Write my side of the edge into the other account's own
    store: their entry for me, with the mirrored status (my
    pending_out is their pending_in; accepted mirrors as
    accepted). Only the handle and the status cross — top_badge
    and last_hunt start as None there and are never copied.
    create=False updates an existing entry only, so an accept
    cannot invent an edge that was never requested."""
    mirror_status = "pending_in" if status == "pending_out" else status
    with quest._as_user(their_username):
        with state.file_lock("quest.json"):
            s = quest._store()
            for f in s["friends"]:
                if f["handle"] == my_handle:
                    f["status"] = mirror_status
                    quest._save_store(s)
                    return f
            if not create:
                return None
            entry = {"handle": my_handle, "status": mirror_status,
                     "top_badge": None, "last_hunt": None}
            s["friends"].append(entry)
            quest._save_store(s)
            return entry


def request_friend(handle):
    handle = _norm_handle(handle)
    if not handle:
        raise ValueError("handle is required")
    me = quest.my_handle()
    if handle == me:
        raise ValueError("that is your own handle")
    their_username = quest.username_for_handle(handle)
    if their_username is None:
        raise ValueError("no account with that handle")
    friend = None
    with state.file_lock("quest.json"):
        s = quest._store()
        for f in s["friends"]:
            if f["handle"] == handle:
                friend = f
                if f["status"] == "pending_in":
                    f["status"] = "accepted"  # mutual: they asked first
                    quest._save_store(s)
                break
    if friend is not None:
        if friend["status"] == "accepted":
            _mirror_friend(their_username, me, "accepted", create=False)
        elif friend["status"] == "pending_out":
            # Idempotent re-request: re-mirror, in case their side
            # of the edge never landed.
            _mirror_friend(their_username, me, "pending_out", create=True)
        return friend
    friend = {"handle": handle, "status": "pending_out",
              "top_badge": None, "last_hunt": None}
    with state.file_lock("quest.json"):
        s = quest._store()
        s["friends"].append(friend)
        quest._save_store(s)
    _mirror_friend(their_username, me, "pending_out", create=True)
    return friend


def accept_friend(handle):
    handle = _norm_handle(handle)
    entry = None
    with state.file_lock("quest.json"):
        s = quest._store()
        for f in s["friends"]:
            if f["handle"] == handle and f["status"] == "pending_in":
                f["status"] = "accepted"
                quest._save_store(s)
                entry = f
                break
    if entry is None:
        return None
    their_username = quest.username_for_handle(handle)
    if their_username is not None:
        _mirror_friend(their_username, quest.my_handle(),
                       "accepted", create=False)
    return entry


# --- badges ------------------------------------------------------------------
# Data-driven and small: each badge reads the account's receipts and
# done sessions. Earned is a fact, never an estimate.

def _line_weeks_and_counts():
    """(receipts with an egg line, {ISO weeks with a banana line})."""
    egg_receipts, banana_weeks = 0, set()
    for r in state.receipts():
        toks = set()
        for ln in r.get("lines", []):
            if ln.get("line_type") == "item":
                toks |= {_squash(t) for t in _tokens(
                    ln.get("decoded_name") or ln.get("raw") or "")}
        if "egg" in toks:
            egg_receipts += 1
        if "banana" in toks:
            try:
                d = date.fromisoformat(r["purchased_at"][:10])
                banana_weeks.add(d.isocalendar()[:2])
            except Exception:
                pass
    return egg_receipts, banana_weeks


def _done_sessions():
    return [s for s in quest._store()["sessions"]
            if s["state"] == "done" and not s.get("placeholder")]


def _speed_demon(done):
    for s in done:
        try:
            start = datetime.fromisoformat(s["started_at"])
            end = datetime.fromisoformat(s["finished_at"])
        except Exception:
            continue
        if 0 <= (end - start).total_seconds() < 600:
            return True
    return False


def _clean_sweep(done):
    return any(s["items"] and all(i.get("checked") for i in s["items"])
               for s in done)


BADGES = [
    {"id": "top_contributor", "name": "Top Contributor",
     "criteria": "File 10 receipts",
     "check": lambda ctx: (len(ctx["receipts"]) >= 10,
                           f"{min(len(ctx['receipts']), 10)} of 10 receipts")},
    {"id": "egg_baron", "name": "Egg Baron",
     "criteria": "Buy eggs on 5 receipts",
     "check": lambda ctx: (ctx["egg_receipts"] >= 5,
                           f"{min(ctx['egg_receipts'], 5)} of 5 egg receipts")},
    {"id": "banana_republic", "name": "Banana Republic",
     "criteria": "Buy bananas in 4 different weeks",
     "check": lambda ctx: (len(ctx["banana_weeks"]) >= 4,
                           f"{min(len(ctx['banana_weeks']), 4)} of 4 banana weeks")},
    {"id": "speed_demon", "name": "Speed Demon",
     "criteria": "Finish a hunt in under 10 minutes, receipt attached",
     "check": lambda ctx: (_speed_demon(ctx["done"]),
                           "a sub-10-minute hunt" )},
    {"id": "clean_sweep", "name": "Clean Sweep",
     "criteria": "Finish a hunt with every item checked and its receipt attached",
     "check": lambda ctx: (_clean_sweep(ctx["done"]),
                           "a fully checked hunt")},
    {"id": "first_mapper", "name": "First Mapper",
     "criteria": "Be the first verified mapper of a store",
     "check": lambda ctx: (False, "no store mapped yet")},
    {"id": "eagle_eye", "name": "Eagle Eye",
     "criteria": "Spot a store change and have it verified",
     "check": lambda ctx: _eagle_eye(ctx["reports"])},
]


def _eagle_eye(reports):
    """Earned only when a report resolves as a verified move —
    rewards land on truth, never on reports, so an open or stockout
    report alone does not earn it."""
    n = sum(1 for r in reports if r.get("state") == "verified_move")
    return (n >= 1, f"{n} verified spot{'s' if n != 1 else ''}"
            if n else "no verified spots yet")


def badge_shelf():
    egg_receipts, banana_weeks = _line_weeks_and_counts()
    ctx = {"receipts": state.receipts(), "done": _done_sessions(),
           "reports": quest._store()["reports"],
           "egg_receipts": egg_receipts, "banana_weeks": banana_weeks}
    shelf = []
    for b in BADGES:
        earned, detail = b["check"](ctx)
        shelf.append({"id": b["id"], "name": b["name"],
                      "criteria": b["criteria"], "earned": earned,
                      "detail": detail})
    return shelf


# --- receipt archive (Profile's private face) --------------------------------
# Every filed receipt, with its digitized twin: the parsed lines and
# the verified total. Receipts filed from an uploaded photo or PDF
# keep their original (Discussion 42): image_ref names the media
# store key and media_type its type, and the original is served
# back at /api/quest/receipts/<id>/original. Receipts filed
# without an upload carry neither — no original exists and none
# is invented. Nothing here is estimated.

def _receipt_summary(r):
    lines = r.get("lines", [])
    return {"receipt_id": r["receipt_id"],
            "merchant": r.get("merchant", ""),
            "purchased_at": r.get("purchased_at"),
            "total": r.get("total"),
            "totals_reconcile": bool(r.get("totals_reconcile")),
            "items": sum(1 for ln in lines
                         if ln.get("line_type") == "item"),
            "returns_total": round(sum(
                ln.get("line_total") or 0 for ln in lines
                if ln.get("line_type") == "return"), 2),
            "photo": r.get("image_ref"),
            "media_type": r.get("media_type")}


def receipt_archive():
    rs = sorted(state.receipts(),
                key=lambda r: r.get("purchased_at") or "", reverse=True)
    return [_receipt_summary(r) for r in rs]


def unsettled_hunts():
    """Finished hunts still waiting for this trip's receipt
    (Discussion 41). The Receipts view logs each as its own
    entry with a "Receipt missing" tag; uploading the receipt
    later settles the hunt and the entry clears. While a hunt
    is unsettled its play record stands, but receipt-verified
    rewards do not credit — badges and boards read done
    (receipt-closed) sessions only."""
    out = []
    for s in quest._store()["sessions"]:
        if s["state"] != "finished" or s.get("placeholder"):
            continue
        done = sum(1 for i in s["items"] if i.get("checked"))
        out.append({"session_id": s["id"], "store": s["store"],
                    "finished_at": s.get("finished_at"),
                    "items_collected": done,
                    "items_total": len(s["items"])})
    return sorted(out, key=lambda e: e["finished_at"] or "",
                  reverse=True)


def receipt_detail(receipt_id):
    for r in state.receipts():
        if r["receipt_id"] == receipt_id:
            out = _receipt_summary(r)
            out.update({
                "subtotal": r.get("subtotal"), "tax": r.get("tax"),
                "source_type": r.get("source_type"),
                "lines": [{"name": ln.get("decoded_name") or ln.get("raw"),
                           "qty": ln.get("qty", 1),
                           "unit_price": ln.get("unit_price"),
                           "line_total": ln.get("line_total"),
                           "line_type": ln.get("line_type", "item"),
                           "status": ln.get("status")}
                          for ln in r.get("lines", [])]})
            return out
    return None


# --- profile -----------------------------------------------------------------

def _streak_weeks(done):
    weeks = set()
    for r in state.receipts():
        try:
            weeks.add(date.fromisoformat(r["purchased_at"][:10])
                      .isocalendar()[:2])
        except Exception:
            pass
    for s in done:
        for ts in (s.get("finished_at"), s.get("created_at")):
            if ts:
                try:
                    weeks.add(date.fromisoformat(ts[:10]).isocalendar()[:2])
                except Exception:
                    pass
                break
    streak, cur = 0, date.today()
    if cur.isocalendar()[:2] not in weeks:
        cur -= timedelta(days=7)  # last week's streak is still alive
    while cur.isocalendar()[:2] in weeks:
        streak += 1
        cur -= timedelta(days=7)
    return streak


# Points and levels (owner, 2026-10-28: dopamine, never pressure).
# Points only ever add: every collected item, a full haul, and the
# receipt. They bank when the receipt settles the hunt — the receipt
# is the proof (Discussion 41) — so an unsettled hunt shows its
# points as waiting, never as lost. No time limit, no penalty.
POINTS_PER_ITEM = 10
POINTS_FULL_HAUL = 25
POINTS_RECEIPT = 50
LEVEL_STEP = 100   # level n starts at LEVEL_STEP * n(n-1)/2 points


def hunt_points(sess):
    items = sess.get("items") or []
    got = sum(1 for i in items if i.get("checked"))
    pts = got * POINTS_PER_ITEM
    if items and got == len(items):
        pts += POINTS_FULL_HAUL
    return pts + POINTS_RECEIPT


def level_for(points):
    n = 1
    while LEVEL_STEP * (n + 1) * n // 2 <= points:
        n += 1
    floor = LEVEL_STEP * n * (n - 1) // 2
    return {"level": n, "level_floor": floor,
            "next_level_at": LEVEL_STEP * (n + 1) * n // 2}


def profile():
    done = _done_sessions()
    points = sum(hunt_points(s) for s in done)
    return {"handle": quest.my_handle(),
            "avatar": quest.my_avatar(),
            "points": points, **level_for(points),
            "stats": {"hunts": len(done),
                      "receipts": len(state.receipts()),
                      "spots_reported": len(quest._store()["reports"]),
                      "streak_weeks": _streak_weeks(done)},
            "badges": badge_shelf(),
            "mapped_stores": []}
