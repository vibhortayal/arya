#!/usr/bin/env python3
"""eval_localizer — the spike's held-out eval, path-adapted to
the vendored matcher + the SHIPPED index artifact.

The eval logic is the spike's eval_localize.py unchanged (same
stops, same metrics); only paths moved: the matcher is
api/localizer.py, the index defaults to the shipped artifact,
and the held-out frames are the spike's (they live outside this
repo — the eval is a build-time proof, not a runtime path).

Usage: python3 tools/eval_localizer.py [--index PATH] [--heldout DIR]
Prints the spike's JSON report shape to stdout.
"""
import argparse, json, os, statistics, sys, time
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from api import localizer  # noqa: E402

STOPS_U = [
    0.0000, 0.0244, 0.0559, 0.0789, 0.2107, 0.2658, 0.3196, 0.3685,
    0.4374, 0.4788, 0.5675, 0.6569, 0.7910, 0.8628, 0.8894, 0.9078,
    0.9421, 0.9784,
]


def _nearest_stop_index(u):
    return min(range(len(STOPS_U)), key=lambda i: (abs(STOPS_U[i] - float(u)), i))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", default=localizer.DEFAULT_INDEX_PATH)
    ap.add_argument("--heldout",
                    required=True)
    args = ap.parse_args()
    heldout = Path(args.heldout)
    manifest = json.loads((heldout / "manifest.json").read_text(encoding="utf-8"))

    per_query = []
    for entry in manifest:
        file_name = str(entry.get("file", ""))
        true_u = float(entry.get("true_u"))
        image_path = heldout / Path(file_name).name
        start = time.perf_counter()
        try:
            result = localizer.match_image(str(image_path), index_path=args.index)
        except Exception:
            result = {"estimated_u": None, "confidence": 0.0, "candidates": []}
        latency = float(time.perf_counter() - start)
        est = result.get("estimated_u")
        estimated_u = float(est) if est is not None else None
        per_query.append({
            "file": file_name, "true_u": true_u,
            "estimated_u": estimated_u,
            "abs_du": (abs(estimated_u - true_u) if estimated_u is not None else None),
            "confidence": float(result.get("confidence") or 0.0),
            "latency_s": latency,
        })

    n = len(per_query)
    report = {
        "n": n,
        "top1_neighborhood_acc": sum(
            1 for q in per_query if q["abs_du"] is not None and q["abs_du"] <= 0.03) / n,
        "top1_stop_acc": sum(
            1 for q in per_query if q["estimated_u"] is not None
            and _nearest_stop_index(q["estimated_u"]) == _nearest_stop_index(q["true_u"])) / n,
        "median_abs_du": float(statistics.median(
            [q["abs_du"] if q["abs_du"] is not None else 1.0 for q in per_query])),
        "mean_latency_s": float(statistics.fmean([q["latency_s"] for q in per_query])),
        "per_query": per_query,
    }
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
