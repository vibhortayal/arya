#!/usr/bin/env python3
"""build_shelf_graph — ground the Quest cloud driver's stops in the
real shelves of a mapped store (Quest Stage D).

Pipeline (all Meta models, docs/quest/META-PRODUCTS.md):

  1. A subset of the walkthrough frames (every Nth pose) goes to
     SAM 3.1 (POST /v1/responses, model "sam-3.1") with noun-phrase
     prompts ("grocery shelf", "grocery products"). Only the box
     records of the SAM wire text are read; masks are not needed to
     place a shelf.
  2. Boxes are clustered into shelf regions (same side of the walk,
     same shelf band) with deterministic code.
  3. Muse Spark 1.3 Standard (POST /v1/chat/completions) labels each
     region from its crop. A label is a model proposal: the graph
     carries Spark's shelf name, its self-rated confidence, and the
     raw reply, so nothing downstream presents a guess as fact.
  4. Each region is projected onto the camera path: its position is
     the arc-length fraction (u) of its frame's pose along the kept
     pose polyline — the same polyline prep_cloud.py resamples into
     the manifest path — and its side comes from the pose geometry.

Output: shelf-graph.json beside the store model (manifest.json /
cloud.bin), read by the cloud SceneDriver in assistant/pwa/scene.js.

API access mirrors the connector helper (custom.meta-model-api):
the credential is a surrogate placed by dynamic_credentials and
swapped for the real key only on requests to api.meta.ai. The raw
key is never read here. Spend is tracked from each response's usage
block (SAM reports images_processed; Spark reports tokens, priced
with api/meta_client.py's table) and the run stops at --max-spend.

Usage:
  python3 tools/build_shelf_graph.py \
      --frames ../../../arya-3d/frames90 \
      --poses ../../../arya-3d/vggt-out/poses.json \
      --model-dir pwa/models/trader-joes --every 5
"""
import argparse, base64, io, json, math, os, re, sys, threading
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ASSISTANT = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, ASSISTANT)
sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")

from api.meta_client import estimate_cost  # noqa: E402  (repo price table)

PROMPTS = ["grocery shelf", "grocery products"]
SAM_PRICE_PER_IMAGE = 2.50 / 1000.0        # MODEL-POLICY / connector doc
MIN_AREA_FRAC, MAX_AREA_FRAC = 0.004, 0.65
MIN_SAM_CONFIDENCE = 0.40
BAND_GAP = 0.16          # normalized center-y gap that splits a band
MAX_REGIONS = 6          # labelled regions per frame, at most
SIDE_LATERAL_MIN = 0.08  # |lateral| below this: side not determinable
LABEL_MAX_WIDTH = 900    # px; region crops are downscaled to this

LABEL_INSTRUCTION = (
    "You label one region of a grocery-store aisle photo for a store "
    "map. The image is a single shelf region cropped from a Trader "
    "Joe's aisle. Name the grocery products or shelf section it "
    "shows. Reply with JSON only, no other text: "
    '{"label": "...", "confidence": "high", "medium", or "low"} '
    "where label is a short shelf display name of 2-5 words ending "
    'in "Shelf" (for example "Pasta & Sauce Shelf", "Honey & Syrup '
    'Shelf", "Cheese Shelf"). If no grocery products can be '
    'identified, use "Unidentified Shelf" with confidence "low".'
)


# --- API transport (connector surrogate flow, as in meta_api.py) ---------

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused, verify the endpoint")


