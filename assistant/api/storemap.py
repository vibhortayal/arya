"""Map my store — the guided, crowd-built store map (owner, 2026-10-28).

A store map is a list of SEGMENTS: one side of one aisle, or one
wall or freezer run. Nobody has to map the whole store. A shopper
maps the aisles they use, over as many visits as they like; every
shopper's partial map merges into one shared map per store. This
module is the merge and the engine under it:

- Coverage: a segment is unmapped, mapped, aging, or stale. The
  store's coverage is the share of known segments that are mapped
  and fresh. The set of segments grows as people add aisles.
- Prompts: next_prompt() tells the shopper exactly what to capture
  (a photo of one shelf, or a slow walk past one aisle), in the
  words and the way the engine needs it. No open-ended "take a
  photo".
- Selection: ingest() scores every capture (sharpness, exposure,
  how much of the frame is shelf), drops near-duplicates, and keeps
  the best few per segment. A weak capture is refused with a
  one-line fix ("hold steady"), never silently stored.
- Freshness: "not found" reports and "map is outdated" taps flag a
  segment stale. A stale segment goes to the top of the prompts
  until a newer, good capture clears it.

All of it is deterministic code — $0. The only model calls are the
people scrub and the shelf-fill check, both made by the route
through meta_client. This module takes a scrubbed JPEG and never a
raw frame (owner: "we don't store images of people").

The map is PLATFORM plane (one shared file per store family, like
the stores directory). Demo visitors write to their own sandbox
overlay, so a judge never edits the real map.
"""
import base64, hashlib, io, json, math, os, re
from datetime import datetime

import numpy as np
from PIL import Image

from api import state

MAP_FILE = "storemap.json"
IMG_FILE = "storemap_img.json"

KEEP_PER_SEGMENT = 3          # best captures kept per segment
HALF_LIFE_DAYS = 30.0         # a capture's value halves every 30 days
AGING_AFTER_DAYS = 60         # a best capture older than this is "aging"
DUP_HAMMING = 6               # dhash distance at or below = same view
MIN_SHARPNESS = 0.25          # below this a capture is refused: blurry
MIN_LUMA, MAX_LUMA = 45, 225  # mean grey level bounds: dark / washed out
IMG_MAX_SANDBOX = 8           # demo overlay holds 2 MB
SIDES = ("left", "right", "both")
KINDS = ("photo", "walk")
WALK_MAX_FRAMES = 6
SOURCE_BASELINE = "walkthrough"

# --- store and segment identity -----------------------------------------


def store_key(name):
    """Store identity for the map: the normalized name with spaces
    removed, so "Trader Joe's" and "trader joes" are one store (the
    same rule quest._same_store uses for reports)."""
    return state._norm_name(name or "").replace(" ", "")


def zone_key(label):
    """Merge key for an aisle or section label. "Aisle 4", "aisle #4"
    and "Aisle 4 - Pasta" are one zone (aisle-4); other labels merge
    on their normalized words, minus a trailing "shelf"."""
    text = (label or "").strip().lower()
    m = re.search(r"\baisle\s*#?\s*(\d+)", text)
    if m:
        return f"aisle-{int(m.group(1))}"
    words = re.sub(r"[^a-z0-9]+", " ", text).strip()
    words = re.sub(r"\s*\bshelf\b$", "", words).strip()
    return re.sub(r"\s+", "-", words)


def segment_id(label, side):
    return f"{zone_key(label)}:{side}"


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _age_days(iso, now=None):
    if not iso:
        return None
    try:
        then = datetime.fromisoformat(iso)
    except ValueError:
        return None
    return max(0.0, ((now or datetime.now()) - then).total_seconds() / 86400.0)


def freshness(iso, now=None):
    """1.0 for a capture taken now, 0.5 at the half-life."""
    age = _age_days(iso, now)
    return 0.0 if age is None else 0.5 ** (age / HALF_LIFE_DAYS)


def contributor():
    """A short stable hash of the signed-in account — never the
    username itself, because the map is shared across accounts."""
    user = state._current_user.get() or "anon"
    return hashlib.sha1(("map|" + user).encode()).hexdigest()[:8]


# --- storage -------------------------------------------------------------
# state._load/_save follow the per-user context; the shared map lives
# in the data root, so reads and writes run with the context cleared
# (the pattern stores.py uses). The sandbox overlay still catches a
# demo visitor's writes.

def _root_load(name, default):
    tok = state._current_user.set(None)
    try:
        return state._load(name, default)
    finally:
        state._current_user.reset(tok)


def _root_save(name, obj):
    tok = state._current_user.set(None)
    try:
        state._save(name, obj)
    finally:
        state._current_user.reset(tok)


