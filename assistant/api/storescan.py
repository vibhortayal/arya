"""Guided store scan: Map my store by panning the phone (owner,
2026-10-29: "user should not be made to click pictures, user just
keeps panning the camera"; "capture store signage, aisle numbers,
prices"; "ignoring humans").

The phone grades every frame itself (sharp, steady, light) and sends
one sharp frame about every four seconds while the shopper pans. Each
frame here:

1. People first. SAM 3.1 finds people and they are pixelated before
   anything else sees the frame. If the scrub cannot run, nothing is
   read or kept. If people cover most of the frame, the frame is not
   read or kept either: the phone shows "Waiting for a clear view".
2. One Spark read of the scrubbed frame: the section, the aisle sign,
   the products, and (only when the shopper opted in) shelf prices.
3. SAM 3.1 outlines on the scrubbed frame: shelves, and aisle signs
   when the read found one. The phone draws only these, so every
   outline is something Arya really found; people are never outlined.

The frame then lands on the store map exactly like a teach capture.
Prices are the shopper's own data (owner rule: prices only from the
user's own captures or receipts, never scraped): kept per account,
only when the read is sure and names the item, labelled as read from
a shelf tag.

A per-account daily frame cap bounds the spend (ARYA_SCAN_DAILY_FRAMES,
default 120: about ten 45-second walks).
"""
import base64, io, json, os, re
from datetime import date

from api import state

PEOPLE_PAUSE_SHARE = 0.35     # people cover this much: pause, keep nothing
DAILY_FRAMES = 120
LOG_FILE = "scan_log.json"
PRICES_FILE = "shelf_prices.json"
MAX_PRICES = 500

_SYSTEM = """You look at one photo of a grocery store shelf or aisle, taken by a shopper who is mapping the store. People in it are already blurred; ignore them.

Answer with ONLY a JSON object, no other text:
{"label": "<section name>", "sign": "<aisle sign text>", "items": ["<product>", "..."], "prices": [{"item": "<product>", "price": 3.49, "sure": true}]}

Rules:
- "label": if an aisle sign is readable, use it, like "Aisle 4". Otherwise name the section for what is shelved, like "Frozen", "Dairy wall", "Pasta and sauces". At most 40 characters.
- "sign": the exact text of a hanging aisle sign or section sign you can read, like "Aisle 4 Dairy Eggs"; "" when there is none.
- "items": up to 8 products or categories clearly visible. Skip anything you cannot read.
- "prices": %s
If the photo shows no shelf or aisle (a floor, a cart, a checkout), answer {"label": "", "sign": "", "items": [], "prices": []}."""

_PRICES_ON = ("shelf price tags you can read clearly, each with the product the tag "
              "names. \"sure\" is true only when both the price and the product on "
              "the tag are clearly readable. Never guess a price. Up to 6.")
_PRICES_OFF = "always []."


def prompt(prices):
    return _SYSTEM % (_PRICES_ON if prices else _PRICES_OFF)


def _text(raw, n):
    return re.sub(r"\s+", " ", str(raw or "")).strip().strip('"').strip()[:n]


def parse_read(text, prices=False):
    """The model's answer, defensively. Raises ValueError when there
    is no JSON object at all. Prices that are not sure, not a real
    amount, or not tied to a product are dropped (accuracy honesty:
    a low-confidence read is never saved)."""
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        raise ValueError("the scan read came back unreadable")
    try:
        data = json.loads(m.group(0))
    except ValueError:
        raise ValueError("the scan read came back unreadable")
    if not isinstance(data, dict):
        raise ValueError("the scan read came back unreadable")
    items = []
    for it in data.get("items") if isinstance(data.get("items"), list) else []:
        name = _text(it, 60)
        if name and name.lower() not in {x.lower() for x in items}:
            items.append(name)
        if len(items) == 8:
            break
    kept = []
    for p in (data.get("prices") if prices and isinstance(data.get("prices"), list) else []):
        if not isinstance(p, dict) or p.get("sure") is not True:
            continue
        item = _text(p.get("item"), 60)
        try:
            amount = round(float(p.get("price")), 2)
        except (TypeError, ValueError):
            continue
        if item and 0.05 <= amount <= 500:
            kept.append({"item": item, "price": amount})
        if len(kept) == 6:
            break
    return {"label": _text(data.get("label"), 60), "sign": _text(data.get("sign"), 60),
            "items": items, "prices": kept}


def read_frame(client, jpeg, prices=False):
    """One Spark read of a SCRUBBED frame (never a raw one)."""
    uri = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
    messages = [
        {"role": "system", "content": prompt(prices)},
        {"role": "user", "content": [
            {"type": "text", "text": "Read this shelf photo."},
            {"type": "image_url", "image_url": {"url": uri}}]}]
    text, _usage, _cost = client.chat(messages, mode="standard")
    return parse_read(text, prices)