def api_call(path, body, timeout=180):
    from dynamic_credentials import add_surrogate_to_request, \
        read_json_response
    req = urllib.request.Request(
        "https://api.meta.ai" + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    add_surrogate_to_request(req, "custom.meta-model-api",
                             allowed_hosts=["api.meta.ai"])
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        with opener.open(req, timeout=timeout) as resp:
            return resp.status, read_json_response(resp)
    except urllib.error.HTTPError as e:
        try:
            payload = read_json_response(e)
        except Exception:
            payload = {"raw_error": str(e)}
        return e.code, payload


class Spend:
    """Running spend from response usage blocks, with a hard cap."""

    def __init__(self, cap_usd):
        self.cap = cap_usd
        self.lock = threading.Lock()
        self.sam_images = 0
        self.sam_calls = 0
        self.spark_calls = 0
        self.spark_usage = {"input_tokens": 0, "cached_tokens": 0,
                            "output_tokens": 0}
        self.spark_cost = 0.0

    @property
    def sam_cost(self):
        return self.sam_images * SAM_PRICE_PER_IMAGE

    @property
    def total(self):
        return self.sam_cost + self.spark_cost

    def check(self, next_cost):
        if self.total + next_cost > self.cap:
            raise RuntimeError(
                f"spend cap: ${self.total:.4f} + ${next_cost:.4f} "
                f"> cap ${self.cap:.2f}")

    def add_sam(self, images):
        with self.lock:
            self.sam_calls += 1
            self.sam_images += images

    def add_spark(self, usage):
        cost = estimate_cost("standard", usage["input_tokens"],
                             usage["cached_tokens"],
                             usage["output_tokens"])
        with self.lock:
            self.spark_calls += 1
            for k in self.spark_usage:
                self.spark_usage[k] += usage[k]
            self.spark_cost += cost
        return cost

    def report(self):
        return {"samCalls": self.sam_calls, "samImages": self.sam_images,
                "sparkCalls": self.spark_calls,
                "sparkUsage": dict(self.spark_usage),
                "costUsd": {"sam": round(self.sam_cost, 4),
                            "spark": round(self.spark_cost, 4),
                            "total": round(self.total, 4)}}


# --- SAM wire text --------------------------------------------------------

_BOX_RE = re.compile(r"(\d+)<\|box;([^|]*)\|>")


def parse_sam_boxes(text):
    """Box records from SAM 3.1 output text (protocol: meta-sam
    sam3.md). Mask payloads contain no '<', '|' or ',' characters,
    so a box token can be matched directly. Returns segment dicts:
    {id, box [x1, y1, x2, y2] inclusive, w, h, confidence|None}."""
    out = []
    for m in _BOX_RE.finditer(text or ""):
        fields = {}
        for part in m.group(2).split(";"):
            if "=" in part:
                k, v = part.split("=", 1)
                fields[k.strip()] = v.strip()
        try:
            box = [int(fields["x1"]), int(fields["y1"]),
                   int(fields["x2"]), int(fields["y2"])]
            w, h = int(fields["w"]), int(fields["h"])
        except (KeyError, ValueError):
            continue
        conf = None
        if "c" in fields:
            try:
                conf = float(fields["c"])
            except ValueError:
                conf = None
        out.append({"id": m.group(1), "box": box, "w": w, "h": h,
                    "confidence": conf})
    return out


def sam_segment(frame_bytes, prompt, spend):
    """One SAM 3.1 image call. Returns the parsed box segments."""
    spend.check(SAM_PRICE_PER_IMAGE)
    uri = "data:image/jpeg;base64," + base64.b64encode(
        frame_bytes).decode()
    body = {"model": "sam-3.1", "stream": False,
            "input": [{"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": prompt},
                {"type": "input_image", "image_url": uri}]}],
            "metadata": {"include_confidence": "true"}}
    status, payload = api_call("/v1/responses", body)
    if status != 200 or payload.get("status") != "completed":
        raise RuntimeError(f"SAM HTTP {status}: "
                           f"{str(payload)[:300]}")
    spend.add_sam((payload.get("usage") or {}).get("images_processed",
                                                   1))
    text = ""
    for item in payload.get("output") or []:
        for part in item.get("content") or []:
            if part.get("type") == "output_text":
                text += part.get("text", "")
    return parse_sam_boxes(text)


# --- path geometry (mirrors prep_cloud.py) --------------------------------

def _load_prep():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "prep_cloud", os.path.join(HERE, "prep_cloud.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def path_fractions(poses):
    """{pose_index: u} — each kept pose's arc-length fraction along
    the kept pose polyline (the polyline prep_cloud resamples into
    the manifest path, so u is on the driver's scale). Dropped
    (spike) poses are absent from the map."""
    prep = _load_prep()
    centers = prep._centers(poses)
    kept = prep.drop_outlier_poses(centers)
    cum, total = {}, 0.0
    prev = None
    for k in kept:
        if prev is not None:
            total += prep._dist(centers[prev], centers[k])
        cum[k] = total
        prev = k
    if total <= 0:
        return {}
    return {k: v / total for k, v in cum.items()}


def _rot_transpose_vec(R, v):
    """R^T . v for a 3x3 rotation given as rows (world->camera)."""
    return tuple(R[0][i] * v[0] + R[1][i] * v[1] + R[2][i] * v[2]
                 for i in range(3))


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0])


