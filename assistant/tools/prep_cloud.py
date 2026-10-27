#!/usr/bin/env python3
"""prep_cloud — turn a VGGT reconstruction into a web-weight asset for
the Arya Quest "cloud" SceneDriver (assistant/pwa/scene.js).

Inputs are the spike outputs (kept outside this repo, in the workspace
arya-3d area): a binary PLY point cloud (float xyz + uchar rgb, the
VGGT export layout) and poses.json (per-frame extrinsic/intrinsic).
The master PLY is never modified.

Outputs, written to assistant/pwa/models/<store-slug>/:

  cloud.bin     positions (uint16 x3 per point, quantized against the
                bounds in the manifest) then colors (uint8 x3).
                9 bytes per point: ~400k points is ~3.6 MB.
  manifest.json point count, byte layout, bounds, and the camera
                path: outlier poses removed, resampled, smoothed, so
                the driver's glideTo never lurches.

All coordinates in the outputs are in the driver's space (Three.js,
Y-up): three = (x, -y, -z) of the VGGT world frame, applied here so
the driver only dequantizes.

Pure standard library — no numpy on the build path.

Usage:
  python3 tools/prep_cloud.py --ply ../../arya-3d/vggt-out/scene.ply \
      --poses ../../arya-3d/vggt-out/poses.json \
      --store trader-joes --out pwa/models/trader-joes
"""
import argparse, json, math, os, struct, sys
from array import array

TARGET_POINTS = 400_000
MIN_POINTS, MAX_POINTS = 300_000, 500_000
PATH_SPACING = 0.055      # arc-length step of the resampled walk path
PATH_MAX_STEP = 0.12      # the shipped path never steps farther than this
SPIKE_FLOOR = 0.30        # a pose farther than this from the line
                          # between its neighbours is a spike


# --- PLY -----------------------------------------------------------------

_PLY_SIZES = {"float": 4, "float32": 4, "double": 8, "float64": 8,
              "uchar": 1, "uint8": 1, "char": 1, "int8": 1,
              "ushort": 2, "uint16": 2, "short": 2, "int16": 2,
              "int": 4, "int32": 4, "uint": 4, "uint32": 4}


def read_ply(path):
    """Read a binary little-endian PLY with float xyz + uchar rgb
    vertex properties (the VGGT export). Returns (positions, colors)
    as flat arrays in the driver's space: (x, -y, -z)."""
    with open(path, "rb") as f:
        raw = f.read()
    nl = raw.index(b"end_header")
    header = raw[:nl].decode("ascii", "replace")
    body = raw[nl + len(b"end_header") + 1:]
    if "binary_little_endian" not in header:
        raise ValueError("PLY is not binary_little_endian")
    count, props = None, []
    in_vertex = False
    for line in header.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "element":
            in_vertex = parts[1] == "vertex"
            if in_vertex:
                count = int(parts[2])
        elif parts[0] == "property" and in_vertex:
            props.append((parts[1], parts[2]))
    if count is None:
        raise ValueError("PLY has no vertex element")
    offsets, off = {}, 0
    for typ, name in props:
        offsets[name] = (off, typ)
        off += _PLY_SIZES[typ]
    stride = off
    for name, want in (("x", "float"), ("y", "float"), ("z", "float"),
                       ("red", "uchar"), ("green", "uchar"),
                       ("blue", "uchar")):
        if name not in offsets or offsets[name][1] != want:
            raise ValueError(f"PLY vertex property {name!r} missing or "
                             f"not {want} — unsupported layout")
    pos, col = array("f"), array("B")
    xo, yo, zo = offsets["x"][0], offsets["y"][0], offsets["z"][0]
    ro, go, bo = offsets["red"][0], offsets["green"][0], offsets["blue"][0]
    unpack = struct.Struct("<f").unpack_from
    for i in range(count):
        base = i * stride
        # VGGT world (x right, y down, z forward) -> Three (Y-up).
        pos.append(unpack(body, base + xo)[0])
        pos.append(-unpack(body, base + yo)[0])
        pos.append(-unpack(body, base + zo)[0])
        col.append(body[base + ro])
        col.append(body[base + go])
        col.append(body[base + bo])
    return pos, col


def bounds_of(pos):
    mn = [min(pos[i::3]) for i in range(3)]
    mx = [max(pos[i::3]) for i in range(3)]
    return mn, mx