class _Lock:
    """Hold the root-plane map lock across a load-modify-save."""
    def __enter__(self):
        tok = state._current_user.set(None)
        try:
            self._lock = state.file_lock(MAP_FILE)
        finally:
            state._current_user.reset(tok)
        self._lock.acquire()

    def __exit__(self, *exc):
        self._lock.release()


def _all():
    return _root_load(MAP_FILE, {})


def _walkthrough_seed(key):
    """The shipped walkthrough graph seeds a store's segments, so a
    store with a walk video starts mapped (and aging, because the
    walk is old) instead of empty. Only Trader Joe's ships one."""
    if key != store_key("Trader Joe's"):
        return None
    path = os.path.join(os.path.dirname(__file__), "..", "pwa", "models",
                        "trader-joes", "shelf-graph.json")
    frames_dir = os.path.join(os.path.dirname(path), "frames-web")
    try:
        with open(path) as fh:
            graph = json.load(fh)
    except (OSError, ValueError):
        return None
    segs = {}
    for stop in graph.get("stops", []):
        m = re.search(r"(\d+)", stop.get("frame", ""))
        frame = f"f{int(m.group(1)):03d}.jpg" if m else None
        if frame and not os.path.exists(os.path.join(frames_dir, frame)):
            frame = None
        for sh in stop.get("shelves", []):
            label = (sh.get("label") or "").strip()
            if not label or label.lower().startswith("unidentified"):
                continue
            # One segment per zone: the walk saw it from one path, and
            # real sides are for shoppers to refine as they map.
            label = re.sub(r"\s+Shelf$", "", label)
            side = "both"
            sid = segment_id(label, side)
            seg = segs.get(sid)
            if seg is None:
                seg = segs[sid] = _new_segment(label, side, "walkthrough")
                seg["baseline"] = {"frame": frame, "u": stop.get("u")}
            elif frame and not seg["baseline"].get("frame"):
                seg["baseline"]["frame"] = frame
    return segs


def _new_segment(label, side, created_by):
    return {"id": segment_id(label, side), "zone": zone_key(label),
            "label": label.strip(), "side": side,
            "created_by": created_by, "created_at": _now(),
            "items": {}, "captures": [], "stale": None, "baseline": None}


def load_map(name):
    """One store's map, seeded on first read when the store has a
    walkthrough. Never writes: a seed lives in memory until the
    first real change saves it."""
    key = store_key(name)
    doc = _all().get(key)
    if doc is None:
        doc = {"store": (name or "").strip(), "key": key,
               "segments": _walkthrough_seed(key) or {},
               "unplaced": []}
    return doc


def _save_map(doc):
    data = _all()
    data[doc["key"]] = doc
    _root_save(MAP_FILE, data)


# --- adding aisles --------------------------------------------------------

def add_segment(name, label, side):
    """A shopper adds an aisle side to the map. Merges on the zone
    key: adding "Aisle 4" again changes nothing. Returns
    (segment, created_flag)."""
    label = (label or "").strip()
    if not label or len(label) > 60:
        raise ValueError("give the aisle a name (60 letters at most)")
    if not zone_key(label):
        raise ValueError("the aisle name needs letters or numbers")
    if side not in SIDES:
        raise ValueError(f"side must be one of {SIDES}")
    if not (name or "").strip():
        raise ValueError("store is required")
    with _Lock():
        doc = load_map(name)
        sid = segment_id(label, side)
        if sid in doc["segments"]:
            return doc["segments"][sid], False
        seg = _new_segment(label, side, contributor())
        doc["segments"][sid] = seg
        _save_map(doc)
        return seg, True


# --- the engine: scoring and selection -----------------------------------

def _gray(img, width=480):
    w, h = img.size
    scale = width / float(w) if w > width else 1.0
    g = img.convert("L")
    if scale < 1:
        g = g.resize((width, max(1, int(h * scale))), Image.BILINEAR)
    return np.asarray(g, dtype=np.float32)


def _laplacian_var(g):
    lap = (-4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1]
           + g[1:-1, :-2] + g[1:-1, 2:])
    return float(lap.var())


def dhash(img):
    g = img.convert("L").resize((9, 8), Image.BILINEAR)
    a = np.asarray(g, dtype=np.int16)
    bits = (a[:, 1:] > a[:, :-1]).flatten()
    return "%016x" % int("".join("1" if b else "0" for b in bits), 2)


