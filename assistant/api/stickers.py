"""Stickers — one real product sticker per product the shopper grabs
(Game: album).

A grab mints a sticker server-side. When Find it for me just saw the
item, the sticker is a die-cut cutout of the product, made from the
frame the app already kept for the store map: the SAM box, a local
GrabCut pass, a white die-cut border. That is $0 extra and NO new
model call; this module never imports meta_client. With no usable
frame the sticker wears stock character art instead.

Truth rules:
- The frame is the people-scrubbed copy quest.keep_frame stored. A
  cutout is made only from a fresh frame (600 s), with no people in
  it, a product-grade box (not a whole-shelf region) and a box under
  35% of the frame. Anything else falls back to art. Fail closed.
- Only the cutout is kept. The source frame is never copied here.
- Prices never reach a sticker.
- A sticker is private to the account (per-user store and media).

Store: stickers.json (state._load/_save, so the demo sandbox keeps it
in the overlay) and <data_dir>/sticker-media/<id>.webp. Page badges
are recorded once and never un-earn.
"""
import base64
import io
import os
import tempfile
from datetime import datetime

from api import aisles, quest, state

FILE = "stickers.json"
MEDIA_DIR = "sticker-media"
CAP = 2000
SANDBOX_INLINE_MAX = 12      # inline cutouts in the demo overlay
FRESH_SECONDS = 600          # a frame older than this makes no cutout
MAX_BOX_FRAC = 0.35          # a box over this share of the frame is a shelf
MIN_CROP = 40                # px; a smaller crop is too small to cut
PAD_FRAC = 0.03
WORK_SIDE = 256              # GrabCut works on this size
FINAL_SIDE = 240             # the sticker's longest side, border included
BORDER = 3                   # white die-cut border, px
MAX_BYTES = 60 * 1024
COVER_MIN, COVER_MAX = 0.25, 0.97
SOURCES = ("grab", "scan", "manual", "backfill")


# --- storage -----------------------------------------------------------------

def _empty():
    return {"stickers": [], "badges": {}}


def _load():
    data = state._load(FILE, None)
    if not isinstance(data, dict):
        data = _empty()
    data.setdefault("stickers", [])
    data.setdefault("badges", {})
    return data


def _save(data):
    state._save(FILE, data)


def _media_dir():
    return os.path.join(state.data_dir(), MEDIA_DIR)


def _media_path(sticker_id):
    if not sticker_id or os.path.basename(sticker_id) != sticker_id:
        return None
    return os.path.join(_media_dir(), sticker_id + ".webp")


def _write_media(rec, webp):
    """Keep the cutout bytes: inline in the demo overlay (never on
    disk), else a file under sticker-media/."""
    if state.in_sandbox():
        rec["media"] = "inline"
        rec["media_b64"] = base64.b64encode(webp).decode()
        return
    p = _media_path(rec["id"])
    os.makedirs(os.path.dirname(p), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p), prefix=".tmp-", suffix=".webp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(webp)
        os.replace(tmp, p)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    rec["media"] = rec["id"] + ".webp"
    rec.pop("media_b64", None)


def _delete_media(rec):
    rec.pop("media_b64", None)
    if state.in_sandbox():
        return
    p = _media_path(rec.get("id"))
    if p and os.path.exists(p):
        try:
            os.unlink(p)
        except OSError:
            pass


def media_bytes(sticker_id):
    """The cutout's bytes, or None (art-only, unknown id, or an id
    that tries to leave the media folder)."""
    if not sticker_id or os.path.basename(sticker_id) != sticker_id:
        return None
    for rec in _load()["stickers"]:
        if rec["id"] != sticker_id or rec.get("image") != "cutout":
            continue
        if rec.get("media_b64"):
            try:
                return base64.b64decode(rec["media_b64"])
            except Exception:
                return None
        p = _media_path(sticker_id)
        if p and os.path.exists(p):
            with open(p, "rb") as fh:
                return fh.read()
        return None
    return None


def _inline_count(data):
    return sum(1 for r in data["stickers"] if r.get("media_b64"))