# --- decimation ------------------------------------------------------------

def _voxel_keep(pos, n, edge):
    """Indices of the first point in each voxel cell of the given edge."""
    inv = 1.0 / edge
    seen, keep = set(), []
    for i in range(n):
        key = (int(pos[3 * i] * inv), int(pos[3 * i + 1] * inv),
               int(pos[3 * i + 2] * inv))
        if key not in seen:
            seen.add(key)
            keep.append(i)
    return keep


def decimate(pos, col, target=TARGET_POINTS):
    """Voxel-downsample to roughly `target` points. Returns
    (positions, colors) as new flat arrays."""
    n = len(pos) // 3
    if n <= target:
        return pos, col
    mn, mx = bounds_of(pos)
    span = max(mx[i] - mn[i] for i in range(3)) or 1.0
    lo, hi = span / 2000.0, span / 10.0     # edge search bracket
    keep = None
    for _ in range(24):
        edge = (lo + hi) / 2.0
        keep = _voxel_keep(pos, n, edge)
        if len(keep) > target:
            lo = edge
        elif len(keep) < target * 0.92:
            hi = edge
        else:
            break
    if len(keep) > MAX_POINTS:              # stride-thin into the band
        step = len(keep) / float(MAX_POINTS)
        keep = [keep[int(k * step)] for k in range(MAX_POINTS)]
    out_pos, out_col = array("f"), array("B")
    for i in keep:
        out_pos.extend(pos[3 * i:3 * i + 3])
        out_col.extend(col[3 * i:3 * i + 3])
    return out_pos, out_col


# --- camera path -----------------------------------------------------------

def _centers(poses):
    """Camera centers from world->camera extrinsics: C = -R^T t."""
    out = []
    for p in poses:
        e = p["extrinsic"]
        t = (e[0][3], e[1][3], e[2][3])
        out.append(tuple(-(e[0][i] * t[0] + e[1][i] * t[1] + e[2][i] * t[2])
                         for i in range(3)))
    return out


