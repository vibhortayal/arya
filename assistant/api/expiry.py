"""Expiry dates — the user photographs the date on a package, Muse
reads it, the user confirms, Arya tracks it (owner, 2026-10-29;
wireframe approved the same day).

One Spark vision read (Standard, personal) returns the printed date;
everything after that is deterministic code at $0: date checks, the
match to a known item, and the "use soon" window. A date lives in the
item's flag record (use_by, use_by_kind, use_by_set, use_by_snooze), so
there is no migration and it works in both store modes. The photo is
never kept.

Rules the wireframe fixed: nothing is saved until the user confirms;
a past date is neutral ("your call") and fades a week later; a new
receipt for the item means a new package, so the old date drops.
"""
import base64, json, os, re
from datetime import date, timedelta

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "prompts",
                           "expiry_photo_v1.md")
KINDS = ("use_by", "best_by", "expires", "packed", "unknown")
AHEAD_DAYS = 7          # "use soon" looks this far ahead
FADE_DAYS = 7           # a past date stays this long, then fades
SNOOZE_DAYS = 2
MIN_CONFIDENCE = 0.5
FLAG_FIELDS = ("use_by", "use_by_kind", "use_by_set", "use_by_snooze")

_UNITS = {"oz", "lb", "lbs", "gal", "ct", "pk", "pack", "ml", "l", "g", "kg",
          "fl", "qt", "pt", "dz", "of"}


def load_prompt():
    return open(PROMPT_PATH).read().split("SYSTEM:", 1)[1].strip()