def hamming(a, b):
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def score_image(jpeg, shelf_fill=None):
    """Grade one capture. Returns {score, sharpness, exposure, fill,
    luma, fix}: fix is a one-line instruction when the capture is
    refused, else None. shelf_fill is the share of the frame that
    shelves cover (SAM 3.1, summed over bays), or None when the check
    did not run — then fill counts as neutral. Fill only shapes the
    score: a far shot is still useful, and a refusal on a noisy
    metric would silently drop real captures."""
    img = Image.open(io.BytesIO(jpeg)).convert("RGB")
    g = _gray(img)
    sharp = min(1.0, _laplacian_var(g) / 150.0)
    luma = float(g.mean())
    exposure = max(0.0, 1.0 - abs(luma - 128.0) / 128.0)
    fill = 0.7 if shelf_fill is None else min(1.0, shelf_fill / 0.5)
    fix = None
    if sharp < MIN_SHARPNESS:
        fix = "Too blurry. Hold the phone still for one second, then try again."
    elif luma < MIN_LUMA:
        fix = "Too dark. Face the shelf light, or step back from your own shadow."
    elif luma > MAX_LUMA:
        fix = "Too bright. Tilt the phone a little to lose the glare."
    score = round(0.5 * sharp + 0.3 * exposure + 0.2 * fill, 4)
    return {"score": score, "sharpness": round(sharp, 3),
            "exposure": round(exposure, 3), "fill": round(fill, 3),
            "luma": round(luma, 1), "fix": fix}


def _value(cap, now=None):
    return cap["score"] * freshness(cap["at"], now)


def select_best(captures, keep=KEEP_PER_SEGMENT, now=None):
    """Which captures a segment keeps. Rank by score x freshness,
    drop any capture that shows the same view as a better one
    (dhash within DUP_HAMMING), keep the top `keep`. Newest and
    sharpest wins ties through the value order."""
    ranked = sorted(captures, key=lambda c: _value(c, now), reverse=True)
    kept = []
    for cap in ranked:
        if any(hamming(cap["dhash"], k["dhash"]) <= DUP_HAMMING for k in kept):
            continue
        kept.append(cap)
        if len(kept) == keep:
            break
    return kept


def segment_status(seg, now=None):
    """unmapped | mapped | aging | stale."""
    best = max(seg["captures"], key=lambda c: _value(c, now), default=None)
    flag = seg.get("stale")
    if flag and (best is None or best["at"] <= flag["at"]):
        return "stale"
    if best is None:
        return "aging" if seg.get("baseline") else "unmapped"
    age = _age_days(best["at"], now)
    return "aging" if age is not None and age > AGING_AFTER_DAYS else "mapped"


def _image_blobs():
    return _root_load(IMG_FILE, {})


def _put_image(key, cap_id, jpeg):
    blobs = _image_blobs()
    blobs.setdefault(key, {})[cap_id] = base64.b64encode(jpeg).decode()
    _root_save(IMG_FILE, blobs)


def _drop_images(key, keep_ids):
    blobs = _image_blobs()
    cur = blobs.get(key, {})
    gone = [i for i in cur if i not in keep_ids]
    if gone:
        for i in gone:
            cur.pop(i)
        _root_save(IMG_FILE, blobs)


