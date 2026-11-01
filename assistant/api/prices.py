"""Prices — what the household's own receipts say about prices
(owner, 2026-10-29; price-intelligence wireframe approved the same day).

Every number here comes from the household's own receipts. Nothing is
fetched from a store, a flyer, an API or the web, and no model guesses a
price (owner: "no api or web scraping for deals"). Prices from other
households come later, and only from households that opt in. This
module is deterministic code at $0.

  item_prices(item_id, d)    per-store prices, the cheaper store, the trend
  basket_change(d)           the household's own inflation
  split_smarter(d, names)    which store to buy what at, and the saving
  food_waste(flags, d, ...)  what was marked expired this month, in dollars
  similar_items(item_id, ..) other items the household bought of the same kind
  insights(...)              the three Analysis cards in one payload

A price is a UNIT price: the ledger price is the net line total
(discounts folded in), so the unit price is price / qty. Rules that
keep a number honest: a store needs a real gap (TREND_MIN_PCT,
GAP_MIN) to count as cheaper; a trend needs MIN_BUYS buys over
MIN_SPAN_DAYS; anything thinner shows nothing.
"""
import re
import statistics
from datetime import date, timedelta

MIN_BUYS = 3             # buys at one store before a trend shows
MIN_SPAN_DAYS = 28       # first to last buy, for a trend
TREND_MIN_PCT = 2.0      # smaller moves read as "steady" and are not shown
GAP_MIN = 0.25           # dollars per unit before a store counts as cheaper
GAP_MIN_PCT = 5.0
CHEAPER_MAX_AGE_DAYS = 365  # the other store's price may not be older than this
BASKET_MIN_ITEMS = 3
SIMILAR_CAP = 3
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]


def unit_price(e):
    try:
        price, qty = float(e.get("price") or 0), float(e.get("qty") or 0)
    except (TypeError, ValueError):
        return None
    if price <= 0 or qty <= 0:
        return None
    return price / qty


def _buys(d, item_id=None):
    """Household purchases with a usable unit price, oldest first.
    Things bought for someone else (a gift card) are not household
    prices and stay out."""
    out = []
    for e in d["entries"]:
        if e.get("event_type") != "purchase" or not e.get("store_id"):
            continue
        if e.get("allocation") == "FOR-OTHERS":
            continue
        if item_id is not None and e["item_id"] != item_id:
            continue
        u = unit_price(e)
        if u is not None:
            out.append({**e, "unit": u})
    return sorted(out, key=lambda e: e["date"])


def _d(s):
    return date.fromisoformat(str(s)[:10])


def _r(x):
    return round(x, 2)


def _pct(a, b):
    return round((b - a) / a * 100, 1) if a else 0.0


def _month_word(iso):
    return MONTHS[int(iso[5:7]) - 1]


def chain_of(store):
    """The chain a store label belongs to: its first word, so "COSTCO
    SUNNYVALE", "Costco - NEWARK" and "Costco Wholesale #778 Fremont"
    are one chain. Two warehouses of one chain share prices, so
    that is not a deal."""
    m = re.search(r"[a-z0-9]+", str(store or "").lower().replace("'", ""))
    return m.group(0) if m else ""


def _by_store(rows):
    by = {}
    for e in rows:
        by.setdefault(e["store_id"], []).append(e)
    return by


def _trend(rows):
    """The move in one store's price, first buy to latest buy."""
    if len(rows) < MIN_BUYS:
        return None
    first, last = rows[0], rows[-1]
    if (_d(last["date"]) - _d(first["date"])).days < MIN_SPAN_DAYS:
        return None
    pct = _pct(first["unit"], last["unit"])
    if abs(pct) < TREND_MIN_PCT:
        return None
    return {"pct": pct, "from_price": _r(first["unit"]), "to_price": _r(last["unit"]),
            "since": first["date"], "since_month": _month_word(first["date"]),
            "store": last["store_id"], "buys": len(rows)}


def _usual(by):
    """The store an item is bought at most often (latest breaks ties)."""
    return max(by, key=lambda s: (len(by[s]), by[s][-1]["date"]))