# --- the cutout --------------------------------------------------------------

def cut_product(jpeg_bytes, box_norm, grade=None):
    """A die-cut product sticker (WebP with alpha, longest side 240,
    under 60 KB) from a frame and a normalised SAM box, or None.
    None means "use the art": the crop is under 40 px, the box is over
    35% of the frame, the bytes do not decode, or anything fails."""
    try:
        import cv2
        import numpy as np
        from PIL import Image

        x1, y1, x2, y2 = [min(1.0, max(0.0, float(v))) for v in box_norm]
        if x2 <= x1 or y2 <= y1:
            return None
        if (x2 - x1) * (y2 - y1) > MAX_BOX_FRAC:
            return None
        img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
        W, H = img.size
        bx1, by1, bx2, by2 = x1 * W, y1 * H, x2 * W, y2 * H
        px, py = (bx2 - bx1) * PAD_FRAC, (by2 - by1) * PAD_FRAC
        cx1, cy1 = max(0, int(bx1 - px)), max(0, int(by1 - py))
        cx2, cy2 = min(W, int(bx2 + px + 0.999)), min(H, int(by2 + py + 0.999))
        if cx2 - cx1 < MIN_CROP or cy2 - cy1 < MIN_CROP:
            return None
        crop = img.crop((cx1, cy1, cx2, cy2))
        scale = min(1.0, WORK_SIDE / float(max(crop.size)))
        if scale < 1.0:
            crop = crop.resize((max(1, round(crop.width * scale)),
                                max(1, round(crop.height * scale))),
                               Image.LANCZOS)
        w, h = crop.size
        rgb = np.ascontiguousarray(np.asarray(crop, dtype=np.uint8))
        # The product box inside the padded crop, on the work scale.
        rx1 = max(1, int(round((bx1 - cx1) * scale)))
        ry1 = max(1, int(round((by1 - cy1) * scale)))
        rx2 = min(w - 1, int(round((bx2 - cx1) * scale)))
        ry2 = min(h - 1, int(round((by2 - cy1) * scale)))
        if rx2 - rx1 < 4 or ry2 - ry1 < 4:
            return None

        mask = np.zeros((h, w), np.uint8)
        bgd = np.zeros((1, 65), np.float64)
        fgd = np.zeros((1, 65), np.float64)
        bgr = np.ascontiguousarray(rgb[:, :, ::-1])
        cv2.grabCut(bgr, mask, (rx1, ry1, rx2 - rx1, ry2 - ry1), bgd, fgd,
                    3, cv2.GC_INIT_WITH_RECT)
        fg = ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.uint8)

        # Largest piece only, then close small gaps.
        n, labels, stats, _c = cv2.connectedComponentsWithStats(fg, connectivity=8)
        if n > 1:
            big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
            fg = (labels == big).astype(np.uint8)
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, k)
        coverage = float(fg.sum()) / float(w * h)
        if not (COVER_MIN <= coverage <= COVER_MAX):
            # GrabCut did not find a believable product: use the box
            # itself as a rounded rectangle.
            fg = np.zeros((h, w), np.uint8)
            rad = max(2, int(0.12 * min(rx2 - rx1, ry2 - ry1)))
            cv2.rectangle(fg, (rx1 + rad, ry1), (rx2 - rad, ry2), 1, -1)
            cv2.rectangle(fg, (rx1, ry1 + rad), (rx2, ry2 - rad), 1, -1)
            for cx, cy in ((rx1 + rad, ry1 + rad), (rx2 - rad, ry1 + rad),
                           (rx1 + rad, ry2 - rad), (rx2 - rad, ry2 - rad)):
                cv2.circle(fg, (cx, cy), rad, 1, -1)

        # Fit inside the sticker size (border and margin included).
        pad = BORDER + 1
        fit = float(FINAL_SIDE - 2 * pad) / float(max(w, h))
        if fit < 1.0:
            nw, nh = max(1, round(w * fit)), max(1, round(h * fit))
            rgb = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA)
            fg = cv2.resize(fg, (nw, nh), interpolation=cv2.INTER_NEAREST)
            w, h = nw, nh
        rgb = cv2.copyMakeBorder(rgb, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255))
        fg = cv2.copyMakeBorder(fg, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)

        # 1 px feather, then the baked 3 px white die-cut border.
        a_in = cv2.GaussianBlur(fg.astype(np.float32), (3, 3), 0.8)
        kb = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * BORDER + 1, 2 * BORDER + 1))
        dil = cv2.dilate(fg, kb)
        a_out = cv2.GaussianBlur(dil.astype(np.float32), (3, 3), 0.8)
        a_in = np.clip(a_in, 0.0, 1.0)[:, :, None]
        a_out = np.clip(np.maximum(a_out, a_in[:, :, 0]), 0.0, 1.0)
        color = rgb.astype(np.float32) * a_in + 255.0 * (1.0 - a_in)
        out = np.dstack([np.clip(color, 0, 255).astype(np.uint8),
                         (a_out * 255.0 + 0.5).astype(np.uint8)])
        sticker = Image.fromarray(out, "RGBA")
        for q in (80, 70, 60, 50, 40):
            buf = io.BytesIO()
            sticker.save(buf, "WEBP", quality=q, method=4)
            if buf.tell() <= MAX_BYTES:
                return buf.getvalue()
        return None
    except Exception:
        return None