def _norm(v):
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return tuple(x / n for x in v)


def segment_side(seg, pose, forward):
    """Which side of the walking direction a segment sits on, from
    the pose geometry: the ray through the box centroid, expressed
    in the world frame, against the walk's right vector. Returns
    "left", "right", or None when the ray is too close to the
    forward axis to call. VGGT world is y-down, so world up is
    (0, -1, 0); camera intrinsics are used in normalized form
    (principal point at the image centre), which makes the result
    independent of the frame file's pixel size."""
    K = pose["intrinsic"]
    fx_n = K[0][0] / (2.0 * K[0][2])     # fx in units of image width
    fy_n = K[1][1] / (2.0 * K[1][2])
    x1, y1, x2, y2 = seg["box"]
    u = ((x1 + x2) / 2.0) / seg["w"]
    v = ((y1 + y2) / 2.0) / seg["h"]
    ray_cam = ((u - 0.5) / fx_n, (v - 0.5) / fy_n, 1.0)
    ray = _norm(_rot_transpose_vec(pose["extrinsic"], ray_cam))
    right = _norm(_cross(forward, (0.0, -1.0, 0.0)))
    lateral = sum(ray[i] * right[i] for i in range(3))
    if lateral > SIDE_LATERAL_MIN:
        return "right"
    if lateral < -SIDE_LATERAL_MIN:
        return "left"
    return None


def pose_forward(centers, kept_sorted, k):
    """Walking direction at pose k, from its neighbours on the kept
    polyline (spike poses never steer the direction)."""
    i = kept_sorted.index(k)
    a = centers[kept_sorted[i - 1]] if i > 0 else centers[k]
    b = centers[kept_sorted[i + 1]] if i < len(kept_sorted) - 1 \
        else centers[k]
    return _norm(tuple(b[t] - a[t] for t in range(3)))


# --- clustering -------------------------------------------------------------

def _area_frac(seg):
    x1, y1, x2, y2 = seg["box"]
    return max(0, (x2 - x1 + 1) * (y2 - y1 + 1)) / float(seg["w"]
                                                         * seg["h"])


def _cy(seg):
    return ((seg["box"][1] + seg["box"][3]) / 2.0) / seg["h"]


def _union_box(segs):
    return [min(s["box"][0] for s in segs),
            min(s["box"][1] for s in segs),
            max(s["box"][2] for s in segs),
            max(s["box"][3] for s in segs)]


def _region(members):
    confs = [s["confidence"] for s in members
             if s.get("confidence") is not None]
    return {"box": _union_box(members), "side": members[0]["side"],
            "segments": len(members),
            "cy": sum(_cy(s) for s in members) / len(members),
            "samConfidence": (round(sum(confs) / len(confs), 3)
                              if confs else None),
            "w": members[0]["w"], "h": members[0]["h"]}


def cluster_regions(segments):
    """Cluster SAM segments (each carrying a "side") into shelf
    regions: filtered by size and SAM confidence, grouped by side,
    split into horizontal bands, capped at MAX_REGIONS by merging
    the nearest bands. Deterministic; the result depends only on
    the input list's contents, sorted canonically first."""
    kept = [s for s in segments
            if MIN_AREA_FRAC <= _area_frac(s) <= MAX_AREA_FRAC
            and (s.get("confidence") is None
                 or s["confidence"] >= MIN_SAM_CONFIDENCE)]
    kept.sort(key=lambda s: (str(s["side"]), _cy(s), s["box"]))
    groups = {}
    for s in kept:
        groups.setdefault(s["side"], []).append(s)
    regions = []
    for side in (sorted(groups, key=lambda s: str(s))):
        members = sorted(groups[side], key=_cy)
        band = [members[0]] if members else []
        for s in members[1:]:
            if _cy(s) - _cy(band[-1]) > BAND_GAP:
                regions.append(_region(band))
                band = [s]
            else:
                band.append(s)
        if band:
            regions.append(_region(band))
    while len(regions) > MAX_REGIONS:
        best = None
        for i in range(len(regions)):
            for j in range(i + 1, len(regions)):
                d = abs(regions[i]["cy"] - regions[j]["cy"])
                same = regions[i]["side"] == regions[j]["side"]
                key = (0 if same else 1, d)
                if best is None or key < best[0]:
                    best = (key, i, j)
        _, i, j = best
        merged = dict(regions[i])
        a, b = regions[i], regions[j]
        merged["box"] = [min(a["box"][0], b["box"][0]),
                         min(a["box"][1], b["box"][1]),
                         max(a["box"][2], b["box"][2]),
                         max(a["box"][3], b["box"][3])]
        merged["segments"] = a["segments"] + b["segments"]
        merged["cy"] = (a["cy"] * a["segments"]
                         + b["cy"] * b["segments"]) / merged["segments"]
        confs = [c for c in (a["samConfidence"], b["samConfidence"])
                 if c is not None]
        merged["samConfidence"] = (round(sum(confs) / len(confs), 3)
                                   if confs else None)
        regions = [r for n, r in enumerate(regions) if n not in (i, j)]
        regions.append(merged)
    regions.sort(key=lambda r: (str(r["side"]), r["cy"]))
    return regions