def item_prices(item_id, d, at=None):
    """{stores, cheaper, trend} for one item. stores: per store the
    latest unit price, its date, the median and the count. cheaper:
    the store with the lowest latest price, against `at` (the store
    the user is looking at) when it has a price, else the store the
    item is usually bought at, when the gap is real. trend: at the
    usual store."""
    rows = _buys(d, item_id)
    by = _by_store(rows)
    stores = {s: {"last": _r(v[-1]["unit"]), "last_date": v[-1]["date"],
                  "median": _r(statistics.median(x["unit"] for x in v)),
                  "count": len(v)} for s, v in by.items()}
    cheaper = None
    if len(stores) >= 2 and rows:
        usual = at if at in stores else _usual(by)
        # Only another chain, and a price seen within a year of the
        # one it is compared with, can be a deal.
        others = [s for s in stores if chain_of(s) != chain_of(usual)
                  and (_d(stores[usual]["last_date"]) - _d(stores[s]["last_date"])).days <= CHEAPER_MAX_AGE_DAYS]
        lo = min(others, key=lambda s: stores[s]["last"]) if others else usual
        a, b = stores[usual]["last"], stores[lo]["last"]
        if lo != usual and a - b >= GAP_MIN and _pct(b, a) >= GAP_MIN_PCT:
            cheaper = {"store": lo, "price": b, "date": stores[lo]["last_date"],
                       "vs_store": usual, "vs_price": a,
                       "save_pct": round((a - b) / a * 100)}
    trend = None
    if by:
        trend = _trend(by[_usual(by)])
    return {"item_id": item_id, "stores": stores, "cheaper": cheaper, "trend": trend}


def _label(names, iid):
    """A readable item name, never a raw id like costco-96716."""
    n = names.get(iid)
    return n if n and n != iid else "an item"


def _window(rows, lo, hi):
    return [e for e in rows if lo <= _d(e["date"]) < hi]


def basket_change(d, names=None, today=None):
    """The household's own inflation: the same items, then and now.
    Then = buys 60 to 120 days before the latest receipt; now = the
    last 30 days. Each item counts once (its median unit price in each
    window), so a big shop does not swing the number. About-a-month
    dollars weigh each item by how often it was bought lately."""
    names = names or {}
    rows = _buys(d)
    if not rows:
        return None
    end = _d(today) if today else _d(rows[-1]["date"])
    now_lo, then_lo, then_hi = end - timedelta(days=30), end - timedelta(days=120), end - timedelta(days=60)
    recent90 = _window(rows, end - timedelta(days=90), end + timedelta(days=1))
    items = []
    for iid in sorted({e["item_id"] for e in rows}):
        mine = [e for e in rows if e["item_id"] == iid]
        then = [e["unit"] for e in _window(mine, then_lo, then_hi)]
        now = [e["unit"] for e in _window(mine, now_lo, end + timedelta(days=1))]
        if not then or not now:
            continue
        a, b = statistics.median(then), statistics.median(now)
        per_month = sum(float(e.get("qty") or 1) for e in recent90 if e["item_id"] == iid) / 3
        items.append({"item_id": iid, "name": _label(names, iid), "then": _r(a), "now": _r(b),
                      "pct": _pct(a, b), "month_dollars": (b - a) * per_month})
    if len(items) < BASKET_MIN_ITEMS:
        return None
    then_sum, now_sum = sum(i["then"] for i in items), sum(i["now"] for i in items)
    movers = sorted((i for i in items if abs(i["pct"]) >= TREND_MIN_PCT),
                    key=lambda i: -abs(i["pct"]))[:3]
    for i in items:
        i["month_dollars"] = _r(i["month_dollars"])
    return {"pct": _pct(then_sum, now_sum), "items": len(items),
            "since_month": _month_word(then_lo.isoformat()),
            "month_dollars": _r(sum(i["month_dollars"] for i in items)),
            "movers": [{k: m[k] for k in ("item_id", "name", "pct", "then", "now")} for m in movers]}


def split_smarter(d, names=None, today=None):
    """Where each item is cheaper, from the household's own receipts
    in the last 180 days, and what moving it would save a month. An
    item counts when it was bought at 2+ stores and the gap is real."""
    names = names or {}
    rows = _buys(d)
    if not rows:
        return None
    end = _d(today) if today else _d(rows[-1]["date"])
    rows = _window(rows, end - timedelta(days=180), end + timedelta(days=1))
    recent90 = _window(rows, end - timedelta(days=90), end + timedelta(days=1))
    moves = []
    for iid in sorted({e["item_id"] for e in rows}):
        mine = [e for e in rows if e["item_id"] == iid]
        by = _by_store(mine)
        if len(by) < 2:
            continue
        med = {s: statistics.median(x["unit"] for x in v) for s, v in by.items()}
        usual = _usual(by)
        rivals = [s for s in med if chain_of(s) != chain_of(usual)]
        if not rivals:
            continue
        lo = min(rivals, key=med.get)
        gap = med[usual] - med[lo]
        if lo == usual or gap < GAP_MIN or _pct(med[lo], med[usual]) < GAP_MIN_PCT:
            continue
        per_month = sum(float(e.get("qty") or 1) for e in recent90 if e["item_id"] == iid) / 3
        if per_month <= 0:
            continue
        moves.append({"item_id": iid, "name": _label(names, iid), "from": usual, "to": lo,
                      "from_price": _r(med[usual]), "to_price": _r(med[lo]),
                      "month_dollars": _r(gap * per_month)})
    total = _r(sum(m["month_dollars"] for m in moves))
    if total < 1:
        return None
    moves.sort(key=lambda m: -m["month_dollars"])
    return {"month_dollars": total, "moves": moves}