# --- records -----------------------------------------------------------------

def _new_id(seed):
    return quest._new_id("stk", seed)


def _parse(iso):
    try:
        return datetime.fromisoformat(iso)
    except (TypeError, ValueError):
        return None


def _is_new_rec(rec, session_id):
    return (bool(session_id) and rec.get("first_session_id") == session_id
            and rec.get("source") != "backfill")


def public(rec, is_new=False):
    """What the app may see of a sticker. No media bytes, no
    session list, no prices (there are none)."""
    cut = rec.get("image") == "cutout"
    shelf = rec.get("shelf_label")
    out = {"id": rec["id"], "name": rec["name"], "key": rec["key"],
           "page": aisles.page_for(rec["name"], shelf),
           "aisle": aisles.aisle_for(rec["name"], shelf) or aisles.OTHER,
           "store": rec.get("store"),
           "first_found_at": rec.get("first_found_at"),
           "found_count": max(1, len(rec.get("session_ids") or [])),
           "image": "cutout" if cut else "art",
           "image_url": (f"/api/quest/stickers/{rec['id']}/image?v={rec.get('media_v', 1)}"
                         if cut else None),
           "art": rec.get("art") or "basket.webp",
           "typed": bool(rec.get("typed"))}
    if is_new:
        out["is_new"] = True
    return out


def _find(data, key):
    for rec in data["stickers"]:
        if rec["key"] == key:
            return rec
    return None


def _upsert(data, name, key, session_id=None, store=None, shelf_label=None,
            source="grab", webp=None, when=None, art=None):
    """Add a sticker or touch the existing one, in memory. Returns
    (record, is_new, changed). Idempotent by key; a repeat find adds
    its session and may upgrade art to a cutout (id and
    first_found_at stay)."""
    when = when or quest._now()
    rec = _find(data, key)
    if rec is not None:
        changed = False
        if session_id and session_id not in rec["session_ids"]:
            rec["session_ids"].append(session_id)
            changed = True
        if source != "backfill" and rec.get("last_found_at") != when:
            rec["last_found_at"] = when
            changed = True
        if webp and rec.get("image") != "cutout":
            if not (state.in_sandbox() and _inline_count(data) >= SANDBOX_INLINE_MAX):
                _write_media(rec, webp)
                rec["image"] = "cutout"
                rec["media_v"] = rec.get("media_v", 0) + 1
                changed = True
        if shelf_label and not rec.get("shelf_label"):
            rec["shelf_label"] = shelf_label
            changed = True
        return rec, False, changed
    rec = {"id": _new_id(key + "|" + name), "key": key, "name": name,
           "art": art or aisles.art_for(name), "image": "art", "media": None,
           "first_found_at": when, "first_session_id": session_id,
           "session_ids": [session_id] if session_id else [],
           "last_found_at": when, "store": store, "shelf_label": shelf_label,
           "typed": key.startswith("name:"),
           "source": source if source in SOURCES else "grab"}
    if webp and not (state.in_sandbox() and _inline_count(data) >= SANDBOX_INLINE_MAX):
        _write_media(rec, webp)
        rec["image"] = "cutout"
        rec["media_v"] = 1
    data["stickers"].append(rec)
    while len(data["stickers"]) > CAP:
        old = min(data["stickers"], key=lambda r: r.get("last_found_at") or "")
        data["stickers"].remove(old)
        _delete_media(old)
    return rec, True, True