def _dist(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def _median(xs):
    s = sorted(xs)
    return s[len(s) // 2] if s else 0.0


def drop_outlier_poses(centers):
    """Remove mislocalized poses. A pose is a spike when it sits far
    off the line between its neighbours AND the path through it is
    much longer than the direct line (it jumped out and came back).
    Both tests together are the spike signature in the spike data
    (poses 19 and 59 deviate ~1.0 from their neighbour line).

    A large step alone is NOT evidence: the walk has genuine fast
    stretches, and VGGT's local scale drifts between aisle legs, so
    step-magnitude rules cascade and eat good path (two earlier
    versions of this function did exactly that). Residual gaps after
    spike removal are interpolated by the resample in smooth_path —
    the glide crosses them at walking speed, never by teleport."""
    kept = list(range(len(centers)))
    while len(kept) > 12:
        pts = [centers[i] for i in kept]
        steps = [_dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        med = _median(steps) or 0.05
        floor = max(SPIKE_FLOOR, 2.5 * med)
        worst, worst_dev = None, floor
        for i in range(1, len(pts) - 1):
            mid = tuple((pts[i - 1][k] + pts[i + 1][k]) / 2.0
                        for k in range(3))
            dev = _dist(pts[i], mid)
            via = steps[i - 1] + steps[i]
            direct = _dist(pts[i - 1], pts[i + 1])
            if dev > worst_dev and direct < 0.75 * via:
                worst, worst_dev = i, dev
        if worst is None:
            break
        kept.pop(worst)
    return kept


def smooth_path(centers, kept, spacing=PATH_SPACING):
    """Resample the kept polyline by arc length, smooth it, and emit
    driver-space samples [{p, f}] (position + forward). Raises if the
    result still steps farther than PATH_MAX_STEP."""
    pts = [centers[i] for i in kept]
    # Resample by arc length.
    samples = [pts[0]]
    acc, target = 0.0, spacing
    for a, b in zip(pts, pts[1:]):
        seg = _dist(a, b)
        while acc + seg >= target:
            t = (target - acc) / seg if seg else 0.0
            samples.append(tuple(a[k] + (b[k] - a[k]) * t for k in range(3)))
            target += spacing
        acc += seg
    if _dist(samples[-1], pts[-1]) > 1e-6:
        samples.append(pts[-1])
    # Moving-average smoothing (two passes, window 5); endpoints stay.
    for _ in range(2):
        sm = [samples[0]]
        for i in range(1, len(samples) - 1):
            lo = max(0, i - 2)
            hi = min(len(samples), i + 3)
            sm.append(tuple(sum(samples[j][k] for j in range(lo, hi))
                            / (hi - lo) for k in range(3)))
        sm.append(samples[-1])
        samples = sm
    out, max_step = [], 0.0
    for i, s in enumerate(samples):
        a = samples[max(0, i - 1)]
        b = samples[min(len(samples) - 1, i + 1)]
        fwd = tuple(b[k] - a[k] for k in range(3))
        norm = math.sqrt(sum(v * v for v in fwd)) or 1.0
        fwd = tuple(v / norm for v in fwd)
        # Driver space: (x, -y, -z).
        out.append({"p": [round(s[0], 5), round(-s[1], 5),
                          round(-s[2], 5)],
                    "f": [round(fwd[0], 5), round(-fwd[1], 5),
                          round(-fwd[2], 5)]})
        if i:
            max_step = max(max_step, _dist(samples[i - 1], s))
    if max_step > PATH_MAX_STEP:
        raise ValueError(f"smoothed path still steps {max_step:.3f} "
                         f"> {PATH_MAX_STEP}")
    length = sum(_dist(samples[i - 1], samples[i])
                 for i in range(1, len(samples)))
    return out, max_step, length


def build_path(poses):
    centers = _centers(poses)
    kept = drop_outlier_poses(centers)
    dropped = [i for i in range(len(poses)) if i not in set(kept)]
    pts = [centers[i] for i in kept]
    max_gap = max((_dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)),
                  default=0.0)
    samples, max_step, length = smooth_path(centers, kept)
    stats = {"posesIn": len(poses), "droppedPoses": dropped,
             "samples": len(samples), "maxStep": round(max_step, 4),
             "length": round(length, 3), "maxGap": round(max_gap, 3)}
    return samples, stats


# --- build -----------------------------------------------------------------

def build(ply_path, poses_path, out_dir, store, target=TARGET_POINTS):
    pos, col = read_ply(ply_path)
    in_points = len(pos) // 3
    pos, col = decimate(pos, col, target)
    n = len(pos) // 3
    mn, mx = bounds_of(pos)
    q = array("H")
    for i in range(n):
        for k in range(3):
            span = mx[k] - mn[k]
            v = 0 if span == 0 else int(
                round((pos[3 * i + k] - mn[k]) / span * 65535.0))
            q.append(max(0, min(65535, v)))
    if sys.byteorder != "little":
        q.byteswap()
    pos_bytes = q.tobytes()
    blob = bytearray(pos_bytes)
    blob.extend(col.tobytes())
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "cloud.bin"), "wb") as f:
        f.write(blob)
    with open(poses_path) as f:
        poses = json.load(f)
    path, path_stats = build_path(poses)
    manifest = {
        "store": store,
        "renderer": "vggt-1b",
        "points": n,
        "bin": "cloud.bin",
        "layout": {"order": ["position", "color"],
                   "positionType": "uint16", "colorType": "uint8",
                   "positionBytes": len(pos_bytes),
                   "colorBytes": len(col)},
        "bounds": {"min": [round(v, 5) for v in mn],
                   "max": [round(v, 5) for v in mx]},
        "path": path,
        "pathStats": path_stats,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    return {"pointsIn": in_points, "points": n, "binBytes": len(blob),
            "pathStats": path_stats}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ply", required=True)
    ap.add_argument("--poses", required=True)
    ap.add_argument("--store", required=True, help="store slug")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--target", type=int, default=TARGET_POINTS)
    args = ap.parse_args(argv)
    info = build(args.ply, args.poses, args.out, args.store, args.target)
    print(f"prep_cloud: {info['pointsIn']} in -> {info['points']} points, "
          f"{info['binBytes']} bytes bin")
    ps = info["pathStats"]
    print(f"path: {ps['posesIn']} poses, dropped {ps['droppedPoses']}, "
          f"{ps['samples']} samples, max step {ps['maxStep']}, "
          f"length {ps['length']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