# --- Spark labelling ---------------------------------------------------------

def _crop_jpeg(frame_bytes, box, w, h):
    from PIL import Image
    img = Image.open(io.BytesIO(frame_bytes)).convert("RGB")
    pad_x = int(0.08 * (box[2] - box[0] + 1))
    pad_y = int(0.12 * (box[3] - box[1] + 1))
    crop = img.crop((max(0, box[0] - pad_x), max(0, box[1] - pad_y),
                     min(w, box[2] + 1 + pad_x),
                     min(h, box[3] + 1 + pad_y)))
    if crop.width > LABEL_MAX_WIDTH:
        crop = crop.resize((LABEL_MAX_WIDTH,
                            max(1, int(crop.height * LABEL_MAX_WIDTH
                                       / crop.width))))
    buf = io.BytesIO()
    crop.save(buf, "JPEG", quality=82)
    return buf.getvalue()


_LABEL_JSON_RE = re.compile(r"\{.*\}", re.S)


def parse_label_reply(text):
    """(label, confidence) from Spark's reply; (None, None) when the
    reply does not carry a usable label — the caller keeps the raw
    wording and never invents one."""
    if not text:
        return None, None
    m = _LABEL_JSON_RE.search(text)
    if not m:
        return None, None
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return None, None
    label = data.get("label")
    conf = data.get("confidence")
    if not isinstance(label, str) or not label.strip():
        return None, None
    if conf not in ("high", "medium", "low"):
        conf = None
    return label.strip(), conf


def label_region(frame_bytes, region, spend):
    """One Spark 1.3 Standard call on the region crop. Returns
    {label, labelConfidence, rawLabel} — label is None when the
    reply could not be parsed; rawLabel always carries the model's
    own wording (or the error)."""
    spend.check(0.02)   # worst-case guard; actuals are far below
    crop = _crop_jpeg(frame_bytes, region["box"], region["w"],
                      region["h"])
    uri = "data:image/jpeg;base64," + base64.b64encode(crop).decode()
    body = {"model": "muse-spark-1.3", "temperature": 0.1,
            "reasoning_effort": "low",
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": LABEL_INSTRUCTION},
                {"type": "image_url",
                 "image_url": {"url": uri}}]}]}
    status, payload = api_call("/v1/chat/completions", body)
    if status != 200:
        return {"label": None, "labelConfidence": None,
                "rawLabel": f"HTTP {status}"}
    text = payload["choices"][0]["message"]["content"]
    u = payload.get("usage") or {}
    usage = {"input_tokens": u.get("prompt_tokens",
                                   u.get("input_tokens", 0)),
             "cached_tokens": (u.get("prompt_tokens_details")
                               or {}).get("cached_tokens", 0),
             "output_tokens": u.get("completion_tokens",
                                    u.get("output_tokens", 0))}
    spend.add_spark(usage)
    label, conf = parse_label_reply(text)
    return {"label": label, "labelConfidence": conf, "rawLabel": text}


# --- graph assembly -----------------------------------------------------------

