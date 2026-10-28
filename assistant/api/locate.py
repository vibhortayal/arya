"""Locate — "Where am I?", the hunt's position anchor.

A photo taken in a mapped store is matched locally against the
store's walkthrough index by the vendored matcher
(api/localizer.py — Muse Wonder 1.0, localizer spike round 1;
SIFT + RootSIFT, RANSAC verification, sub-frame interpolation).
No model or API calls happen in this path; the spend is $0 and
the photo is processed, never stored — the answer is a path
fraction (u) the client snaps to its nearest session stop.

Confidence gate: 0.60. The spike's held-out run put every true
placement at 0.79-0.88 confidence, and the shipped artifact's
re-run put all 45 held-out photos at 0.635-0.873 — the gate sits
below every observed true placement, while the matcher's
no-match answers carry confidence 0.0. A wrong anchor is worse
than none, so anything under the gate reports low_confidence
and the hunt simply keeps following its route.
"""
import io, os, re, tempfile

from PIL import Image

QUERY_WIDTH = 1036     # the index frames' native width
CONFIDENCE_GATE = 0.60

_MODELS_DIR = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "models"))

# Store key -> index artifact. The key is the store display name
# normalized exactly as the shelf matcher keys its graphs
# (api/shelfmatch.py _key): punctuation-stripped lowercase.
INDEX_BY_STORE_KEY = {
    "traderjoes": os.path.join(_MODELS_DIR, "trader-joes",
                               "localizer-index.npz"),
}


def _key(name):
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def index_path_for(sess):
    """The session store's index artifact, or None — only stores
    with a built index can place a photo."""
    return INDEX_BY_STORE_KEY.get(_key((sess or {}).get("store")))


def _run_matcher(image_path, index_path):
    """The vendored Wonder matcher (seam: tests stub this)."""
    from api import localizer
    return localizer.match_image(image_path, index_path=index_path)


def locate(image_bytes, sess, matcher=None):
    """One photo against the session store's index. Returns
    {"found": True, "u", "confidence"} or {"found": False,
    "reason": "no_index" | "low_confidence"}. Raises PIL's
    UnidentifiedImageError on an unreadable image — the route
    answers 400."""
    index_path = index_path_for(sess)
    if index_path is None or not os.path.exists(index_path):
        return {"found": False, "reason": "no_index"}
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    if img.width > QUERY_WIDTH:
        img = img.resize(
            (QUERY_WIDTH, max(1, round(img.height * QUERY_WIDTH / img.width))),
            Image.LANCZOS)
    fd, tmp = tempfile.mkstemp(suffix=".jpg")
    os.close(fd)
    try:
        img.save(tmp, "JPEG", quality=90)
        result = (matcher or _run_matcher)(tmp, index_path)
    finally:
        os.unlink(tmp)
    u = result.get("estimated_u")
    confidence = float(result.get("confidence") or 0.0)
    if u is None or confidence < CONFIDENCE_GATE:
        return {"found": False, "reason": "low_confidence",
                "confidence": confidence}
    return {"found": True, "u": float(u), "confidence": confidence}
