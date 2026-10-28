#!/usr/bin/env python3
"""build_localizer_index — build the shipped localizer index
artifact for a mapped store (localizer integration).

Runs Wonder's index build (api/localizer.py, vendored verbatim
from the localizer spike) over the store's walkthrough frames,
then — in the BUILD step only, never in the matcher — subsamples
descriptors per frame so the artifact stays shippable, and saves
it compressed. Whether the subsample holds is not assumed:
tools/eval_localizer.py re-runs the spike's held-out eval against
the shipped artifact, and the numbers are recorded in the loops
log next to the spike's.

Usage:
  python3 tools/build_localizer_index.py \
      [--frames ~/workspace/arya-3d/frames90] \
      [--out models/trader-joes/localizer-index.npz] \
      [--max-per-frame 400]     # 0 = keep every descriptor
"""
import argparse, json, os, sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import numpy as np  # noqa: E402

from api import localizer  # noqa: E402

SEED = 20261027

SPIKE = {"heldout_frames": 45, "stop_accuracy": "42/45",
         "neighborhood_accuracy": "45/45", "median_abs_du": 0.00268,
         "latency_s": "1.3-1.6", "source": "arya-3d/localize-spike/REPORT.md"}


def subsample(data, cap, seed=SEED):
    """Per frame, keep a deterministic seeded subset of the
    descriptors (and their keypoints) — build-step only."""
    counts = data["counts"]
    if cap <= 0 or int(counts.max()) <= cap:
        return data, False
    desc, kps = data["descriptors"], data["keypoints"]
    parts_d, parts_k, new_counts = [], [], []
    offset = 0
    for i, count in enumerate(counts):
        count = int(count)
        if count > cap:
            rng = np.random.default_rng(seed + i)
            keep = np.sort(rng.choice(count, size=cap, replace=False))
        else:
            keep = np.arange(count)
        parts_d.append(desc[offset + keep])
        parts_k.append(kps[offset + keep])
        new_counts.append(len(keep))
        offset += count
    new_counts = np.asarray(new_counts, dtype=np.int64)
    offsets = np.zeros(len(new_counts) + 1, dtype=np.int64)
    np.cumsum(new_counts, out=offsets[1:])
    out = dict(data)
    out["descriptors"] = np.concatenate(parts_d, axis=0)
    out["keypoints"] = np.concatenate(parts_k, axis=0)
    out["counts"] = new_counts
    out["offsets"] = offsets
    out["owner"] = np.repeat(np.arange(len(new_counts), dtype=np.int32),
                             new_counts)
    return out, True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default="/home/hatch/workspace/arya-3d/frames90")
    ap.add_argument("--out", default=localizer.DEFAULT_INDEX_PATH)
    ap.add_argument("--max-per-frame", type=int, default=400)
    args = ap.parse_args()

    tmp = args.out + ".full.npz"
    localizer.build_index(args.frames, tmp)
    with np.load(tmp, allow_pickle=False) as z:
        data = {k: z[k] for k in z.files}
    os.unlink(tmp)

    data, did_sub = subsample(data, args.max_per_frame)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "wb") as fh:
        np.savez_compressed(fh, **data)

    manifest = {
        "frames": int(len(data["frames"])),
        "descriptors": int(data["descriptors"].shape[0]),
        "max_per_frame": args.max_per_frame if did_sub else None,
        "built": date.today().isoformat(),
        "matcher": "api/localizer.py (Muse Wonder 1.0, localizer spike round 1)",
        "spike_eval": SPIKE,
    }
    mpath = os.path.join(os.path.dirname(os.path.abspath(args.out)),
                         "localizer-manifest.json")
    with open(mpath, "w") as fh:
        json.dump(manifest, fh, indent=2)
    size = os.path.getsize(args.out)
    print(json.dumps({"index": args.out, "bytes": size,
                      "manifest": mpath, **manifest}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