def food_waste(flags, d, names=None, today=None):
    """What the household marked expired this calendar month, priced at
    the latest unit price paid. An item with no price counts as an item
    but adds no dollars."""
    names = names or {}
    today = _d(today) if today else date.today()
    month = today.isoformat()[:7]
    rows = _buys(d)
    last = {}
    for e in rows:
        last[e["item_id"]] = e["unit"]
    items = []
    for iid, f in (flags or {}).items():
        ex = (f or {}).get("expired")
        if isinstance(ex, str) and ex[:7] == month:
            items.append({"item_id": iid, "name": names.get(iid) or (f or {}).get("name") or iid,
                          "dollars": _r(last.get(iid, 0.0))})
    if not items:
        return None
    items.sort(key=lambda i: -i["dollars"])
    return {"dollars": _r(sum(i["dollars"] for i in items)), "items": items,
            "month": _month_word(today.isoformat())}


_SIZE = re.compile(r"(\d+(?:\.\d+)?)\s*(gal|oz|fl oz|lb|lbs|ct|pk|l|ml|kg|g)\b", re.I)
_TO_BASE = {"gal": ("oz", 128.0), "oz": ("oz", 1.0), "fl oz": ("oz", 1.0), "lb": ("oz", 16.0),
            "lbs": ("oz", 16.0), "l": ("oz", 33.814), "ml": ("oz", 0.033814),
            "kg": ("oz", 35.274), "g": ("oz", 0.035274), "ct": ("each", 1.0), "pk": ("each", 1.0)}
_NOT_HEAD = {"gal", "oz", "fl", "lb", "lbs", "ct", "pk", "l", "ml", "kg", "g", "pack", "of",
             "organic", "large", "small", "fresh"}


def size_of(name):
    """(base unit, amount) from a product name: "Whole Milk 1 gal" ->
    ("oz", 128.0). None when the name carries no size."""
    m = _SIZE.search(name or "")
    if not m:
        return None
    unit, mult = _TO_BASE[m.group(2).lower()]
    return unit, float(m.group(1)) * mult


def head_word(name):
    """The kind of thing a name is: its last real word ("Whole Milk
    1 gal" -> "milk", "Pasture Eggs 12 ct" -> "eggs")."""
    words = [w for w in re.findall(r"[a-z]+", (name or "").lower()) if w not in _NOT_HEAD and len(w) > 2]
    if not words:
        return None
    w = words[-1]
    return w[:-1] if w.endswith("s") and not w.endswith("ss") else w


def similar_items(item_id, d, names):
    """Other items the household bought that are the same kind of thing
    (same head word), with the latest price, store and date. When both
    names carry a size, the price per oz (or each) makes them
    comparable. Only the household's own receipts: no outside prices."""
    me = head_word(names.get(item_id, ""))
    if not me:
        return []
    mine = size_of(names.get(item_id, ""))
    rows = _buys(d)
    last = {}
    for e in rows:
        last[e["item_id"]] = e
    out = []
    for iid, e in last.items():
        if iid == item_id or head_word(names.get(iid, "")) != me:
            continue
        row = {"item_id": iid, "name": _label(names, iid), "price": _r(e["unit"]),
               "store": e["store_id"], "date": e["date"]}
        theirs = size_of(row["name"])
        if mine and theirs and mine[0] == theirs[0] and theirs[1] > 0:
            row["per"] = theirs[0]
            row["per_price"] = round(e["unit"] / theirs[1], 3)
        out.append(row)
    out.sort(key=lambda r: r.get("per_price", r["price"]))
    return out[:SIMILAR_CAP]


def insights(d, flags, names, today=None):
    return {"basket": basket_change(d, names),
            "split": split_smarter(d, names),
            "waste": food_waste(flags, d, names, today)}


def ask_facts(d, names, cap=40, first=()):
    """Price facts for Ask Arya: per item, the latest price at each
    store, the cheaper store and the trend, already worked out, so the
    model reads numbers and never computes them. Items in `first` (the
    ones on a list) come before the most recently bought, so "where is
    my list cheapest?" has the list's own prices."""
    out = {}
    seen = []
    bought = set()
    for e in reversed(_buys(d)):
        bought.add(e["item_id"])
        if e["item_id"] not in seen:
            seen.append(e["item_id"])
    lead = [i for i in dict.fromkeys(first or ()) if i in bought]
    seen = lead + [i for i in seen if i not in lead]
    for iid in seen[:cap]:
        p = item_prices(iid, d)
        out[_label(names, iid)] = {
            "stores": {s: {"price": v["last"], "date": v["last_date"]} for s, v in p["stores"].items()},
            "cheaper": p["cheaper"], "trend": p["trend"]}
    return out