def ingest(name, seg_id, jpeg, kind="photo", shelf_fill=None, people=0):
    """Merge one people-scrubbed capture into a segment.

    Returns {accepted, ...}. A refused capture carries `fix`, the
    one-line retake instruction. An accepted one carries its score,
    whether it became the segment's best view, and the new status."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    with _Lock():
        doc = load_map(name)
        seg = doc["segments"].get(seg_id)
        if seg is None:
            raise KeyError(seg_id)
        graded = score_image(jpeg, shelf_fill)
        if graded["fix"]:
            return {"accepted": False, "fix": graded["fix"],
                    "score": graded["score"], "segment": seg_id}
        img = Image.open(io.BytesIO(jpeg))
        cap = {"id": hashlib.sha1(
                   f"{seg_id}|{_now()}|{len(jpeg)}|{contributor()}".encode()
               ).hexdigest()[:12],
               "at": _now(), "kind": kind, "by": contributor(),
               "score": graded["score"], "parts": {
                   k: graded[k] for k in ("sharpness", "exposure", "fill")},
               "dhash": dhash(img), "w": img.size[0], "h": img.size[1],
               "people": int(people)}
        before_best = max(seg["captures"], key=_value, default=None)
        # The same view again is a CONFIRMATION, not a second copy: the
        # old capture is refreshed (and swapped when the new one is
        # clearly sharper), so a retake of an unchanged shelf still
        # clears a stale flag.
        twin = next((c for c in seg["captures"]
                     if hamming(cap["dhash"], c["dhash"]) <= DUP_HAMMING), None)
        if twin is not None:
            if cap["score"] > twin["score"] + 0.05:
                seg["captures"].remove(twin)
                seg["captures"].append(cap)
                _put_image(doc["key"], cap["id"], jpeg)
            else:
                twin["at"] = cap["at"]
            kept = seg["captures"]
            became_kept, became_best, duplicate = False, False, True
        else:
            duplicate = False
            kept = select_best(seg["captures"] + [cap])
            if state.in_sandbox():
                kept = kept[:IMG_MAX_SANDBOX]
            became_kept = cap["id"] in {c["id"] for c in kept}
            became_best = became_kept and (
                before_best is None or _value(cap) > _value(before_best))
            if became_kept:
                _put_image(doc["key"], cap["id"], jpeg)
        seg["captures"] = kept
        _drop_images(doc["key"], {c["id"] for s in doc["segments"].values()
                                  for c in s["captures"]})
        # A good capture of this segment clears the stale mark.
        if (became_kept or duplicate) and seg.get("stale"):
            seg["stale"] = None
        _save_map(doc)
        return {"accepted": True, "kept": became_kept,
                "duplicate": duplicate, "best": became_best,
                "score": cap["score"], "segment": seg_id,
                "status": segment_status(seg), "capture": cap["id"]}


def best_image(name, seg_id):
    """The segment's best kept capture as JPEG bytes, or None."""
    doc = load_map(name)
    seg = doc["segments"].get(seg_id)
    if seg is None or not seg["captures"]:
        return None
    best = max(seg["captures"], key=_value)
    b64 = _image_blobs().get(doc["key"], {}).get(best["id"])
    return base64.b64decode(b64) if b64 else None


# --- feeding the map from the hunt ---------------------------------------

def note_sighting(name, item, shelf_label):
    """A verified pop says which item lives on which shelf. If the
    label matches a segment's zone, remember it: that is how a "not
    found" report later finds the segment to refresh."""
    if not shelf_label or not item:
        return
    zone = zone_key(shelf_label)
    with _Lock():
        doc = load_map(name)
        hit = [s for s in doc["segments"].values() if s["zone"] == zone]
        if not hit:
            return
        group = state._norm_name(item)
        for seg in hit:
            seg["items"][group] = _now()
        _save_map(doc)


def flag_outdated(name, seg_id=None, item=None, reason="outdated"):
    """"Not found" or "map is outdated". Marks a segment stale and
    returns the refresh prompt for it. With only an item, the
    segment is the one where the item was last seen; if none is
    known the report is parked as unplaced and the prompt asks the
    shopper which aisle they are in."""
    with _Lock():
        doc = load_map(name)
        seg = doc["segments"].get(seg_id) if seg_id else None
        group = state._norm_name(item) if item else None
        if seg is None and group:
            seen = [(s["items"][group], s) for s in doc["segments"].values()
                    if group in s["items"]]
            if seen:
                seg = max(seen, key=lambda t: t[0])[1]
        if seg is None:
            if group and group not in doc["unplaced"]:
                doc["unplaced"].append(group)
                doc["unplaced"] = doc["unplaced"][-50:]
                _save_map(doc)
            return {"segment": None, "item": item,
                    "prompt": {"kind": "photo", "segment": None,
                               "title": "Which aisle are you in?",
                               "why": "We do not know where this item sits yet.",
                               "steps": ["Pick the aisle you are standing in.",
                                         "Then take the photo we ask for."]}}
        seg["stale"] = {"at": _now(), "reason": reason, "item": item,
                        "by": contributor()}
        _save_map(doc)
        return {"segment": seg["id"], "item": item,
                "prompt": _prompt_for(seg, status="stale", item=item)}


# --- prompts: what to capture, exactly ------------------------------------

def _side_word(side):
    return {"left": "left-hand", "right": "right-hand",
            "both": "both sides of the"}[side]


def _prompt_for(seg, status, item=None, walk=False):
    label = seg["label"]
    if walk:
        side = seg["side"]
        point = ("Point it at the " + side + " shelves." if side != "both"
                 else "Point it at one side, then the other.")
        return {
            "kind": "walk", "segment": seg["id"], "est_seconds": 20,
            "title": f"Walk {label}, {side} side" if side != "both"
                     else f"Walk {label}",
            "why": "A slow walk maps the whole aisle in one go.",
            "steps": [f"Start at the front end of {label}.",
                      "Hold the phone upright, at chest height.",
                      point,
                      "Walk slowly to the end. It takes about 15 seconds.",
                      "The app picks the sharp frames for you."]}
    why = {"unmapped": "This part of the map is empty.",
           "aging": "Mapped once, from an old walkthrough video. Shelves change.",
           "stale": "A shopper said this part is out of date.",
           "refresh": "Keeping this part of the map fresh."}[status]
    if item and status == "stale":
        why = f"Someone could not find {item} here. A fresh photo helps."
    return {
        "kind": "photo", "segment": seg["id"], "est_seconds": 10,
        "title": f"Photo of {label}, {seg['side']} side"
                 if seg["side"] != "both" else f"Photo of {label}",
        "why": why,
        "steps": [f"Stand about 1.5 m (5 ft) from {label}.",
                  "Hold the phone upright and level.",
                  "Get the whole shelf in the frame, top to bottom.",
                  "Hold still. The app takes the photo for you.",
                  "We blur people before we save anything."]}