def norm_boxes(boxes, W, H, cap=12):
    """SAM boxes as fractions of the frame, for the phone's overlay."""
    out = []
    for b in boxes or []:
        x1, y1, x2, y2 = (b["box"] if isinstance(b, dict) else b)
        if W <= 0 or H <= 0 or x2 <= x1 or y2 <= y1:
            continue
        out.append([round(max(0.0, x1 / W), 4), round(max(0.0, y1 / H), 4),
                    round(min(1.0, x2 / W), 4), round(min(1.0, y2 / H), 4)])
        if len(out) == cap:
            break
    return out


def daily_cap():
    from api import settings   # Ops value, then ARYA_SCAN_DAILY_FRAMES
    return settings.get("scan_daily_frames")


def frames_left(today=None):
    log = state._load(LOG_FILE, {})
    return max(0, daily_cap() - int(log.get(today or date.today().isoformat(), 0)))


def count_frame(today=None):
    day = today or date.today().isoformat()
    log = state._load(LOG_FILE, {})
    log = {day: int(log.get(day, 0)) + 1}      # only today matters
    state._save(LOG_FILE, log)
    return max(0, daily_cap() - log[day])


def save_prices(store, rows, at=None):
    """The shopper's own shelf-tag prices (opt-in), newest last."""
    if not rows:
        return []
    d = state._load(PRICES_FILE, {"prices": []})
    when = at or date.today().isoformat()
    new = [{"item": r["item"], "price": r["price"], "store": store, "date": when,
            "source": "shelf tag"} for r in rows]
    d["prices"] = (d.get("prices") or [])[-(MAX_PRICES - len(new)):] + new
    state._save(PRICES_FILE, d)
    return new


class ScrubFailed(RuntimeError):
    """The people scrub could not run, so nothing may be read or kept."""


def read_and_keep(name, body, client, media="image/jpeg", prices=False,
                  outlines=True):
    """One frame, start to finish, in the privacy order: people are
    scrubbed first (ScrubFailed when that cannot run), a frame mostly
    of people is paused, the scrubbed frame is read, and a frame with a
    shelf lands on the store map like a teach capture. Shared by the
    live scan route and the background scan jobs (api/scanjobs.py);
    outlines=False skips the aisle-sign outline, which only the live
    overlay draws. Raises ValueError when the map refuses the frame."""
    from api import shelfscan, storemap
    jpeg, people, share = shelfscan.scrub_people_boxes(body, client,
                                                       media_type=media)
    if jpeg is None:
        raise ScrubFailed("could not blur people out of the photo")
    if share >= PEOPLE_PAUSE_SHARE:
        return {"paused": "people", "kept": False}
    try:
        read = read_frame(client, jpeg, prices)
    except ValueError:
        read = {"label": "", "sign": "", "items": [], "prices": []}
    if not read["label"]:
        return {"kept": False, "label": ""}
    from PIL import Image
    W, H = Image.open(io.BytesIO(jpeg)).size
    shelves, signs, fill = [], [], None
    try:
        shelves, _u, _c = client.segment(jpeg, "grocery shelf",
                                         media_type="image/jpeg")
        if shelves:
            fill = min(1.0, sum((b["box"][2] - b["box"][0]) * (b["box"][3] - b["box"][1])
                                for b in shelves) / float(W * H))
    except Exception:
        shelves = []
    if outlines and read["sign"]:
        try:
            signs, _u, _c = client.segment(jpeg, "aisle sign",
                                           media_type="image/jpeg")
        except Exception:
            signs = []
    seg, created = storemap.add_segment(name, read["label"], "both")
    out = storemap.ingest(name, seg["id"], jpeg, kind="walk",
                          shelf_fill=fill, people=len(people))
    for seen in read["items"]:
        storemap.note_sighting(name, seen, read["label"])
    # An aisle number on a sign tells Arya how big the store is.
    storemap.note_sign(name, read["sign"])
    kept_prices = save_prices(name, read["prices"]) if prices else []
    out.update({"kept": True, "label": seg["label"], "segment": seg["id"],
                "created": created, "sign": read["sign"], "items": read["items"],
                "prices": [{"item": p["item"], "price": p["price"]} for p in kept_prices],
                "people": len(people),
                "boxes": {"shelf": norm_boxes(shelves, W, H),
                          "sign": norm_boxes(signs, W, H, cap=3)}})
    out["reward"] = storemap.award(name, out)
    return out