def add_sticker(name, key=None, session_id=None, store=None, shelf_label=None,
                source="grab", webp=None, when=None, art=None):
    """Idempotent add by key. Returns (public sticker, is_new)."""
    name = (name or "").strip()[:80]
    if not name:
        raise ValueError("name is required")
    key = key or quest._item_key(name)
    with state.file_lock(FILE):
        data = _load()
        rec, is_new, changed = _upsert(data, name, key, session_id, store,
                                       shelf_label, source, webp, when, art)
        if changed:
            _save(data)
        return public(rec, is_new), is_new


def get(sticker_id):
    for rec in _load()["stickers"]:
        if rec["id"] == sticker_id:
            return public(rec)
    return None


def all_stickers():
    return [dict(r) for r in _load()["stickers"]]


# --- page badges (never un-earn) ---------------------------------------------

def badges():
    return dict(_load()["badges"])


def open_session_ids():
    """Ids of hunts that can still undo a grab (a session that exists
    and is not done: the same rule _retract uses)."""
    try:
        return {s.get("id") for s in quest._store()["sessions"]
                if s.get("state") != "done"}
    except Exception:
        return set()


def earn_badge(page_id, when=None):
    """Record a page badge once. Returns (earned_at, newly_earned)."""
    with state.file_lock(FILE):
        data = _load()
        if page_id in data["badges"]:
            return data["badges"][page_id], False
        data["badges"][page_id] = when or quest._now()
        _save(data)
        return data["badges"][page_id], True


# --- the grab hook -----------------------------------------------------------

def _session_item(sess, item_name):
    key = quest._item_key(item_name or "")
    norm = state._norm_name(item_name or "")
    for it in sess.get("items") or []:
        if it.get("group") == key or state._norm_name(it.get("name", "")) == norm:
            return it
    return None


def _cutout_source(store, item_name):
    """(jpeg bytes, box, grade) when the kept frame may make a
    cutout, else None. All four guards must hold."""
    photo = quest.shelf_photo(store, item_name)
    if not photo or not photo.get("jpeg_b64") or not photo.get("box"):
        return None
    seen = _parse(photo.get("seen_at"))
    if seen is None:
        return None
    age = (datetime.now() - seen).total_seconds()
    if age > FRESH_SECONDS or age < -5:
        return None
    if photo.get("people_scrubbed") != 0:
        return None
    if photo.get("grade") == "region":
        return None
    try:
        return base64.b64decode(photo["jpeg_b64"]), photo["box"], photo.get("grade")
    except Exception:
        return None


def _page_count(data, page_id):
    n = 0
    for rec in data["stickers"]:
        if aisles.page_for(rec["name"], rec.get("shelf_label")) == page_id:
            n += 1
    return n