NEED = {"stale": 3.0, "unmapped": 2.0, "aging": 1.0}


def next_prompt(name, focus=None, seg_id=None):
    """The one capture the engine wants next. focus is the list of
    segment ids the shopper chose to map ("just my aisles"); the
    prompt comes from there first, and from the whole store only when
    the focus is done. seg_id forces a segment (a refresh request).
    Returns None when nothing needs capture."""
    doc = load_map(name)
    segs = doc["segments"]
    if seg_id:
        seg = segs.get(seg_id)
        if seg is None:
            return None
        st = segment_status(seg)
        return _prompt_for(seg, "refresh" if st == "mapped" else st)
    scored = []
    for seg in segs.values():
        st = segment_status(seg)
        if st == "mapped":
            continue
        scored.append((NEED[st] + (0.5 if focus and seg["id"] in focus else 0)
                       - (0.0 if not seg["captures"] else 0.2), seg, st))
    if focus:
        mine = [t for t in scored if t[1]["id"] in focus]
        scored = mine or scored
    if not scored:
        return None
    scored.sort(key=lambda t: (-t[0], t[1]["id"]))
    _, seg, st = scored[0]
    # Two or more unmapped segments in one zone: one walk gets both.
    zone_peers = [s for s in segs.values() if s["zone"] == seg["zone"]
                  and segment_status(s) == "unmapped"]
    walk = st == "unmapped" and (len(zone_peers) >= 2 or seg["side"] == "both")
    prompt = _prompt_for(seg, st, item=(seg.get("stale") or {}).get("item"),
                         walk=walk)
    return prompt


# --- the shared view -------------------------------------------------------

def view(name, focus=None):
    """The map as the app shows it: each segment with its status,
    the coverage numbers, and the next prompt."""
    doc = load_map(name)
    now = datetime.now()
    rows = []
    counts = {"unmapped": 0, "mapped": 0, "aging": 0, "stale": 0}
    for seg in sorted(doc["segments"].values(),
                      key=lambda s: (s["zone"], s["side"])):
        st = segment_status(seg, now)
        counts[st] += 1
        best = max(seg["captures"], key=lambda c: _value(c, now),
                   default=None)
        rows.append({
            "id": seg["id"], "label": seg["label"], "side": seg["side"],
            "status": st, "captures": len(seg["captures"]),
            "best_at": best["at"] if best else None,
            "has_photo": bool(best) or bool(
                (seg.get("baseline") or {}).get("frame")),
            "contributors": len({c["by"] for c in seg["captures"]}),
            "items": len(seg["items"]),
            "stale_item": (seg.get("stale") or {}).get("item"),
            "baseline": seg.get("baseline") is not None})
    total = len(rows)
    return {"store": doc["store"], "segments": rows, "counts": counts,
            "total": total,
            "coverage_pct": round(100 * counts["mapped"] / total) if total else 0,
            "mapped_or_aging_pct": round(
                100 * (counts["mapped"] + counts["aging"]) / total)
            if total else 0,
            "unplaced": list(doc["unplaced"]),
            "next": next_prompt(name, focus)}


def baseline_frame(name, seg_id):
    seg = load_map(name)["segments"].get(seg_id)
    return ((seg or {}).get("baseline") or {}).get("frame")


# --- "just my aisles": the account's focus --------------------------------
# Account plane: which segments this shopper chose to map. A hint
# only; the shared map never depends on it.

FOCUS_FILE = "map_focus.json"


def get_focus(name):
    return list(state._load(FOCUS_FILE, {}).get(store_key(name), []))


def set_focus(name, seg_ids):
    doc = load_map(name)
    ids = [i for i in dict.fromkeys(seg_ids or []) if i in doc["segments"]]
    with state.file_lock(FOCUS_FILE):
        data = state._load(FOCUS_FILE, {})
        data[store_key(name)] = ids
        state._save(FOCUS_FILE, data)
    return ids