def build_graph(store, frame_entries, path_length, run_report):
    """Assemble the shelf-graph document from per-frame results.
    frame_entries: [{frame, pose, u, shelves: [region+label dicts]}].
    Stops are sorted by u; each stop is one frame's path position
    with the shelf labels observed there."""
    stops = []
    for e in sorted(frame_entries, key=lambda e: e["u"]):
        shelves = []
        for r in sorted(e["shelves"],
                        key=lambda r: (str(r["side"]), r["box"][1])):
            shelves.append({
                "side": r["side"],
                "label": r.get("label"),
                "rawLabel": r.get("rawLabel"),
                "labelConfidence": r.get("labelConfidence"),
                "samConfidence": r.get("samConfidence"),
                "box": r["box"],
                "imageSize": [r["w"], r["h"]],
                "segments": r["segments"],
            })
        stops.append({"u": round(e["u"], 4),
                      "dist": round(e["u"] * path_length, 3),
                      "frame": e["frame"], "pose": e["pose"],
                      "shelves": shelves})
    return {"store": store, "kind": "shelf-graph", "version": 1,
            "source": {"segmentationModel": "sam-3.1",
                       "labelModel": "muse-spark-1.3",
                       "prompts": PROMPTS},
            "pathLength": path_length,
            "stops": stops,
            "run": run_report}


# --- the live run ---------------------------------------------------------------

def run(frames_dir, poses_path, model_dir, store, every, max_spend):
    with open(poses_path) as f:
        poses = json.load(f)
    with open(os.path.join(model_dir, "manifest.json")) as f:
        manifest = json.load(f)
    path_length = manifest["pathStats"]["length"]
    fracs = path_fractions(poses)
    prep = _load_prep()
    centers = prep._centers(poses)
    spend = Spend(max_spend)
    total_segments = 0
    chosen = [k for k in range(0, len(poses), every) if k in fracs]
    print(f"shelf graph: {len(chosen)} frames "
          f"(every {every}th pose), cap ${max_spend:.2f}")
    entries = []
    for k in chosen:
        pose = poses[k]
        frame_path = os.path.join(frames_dir, pose["frame"])
        with open(frame_path, "rb") as f:
            frame_bytes = f.read()
        segments = []
        for prompt in PROMPTS:
            segs = sam_segment(frame_bytes, prompt, spend)
            for s in segs:
                s["prompt"] = prompt
            segments.extend(segs)
        total_segments += len(segments)
        fwd = pose_forward(centers, sorted(fracs), k)
        for s in segments:
            s["side"] = segment_side(s, pose, fwd)
        regions = cluster_regions(segments)
        with ThreadPoolExecutor(max_workers=4) as pool:
            labels = list(pool.map(
                lambda r: label_region(frame_bytes, r, spend),
                regions))
        shelves = []
        for region, lab in zip(regions, labels):
            region.update(lab)
            shelves.append(region)
        entries.append({"frame": pose["frame"], "pose": k,
                        "u": fracs[k], "shelves": shelves})
        print(f"  {pose['frame']} u={fracs[k]:.3f}: "
              f"{len(segments)} segments -> {len(regions)} regions, "
              f"spend ${spend.total:.4f}")
    report = spend.report()
    report["frames"] = len(chosen)
    report["segments"] = total_segments
    report["regions"] = sum(len(e["shelves"]) for e in entries)
    graph = build_graph(store, entries, path_length, report)
    out = os.path.join(model_dir, "shelf-graph.json")
    with open(out, "w") as f:
        json.dump(graph, f, indent=1)
    print(f"wrote {out}: {len(graph['stops'])} stops, "
          f"{report['regions']} labelled regions")
    print(f"spend: SAM {report['samImages']} images "
          f"${report['costUsd']['sam']:.4f} + Spark "
          f"{report['sparkCalls']} calls ${report['costUsd']['spark']:.4f} "
          f"= ${report['costUsd']['total']:.4f}")
    return graph


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--frames", required=True,
                    help="directory of walkthrough frames")
    ap.add_argument("--poses", required=True, help="poses.json")
    ap.add_argument("--model-dir", required=True,
                    help="store model dir (holds manifest.json)")
    ap.add_argument("--store", default="trader-joes")
    ap.add_argument("--every", type=int, default=5,
                    help="use every Nth pose (default 5)")
    ap.add_argument("--max-spend", type=float, default=2.00,
                    help="hard USD cap for the run (default 2.00)")
    args = ap.parse_args(argv)
    run(args.frames, args.poses, args.model_dir, args.store,
        args.every, args.max_spend)
    return 0


if __name__ == "__main__":
    sys.exit(main())