def parse_iso(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def sane_date(d, today):
    """A printed date worth tracking: not long past, not absurdly far."""
    return d is not None and today - timedelta(days=365) <= d <= today + timedelta(days=365 * 5)


def read_expiry_photo(image_bytes, client, media_type="image/jpeg", today=None):
    """Photo -> {readable, name, date, kind, confidence, raw}.
    Personal data: Standard mode only (enforced in meta_client)."""
    today = today or date.today()
    data_uri = f"data:{media_type};base64," + base64.b64encode(image_bytes).decode()
    messages = [{"role": "system", "content": load_prompt()},
                {"role": "user", "content": [
                    {"type": "text", "text": "Read the date on this package."},
                    {"type": "image_url", "image_url": {"url": data_uri}}]}]
    out, _usage, _cost = client.chat(messages, mode="standard", personal=True)
    try:
        dec = json.loads(out)
    except Exception:
        try:
            dec = json.loads(out[out.find("{"): out.rfind("}") + 1])
        except Exception:
            dec = {}
    return normalize_read(dec, today)


def normalize_read(dec, today):
    kind = dec.get("kind") if dec.get("kind") in KINDS else "unknown"
    d = parse_iso(dec.get("date"))
    try:
        conf = max(0.0, min(1.0, float(dec.get("confidence") or 0)))
    except (TypeError, ValueError):
        conf = 0.0
    name = " ".join(str(dec.get("product") or "").split())[:80] or None
    readable = bool(d and kind != "packed" and conf >= MIN_CONFIDENCE
                    and sane_date(d, today))
    return {"readable": readable, "name": name,
            "date": d.isoformat() if readable else None,
            "kind": kind, "confidence": conf,
            "raw": str(dec.get("raw") or "")[:40]}


# --- matching a read product to a known item -----------------------------

def _tokens(s):
    toks = re.findall(r"[a-z]+", (s or "").lower())
    out = set()
    for t in toks:
        if t in _UNITS or len(t) < 2:
            continue
        out.add(t[:-1] if t.endswith("s") and len(t) > 3 else t)
    return out


def match_item(name, entries, flags):
    """The known item a read product name is, or None. Exact first (the
    list's own add rule), then a token match where both names share
    most of their words: "Whole Milk 1 gal" is "Whole Milk", but
    "milk" is never "almond milk"."""
    from api.list.intake import existing_item_id
    if not name:
        return None
    known = existing_item_id(name, entries, flags)
    if known:
        return known
    want = _tokens(name)
    if not want:
        return None
    best, best_score = None, 0.0
    cands = [(e["item_id"], e.get("canonical_name")) for e in entries]
    cands += [(i, f.get("name")) for i, f in flags.items() if f.get("name")]
    for item_id, cname in cands:
        have = _tokens(cname)
        if not have:
            continue
        score = len(want & have) / len(want | have)
        if score > best_score:
            best, best_score = item_id, score
    return best if best_score >= 0.6 else None


# --- the flag record ------------------------------------------------------

def track_fields(d, kind, today):
    return {"use_by": d.isoformat(),
            "use_by_kind": kind if kind in KINDS else "unknown",
            "use_by_set": today.isoformat(), "use_by_snooze": None}


def untrack_fields():
    return {k: None for k in FLAG_FIELDS}


def tracked(flag):
    return bool(flag and flag.get("use_by"))


# --- the use-soon list ----------------------------------------------------

def use_soon(flags, names, last_bought, today):
    """Items whose date is within AHEAD_DAYS (or up to FADE_DAYS past),
    soonest first. A snoozed item waits; an item bought again since the
    date was set is a new package, so its old date is not shown."""
    out = []
    for item_id, f in flags.items():
        d = parse_iso(f.get("use_by"))
        if d is None:
            continue
        days = (d - today).days
        if days > AHEAD_DAYS or days < -FADE_DAYS:
            continue
        snz = parse_iso(f.get("use_by_snooze"))
        if snz and snz >= today:
            continue
        lb, set_on = parse_iso(last_bought.get(item_id)), parse_iso(f.get("use_by_set"))
        if lb and set_on and lb > set_on:
            continue
        out.append({"item_id": item_id,
                    "name": f.get("name") or names.get(item_id) or item_id,
                    "date": d.isoformat(), "kind": f.get("use_by_kind") or "unknown",
                    "days": days})
    out.sort(key=lambda r: (r["days"], r["name"]))
    return out


# --- after a receipt: which of it can expire or go bad (#207) -------------
# Owner 2026-10-30: after a receipt, Today names what was bought that
# usually expires or goes bad and asks for dates in one sheet. Guessing is $0: the
# character categories (api/haul.py, used for trip names) mark fruit,
# vegetables, dairy and bakery; a short word list adds meat, fish, eggs,
# cheese and bread. No model call.

PERISHABLE_CATS = {"fruit", "vegetable", "dairy", "bakery"}
PERISHABLE_WORDS = {"chicken", "beef", "pork", "turkey", "lamb", "steak",
                    "sausage", "sausages", "bacon", "ham", "salami", "fish",
                    "salmon", "shrimp", "cod", "tilapia", "egg", "eggs",
                    "cheese", "hummus", "bread", "loaf", "sourdough", "salsa",
                    "guacamole", "banana", "bananas", "raspberry", "raspberries",
                    "blueberry", "blueberries", "meat", "tortellini", "ravioli"}
NOT_PERISHABLE = {"dried", "canned", "powder", "peanut", "almond"}
NUDGE_DAYS = 14         # a receipt older than this is not asked about
NUDGE_MAX_ITEMS = 8
NUDGE_MIN_ITEMS = 2
NUDGE_STOP_AFTER = 2    # two "Not now"s and it stops for good


def perishable(name):
    from api import haul, state
    words = set(state._norm_name(name).split())
    if words & NOT_PERISHABLE:
        return False
    cat = haul._category(name)
    if cat:
        return cat in PERISHABLE_CATS
    return bool(words & PERISHABLE_WORDS)


def receipt_nudge(receipts, flags, seen, today):
    """The newest receipt from the last NUDGE_DAYS, bought after `seen`
    (an ISO date: the receipt last answered), that holds at least
    NUDGE_MIN_ITEMS perishables without a date set since that trip.
    Returns {receipt_id, store, date, items: [{item_id, name}]} or None."""
    seen_d = parse_iso(seen) if seen else None
    rows = []
    for r in receipts or []:
        d = parse_iso(str(r.get("purchased_at") or "")[:10])
        if d is None or (today - d).days > NUDGE_DAYS or d > today:
            continue
        if seen_d and d <= seen_d:
            continue
        if r.get("source_type") not in (None, "grocery"):
            continue
        rows.append((d, r))
    rows.sort(key=lambda x: x[0], reverse=True)
    for d, r in rows:
        items, ids = [], set()
        for ln in r.get("lines") or []:
            if ln.get("line_type") not in (None, "item"):
                continue
            iid, name = ln.get("item_id"), ln.get("decoded_name") or ln.get("raw")
            if not iid or not name or iid in ids or not perishable(name):
                continue
            f = flags.get(iid) or {}
            set_on = parse_iso(f.get("use_by_set"))
            if tracked(f) and set_on and set_on >= d:
                continue  # already dated since this trip
            ids.add(iid)
            items.append({"item_id": iid, "name": f.get("name") or name})
            if len(items) >= NUDGE_MAX_ITEMS:
                break
        if len(items) >= NUDGE_MIN_ITEMS:
            return {"receipt_id": r.get("receipt_id"), "store": r.get("merchant") or "",
                    "date": d.isoformat(), "items": items}
    return None
