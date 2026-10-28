"""Shelf Scan (Discussion 37): the unmapped-store mode.

A shopper photographs a shelf; SAM 3.1 proposes boxes for the
session's REMAINING list items, Muse Spark verifies each candidate
crop, and only verified items pop. The failure mode is silence,
never a lie (spike: 0 false pops, both negative controls silent).

Built to the feasibility spike's measured spec
(~/workspace/arya-3d/shelf-scan/REPORT.md) — its three fixes are
requirements here:
1. Verify SAM's TOP-3 boxes per item, not just the best (the
   cookies rescue: best box was bread, the second was cookies).
2. A box-area cap: a box covering more than AREA_CAP of the frame
   is a region, not an item. Over-cap boxes are tried only when no
   in-cap box exists, and a pop from one is graded "region" — the
   box says "this shelf", not "this item" (the olive-oil lesson).
3. A per-item PHRASING BANK: bare nouns fail; descriptive scene
   phrasings land. Seeded from the spike's measured prompts —
   winners first — with a descriptive general fallback.

Copy discipline (the spike's demo boundaries): a scan spots items
from the list, each verified by a second model. It does not find
everything, and a missing pop never means the item is not there.
Frames are processed, never stored: this module keeps nothing.
"""
import base64, io, re

from PIL import Image

AREA_CAP = 0.35        # fix 2: fraction of frame area
TOP_N = 3              # fix 1: boxes verified per item
CROP_MARGIN = 0.20     # the spike's verify-crop context margin

# Fix 3 — the phrasing bank. (keywords, phrasings in try order).
# Order matters: specific entries precede the ones they contain
# ("pasta sauce" before "pasta"). Phrasings are the spike's,
# verbatim where they were measured; winners first.
PHRASING_BANK = [
    (("pasta sauce", "tomato sauce"),
     ["jars of pasta sauce on a shelf",
      "glass jars of tomato sauce on a shelf"]),
    (("olive oil",),
     ["rows of oil and vinegar bottles on a shelf",
      "bottles of olive oil on a shelf",
      "glass bottles of cooking oil lined up on a shelf",
      "dark glass bottles on a grocery shelf"]),
    (("pizza",),
     ["frozen pizza boxes",
      "boxes of frozen pizza in a freezer case"]),
    (("pasta",),
     ["bags of dried pasta on a shelf", "pasta boxes"]),
    (("cheese",),
     ["packaged cheese on a refrigerated shelf",
      "blocks and slices of cheese in plastic packaging",
      "small packages of cheese and dairy products on shelves",
      "deli cheese packages in a refrigerated case"]),
    (("bread",),
     ["packaged bread",
      "loaves of bread in clear plastic bags on a shelf",
      "wrapped loaves of bread on a shelf",
      "bread and baked goods on wooden shelves"]),
    (("cookie",),
     ["boxes of cookies on a shelf",
      "packages and bags of cookies on a shelf",
      "bags of cookies and snacks on a shelf",
      "cookie and cracker packages"]),
    (("hummus", "dip"),
     ["plastic tubs of hummus on a refrigerated shelf",
      "round plastic tubs of dip stacked on a shelf",
      "small round plastic containers with lids on a shelf",
      "stacked plastic tubs of food on a refrigerated shelf"]),
]

VERIFY_INSTRUCTION = (
    "You are verifying a grocery shelf scan. The image crop is "
    "supposed to show this shopping-list item: {item}. Look at the "
    "main product in the crop. Reply with exactly one line: YES if "
    "the main product really is {item}, or NO: <what it actually is> "
    "if it is not.")


def phrasings_for(item_name):
    """The bank entry for an item, else the general fallback:
    descriptive templates built from the item name, ending at the
    scene prompt that still finds products when item phrasings
    fail (the spike's diagnostic)."""
    name = re.sub(r"\s+", " ", (item_name or "").strip().lower())
    for keywords, phrasings in PHRASING_BANK:
        if any(k in name for k in keywords):
            return list(phrasings)
    return [f"{name} on a grocery shelf",
            f"packages of {name} on a shelf",
            "grocery products"]


def _area(box):
    return max(0, box[2] - box[0]) * max(0, box[3] - box[1])


def _rank(boxes):
    """Best first: SAM confidence, ties broken by larger area (the
    spike's best-box rule, extended to a ranking)."""
    return sorted(boxes,
                  key=lambda b: ((b.get("confidence") or 0.0), _area(b["box"])),
                  reverse=True)


def _iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = _area(a) + _area(b) - inter
    return inter / union if union > 0 else 0.0


def _crop_jpeg(img, box):
    """The candidate box plus context margin, as JPEG bytes (what
    Spark judged in the spike)."""
    W, H = img.size
    x1, y1, x2, y2 = box
    mx, my = (x2 - x1) * CROP_MARGIN, (y2 - y1) * CROP_MARGIN
    crop = img.crop((max(0, int(x1 - mx)), max(0, int(y1 - my)),
                     min(W, int(x2 + mx)), min(H, int(y2 + my))))
    buf = io.BytesIO()
    crop.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def _verify(client, crop_bytes, item_name):
    """Muse Spark 1.3 Standard judges the crop. A shelf photo is
    the shopper's own image: Standard only (personal=True bars the
    training-eligible tier outright)."""
    uri = "data:image/jpeg;base64," + base64.b64encode(crop_bytes).decode()
    text, _usage, _cost = client.chat(
        [{"role": "user", "content": [
            {"type": "text", "text": VERIFY_INSTRUCTION.format(item=item_name)},
            {"type": "image_url", "image_url": {"url": uri}}]}],
        mode="standard", personal=True)
    first = (text or "").strip().split("\n")[0].strip()
    return first.upper().startswith("YES")


def scan(image_bytes, item_names, client, media_type="image/jpeg"):
    """One shelf photo against the remaining list. Returns
    {"pops": [{item, box (normalized 0-1), grade}], "not_found":
    [item, ...]}. Raises RuntimeError on a model failure — the
    route answers 502, the same as every other door."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    W, H = img.size
    frame_area = float(W * H)
    pops, not_found = [], []
    for name in item_names:
        boxes = []
        for prompt in phrasings_for(name):
            boxes, _u, _c = client.segment(image_bytes, prompt,
                                             media_type=media_type)
            if boxes:
                break
        ranked = _rank(boxes)
        in_cap = [b for b in ranked if _area(b["box"]) / frame_area <= AREA_CAP]
        over_cap = [b for b in ranked if _area(b["box"]) / frame_area > AREA_CAP]
        # Fix 2: over-cap boxes are region candidates only — tried
        # solely when nothing in-cap exists, one deep.
        candidates = [(b, "item") for b in in_cap[:TOP_N]]
        if not candidates and over_cap:
            candidates = [(over_cap[0], "region")]
        pop = None
        tried = []
        for cand, grade in candidates:
            if any(_iou(cand["box"], t) > 0.8 for t in tried):
                continue  # a near-duplicate of a judged crop
            tried.append(cand["box"])
            if _verify(client, _crop_jpeg(img, cand["box"]), name):
                pop = {"item": name,
                       "box": [round(cand["box"][0] / W, 4),
                               round(cand["box"][1] / H, 4),
                               round(cand["box"][2] / W, 4),
                               round(cand["box"][3] / H, 4)],
                       "grade": grade}
                break
        if pop:
            pops.append(pop)
        else:
            not_found.append(name)
    return {"pops": pops, "not_found": not_found}