def on_check(sess, item_name, checked):
    """Called after quest.check_item succeeds. A grab mints a sticker;
    the payload comes back ONLY for a first-time product. A put back
    retracts a sticker minted in this same, unfinished session.
    Never raises into the caller's grab path: the route wraps it."""
    item = _session_item(sess, item_name)
    name = (item or {}).get("name") or (item_name or "").strip()
    if not name:
        return None
    key = (item or {}).get("group") or quest._item_key(name)
    if not checked:
        _retract(sess, key)
        return None
    store = sess.get("store")
    sid = sess.get("id")
    shelf_label = (item or {}).get("shelf_label")
    # Cut only when a cutout could be used: a new product, or an art
    # sticker that a fresh frame can upgrade.
    existing = _find(_load(), key)
    webp = None
    if existing is None or existing.get("image") != "cutout":
        src = _cutout_source(store, name)
        if src:
            webp = cut_product(*src)
    with state.file_lock(FILE):
        data = _load()
        rec, is_new, changed = _upsert(
            data, name[:80], key, sid, store, shelf_label,
            "scan" if webp else "grab", webp)
        out = None
        if is_new:
            out = {"sticker": public(rec, True), "is_new": True,
                   "page": aisles.page_for(rec["name"], rec.get("shelf_label"))}
            page = out["page"]
            # The 8th sticker of a page completes it, but this grab can
            # still be undone. The badge is only announced here. It is
            # recorded when the hunt closes (album.settle_badges), so a
            # page never reads "earned" with 7 stickers.
            if (page != aisles.OTHER and page not in data["badges"]
                    and _page_count(data, page) >= aisles.SLOTS):
                bname = aisles.PAGE_BADGES.get(page)
                if bname:
                    out["page_badge"] = {"id": page, "name": bname}
            changed = True
        if changed:
            _save(data)
    return out


def _retract(sess, key):
    """Put back: delete a sticker first minted in this session, while
    the session is not done. A recorded page badge stays; one still
    waiting for the hunt to close is simply never recorded."""
    sid = sess.get("id")
    with state.file_lock(FILE):
        data = _load()
        rec = _find(data, key)
        if rec is None:
            return False
        if rec.get("first_session_id") == sid and sess.get("state") != "done":
            data["stickers"].remove(rec)
            _delete_media(rec)
            _save(data)
            return True
        if sid in rec["session_ids"] and rec.get("first_session_id") != sid:
            rec["session_ids"].remove(sid)
            _save(data)
        return False


# --- reads by session --------------------------------------------------------

def new_in_session(session_id):
    """Stickers first minted in THIS session and still standing.
    Backfilled stickers are never new."""
    out = []
    for rec in _load()["stickers"]:
        if _is_new_rec(rec, session_id):
            out.append({"name": rec["name"], "key": rec["key"],
                        "sticker_id": rec["id"]})
    return out


def _mint_missing(data, sess, source="backfill"):
    """Art stickers for grabbed items that have none, in memory."""
    changed = False
    when = sess.get("finished_at") or sess.get("created_at") or quest._now()
    for it in sess.get("items") or []:
        if not it.get("checked"):
            continue
        key = it.get("group") or quest._item_key(it["name"])
        _rec, _new, ch = _upsert(data, it["name"][:80], key, sess["id"],
                                 sess.get("store"), it.get("shelf_label"),
                                 source, None, when)
        changed = changed or ch
    return changed


def for_session(sess):
    """One sticker per grabbed item of a session, in item order. A
    finished session that lacks a sticker for a grabbed item gets an
    art sticker (source backfill, never NEW)."""
    if sess.get("state") in ("finished", "done"):
        with state.file_lock(FILE):
            data = _load()
            if _mint_missing(data, sess):
                _save(data)
    data = _load()
    out, seen = [], set()
    for it in sess.get("items") or []:
        if not it.get("checked"):
            continue
        key = it.get("group") or quest._item_key(it["name"])
        rec = _find(data, key)
        if rec is None or rec["id"] in seen:
            continue
        seen.add(rec["id"])
        out.append(public(rec, _is_new_rec(rec, sess["id"])))
    return out


def backfill_from_sessions():
    """Stickers for every grabbed item of every done session. Idempotent
    and never NEW. Runs on Album read. Returns how many were added."""
    sessions = [s for s in quest._store()["sessions"]
                if s.get("state") == "done" and not s.get("placeholder")]
    if not sessions:
        return 0
    with state.file_lock(FILE):
        data = _load()
        before = len(data["stickers"])
        changed = False
        for sess in sessions:
            changed = _mint_missing(data, sess) or changed
        if changed:
            _save(data)
        return len(data["stickers"]) - before
