"""Album — the sticker album as pages (Game: album).

Derived on read from stickers.json: nothing here is stored except
the page badges stickers.py records. A sticker lands on one page: its
season page, else its aisle page, else "Other finds". Because the
page is re-derived every read, a better keyword map moves items
to the right page without a migration.

Truth rules: albums are private (no friend feed, no trading, no
chat). A badge is earned at 8 stickers on a page and never un-earns.
A store counts as mapped by you only when you made its first real
(non-walkthrough) aisle section and kept a capture in it. No prices.
No model calls; this module never imports meta_client.
"""
from datetime import date

from api import aisles, quest, stickers

PAGE_NOTES = {
    "other": "Items Arya cannot place yet land here.",
}
SEASON_TEASER = ("Seasonal page. It starts when you find your first "
                 "{word} item and never expires.")
SEASON_STARTED = "Seasonal page. It never expires."
SEASON_WORD = {"Halloween": "pumpkin"}
CHAPTER_TEXT = "Map all of {store} together: {pct}%. Each shelf you add helps."
CHAPTER_DONE = "Chapter complete. You helped map all of {store}."
CHAPTERS_MAX = 6


def _badge(page_id, count, earned_at):
    name = aisles.PAGE_BADGES.get(page_id)
    if not name:
        return None
    earned = earned_at is not None
    to_go = max(0, aisles.SLOTS - count)
    if earned:
        text = f"{name} earned."
    elif to_go == 0:
        # Full page, but the hunt can still undo a grab: the badge is
        # recorded when the hunt closes with its receipt (stickers.open_session_ids).
        text = "Page full. Add your receipt to earn it."
    else:
        text = f"{to_go} to go. No rush."
    return {"id": page_id, "name": name, "earned": earned,
            "earned_at": earned_at, "to_go": 0 if earned else to_go,
            "text": text}


def _page(page_id, kind, recs, title=None, started=True, note=None,
          earned_at=None):
    recs = sorted(recs, key=lambda r: (r.get("first_found_at") or "", r["id"]))
    count = len(recs)
    size = max(4, count) if kind == "other" else aisles.SLOTS
    return {"id": page_id, "title": title or page_id, "kind": kind,
            "size": size, "count": count,
            "stickers": [stickers.public(r) for r in recs],
            "badge": None if kind == "other" else _badge(page_id, count, earned_at),
            "started": started, "note": note}


def settle_badges(recs=None):
    """Record the page badges that are final and return all earned
    badges {page: when}. A page earns its badge at 8 stickers, but a
    sticker from a hunt that is still open can be undone, so only
    stickers from closed hunts count here. Badges never un-earn."""
    recs = stickers.all_stickers() if recs is None else recs
    earned = stickers.badges()
    open_ids = stickers.open_session_ids()
    counts = {}
    for r in recs:
        if r.get("first_session_id") in open_ids:
            continue
        pid = aisles.page_for(r["name"], r.get("shelf_label"))
        counts[pid] = counts.get(pid, 0) + 1
    for page_id, n in counts.items():
        if (page_id != aisles.OTHER and page_id not in earned
                and n >= aisles.SLOTS and aisles.PAGE_BADGES.get(page_id)):
            at, _new = stickers.earn_badge(page_id)
            earned[page_id] = at
    return earned


def view(today=None):
    """{total, pages[], chapters[]} for this account."""
    today = today or date.today()
    try:
        stickers.backfill_from_sessions()
    except Exception:
        pass   # the album reads what it has; backfill is a courtesy
    recs = stickers.all_stickers()
    groups = {}
    for r in recs:
        groups.setdefault(aisles.page_for(r["name"], r.get("shelf_label")), []).append(r)

    earned = settle_badges(recs)

    pages = []
    for a in aisles.AISLES:
        if groups.get(a):
            pages.append(_page(a, "aisle", groups[a], earned_at=earned.get(a)))
    if groups.get(aisles.OTHER):
        pages.append(_page(aisles.OTHER, "other", groups[aisles.OTHER],
                           note=PAGE_NOTES["other"]))
    for s in aisles.SEASONS:
        rs = groups.get(s["id"])
        if rs:
            pages.append(_page(s["id"], "season", rs, title=s["title"],
                               note=SEASON_STARTED, earned_at=earned.get(s["id"])))
        elif aisles.season_visible(s, today):
            word = SEASON_WORD.get(s["id"], s["keywords"][0])
            pages.append(_page(s["id"], "season", [], title=s["title"],
                               started=False, note=SEASON_TEASER.format(word=word)))
    return {"total": len(recs), "pages": pages, "chapters": chapters()}


def summary():
    """{stickers, pages_complete} for the profile. Counts only."""
    try:
        stickers.backfill_from_sessions()
    except Exception:
        pass
    recs = stickers.all_stickers()
    try:
        earned = settle_badges(recs)
    except Exception:
        earned = stickers.badges()
    return {"stickers": len(recs), "pages_complete": len(earned)}


# --- real First Mapper ---------------------------------------------------------

def first_mapped_stores():
    """Stores whose first real aisle section this account made, with a
    kept capture in it. A section seeded from the shipped walkthrough
    never counts. Returns store names, oldest first."""
    from api import storemap
    me = storemap.contributor()
    out = []
    try:
        maps = storemap._all()
    except Exception:
        return []
    for doc in maps.values():
        real = [s for s in (doc.get("segments") or {}).values()
                if s.get("created_by") != storemap.SOURCE_BASELINE]
        if not real:
            continue
        first = min(real, key=lambda s: s.get("created_at") or "")
        if first.get("created_by") == me and first.get("captures"):
            out.append((first.get("created_at") or "", doc.get("store") or doc.get("key")))
    return [name for _at, name in sorted(out)]


# --- community chapters --------------------------------------------------------

def _chapter_stores():
    names, seen = [], set()
    from api import storemap

    def add(name):
        key = storemap.store_key(name)
        if name and key and key not in seen:
            seen.add(key)
            names.append(name)
    try:
        from api import stores
        for row in stores.mine():
            add(row.get("name"))
    except Exception:
        pass
    try:
        for sess in quest._store()["sessions"]:
            if not sess.get("placeholder"):
                add(sess.get("store"))
    except Exception:
        pass
    return names[:CHAPTERS_MAX]


def chapters():
    """One chapter card per store the shopper knows: how much of it
    the community has mapped. Derived on read."""
    from api import storemap
    me = storemap.contributor()
    out = []
    for name in _chapter_stores():
        try:
            doc = storemap.load_map(name)
            _counts, total, pct = storemap._coverage(doc)
        except Exception:
            continue
        helped = any(c.get("by") == me
                     for seg in doc["segments"].values()
                     for c in seg.get("captures", []))
        earned = total > 0 and pct >= 100 and helped
        out.append({"store": name, "pct": pct, "earned": earned,
                    "text": (CHAPTER_DONE if earned else CHAPTER_TEXT).format(
                        store=name, pct=pct)})
    return out
