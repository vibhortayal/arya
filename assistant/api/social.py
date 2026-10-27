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


def request_friend(handle):
    handle = _norm_handle(handle)
    if not handle:
        raise ValueError("handle is required")
    if handle == quest.my_handle():
        raise ValueError("that is your own handle")
    s = quest._store()
    for f in s["friends"]:
        if f["handle"] == handle:
            if f["status"] == "pending_in":
                f["status"] = "accepted"  # mutual: they asked first
                quest._save_store(s)
            return f
    friend = {"handle": handle, "status": "pending_out",
              "top_badge": None, "last_hunt": None}
    s["friends"].append(friend)
    quest._save_store(s)
    return friend


def accept_friend(handle):
    handle = _norm_handle(handle)
    s = quest._store()
    for f in s["friends"]:
        if f["handle"] == handle and f["status"] == "pending_in":
            f["status"] = "accepted"
            quest._save_store(s)
            return f
    return None


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
    return [s for s in quest._store()["sessions"] if s["state"] == "done"]


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
                           f"{len(ctx['receipts'])} of 10 receipts")},
    {"id": "egg_baron", "name": "Egg Baron",
     "criteria": "Buy eggs on 5 receipts",
     "check": lambda ctx: (ctx["egg_receipts"] >= 5,
                           f"{ctx['egg_receipts']} of 5 egg receipts")},
    {"id": "banana_republic", "name": "Banana Republic",
     "criteria": "Buy bananas in 4 different weeks",
     "check": lambda ctx: (len(ctx["banana_weeks"]) >= 4,
                           f"{len(ctx['banana_weeks'])} of 4 banana weeks")},
    {"id": "speed_demon", "name": "Speed Demon",
     "criteria": "Finish a hunt in under 10 minutes",
     "check": lambda ctx: (_speed_demon(ctx["done"]),
                           "a sub-10-minute hunt" )},
    {"id": "clean_sweep", "name": "Clean Sweep",
     "criteria": "Finish a hunt with every item checked",
     "check": lambda ctx: (_clean_sweep(ctx["done"]),
                           "a fully checked hunt")},
    {"id": "first_mapper", "name": "First Mapper",
     "criteria": "Be the first verified mapper of a store",
     "check": lambda ctx: (False, "no store mapped yet")},
]


def badge_shelf():
    egg_receipts, banana_weeks = _line_weeks_and_counts()
    ctx = {"receipts": state.receipts(), "done": _done_sessions(),
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
# the verified total. Photos are not retained by the decode paths
# (image_ref is None today); the field rides along so a stored photo
# shows the day one exists. Nothing here is estimated.

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
            "photo": r.get("image_ref")}


def receipt_archive():
    rs = sorted(state.receipts(),
                key=lambda r: r.get("purchased_at") or "", reverse=True)
    return [_receipt_summary(r) for r in rs]


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


def profile():
    done = _done_sessions()
    return {"handle": quest.my_handle(),
            "stats": {"hunts": len(done),
                      "receipts": len(state.receipts()),
                      "streak_weeks": _streak_weeks(done)},
            "badges": badge_shelf(),
            "mapped_stores": []}
