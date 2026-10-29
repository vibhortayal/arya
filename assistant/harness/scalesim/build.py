"""Build the scale-simulator report.

  python -m harness.scalesim.build [--out docs/scale-sim/index.html]

Runs the agent-level simulation at several neighbourhood sizes, combines it
with the measured calibration (calibration.json) and the system model, and
writes one self-contained HTML file with stage buttons and a slider.
SIMULATED data only; reads and writes no real user data.
"""
import argparse
import json
import os
import time

from . import agents, model, world as W

HERE = os.path.dirname(__file__)


def quality(d):
    r = agents.run(d)
    stores = r["stores"]
    segs = {s["name"]: s["segments"] for s in W.STORES}
    weekly = {n: [round(100 * x["coverage"][n]["mapped"] / segs[n]) for x in r["map"]["series"]] for n in stores}
    acc = {n: [x["accuracy"][n] for x in r["map"]["series"]] for n in stores}
    heat_store = max(r["busy"]["heat"], key=lambda n: sum(map(sum, r["busy"]["heat"][n])))
    code = {"unmapped": 0, "mapped": 1, "aging": 2, "stale": 3}
    pr = r["prices"]["series"]
    return {
        "d": d, "users": r["users"], "households": r["households"], "groups": r["groups"],
        "trips": r["trips"], "receipt_lines": r["receipt_lines"], "photos": r["photos"],
        "map": {"weekly": weekly, "accuracy": acc, "spotlight": r["map"]["spotlight"],
                "labels": r["map"]["spotlight_segments"],
                "lapse": [[code[s] for s in wk] for wk in r["map"]["lapse"]],
                "final": r["map"]["final"]},
        "prices": {"weekly_compare": [p["items_with_compare"] for p in pr],
                   "weekly_cells": [p["cells"] for p in pr],
                   "final": pr[-1], "sample": r["prices"]["sample"],
                   "own_compare_pct": r["prices"]["own_compare_pct"],
                   "opted_in": r["prices"]["opted_in_households"], "items": len(W.ITEMS)},
        "busy": {"levels": r["busy"]["levels"], "signal_pct": r["busy"]["signal_pct"],
                 "store": heat_store, "heat": [[round(v, 2) for v in row] for row in r["busy"]["heat"][heat_store]],
                 "hours": r["busy"]["hours"]},
        "low": r["low"], "alerts": r["alerts"],
    }


def build_data(cal):
    grid = {}
    t = time.time()
    for d in model.QUALITY_GRID:
        grid[d] = quality(d)
        print(f"  agents d={d:>6}: {time.time() - t:5.1f}s", flush=True)
    agent_1k = agents.run(1000)
    agent_1k = {k: agent_1k[k] for k in ("users", "households", "trips", "receipt_lines", "photos", "weeks")}
    stages = []
    for n in model.STAGES:
        row = {"users": n, "systems": {}, "grid": {}}
        for preset in model.DENSITIES:
            d = model.density(n, preset)
            row["grid"][preset] = model.nearest_grid(d)
            row["systems"][preset] = model.system(n, preset, cal, agent_1k)
        stages.append(row)
    return {
        "generated_for": "Meta AI Developer Hackathon demo. SIMULATED DATA.",
        "world": {"stores": W.STORES, "items": len(W.ITEMS), "weeks": agents.WEEKS,
                  "assumptions_behaviour": W.ASSUME, "assumptions_system": model.ASSUME},
        "calibration": cal, "densities": model.DENSITIES, "stages": stages,
        "quality": {str(k): v for k, v in grid.items()}, "seed": W.SEED,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "..", "..", "docs", "scale-sim", "index.html"))
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    cal = model.load_cal()
    data = build_data(cal)
    if a.json:
        json.dump(data, open(a.json, "w"))
    tpl = open(os.path.join(HERE, "report.tpl.html")).read()
    html = tpl.replace("/*__DATA__*/null", json.dumps(data, separators=(",", ":")))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    open(a.out, "w").write(html)
    print("wrote", a.out, f"{len(html) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
