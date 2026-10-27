#!/usr/bin/env python3
"""Eval harness skeleton (IMPLEMENTATION §2.1, §6).
v1: runs the offline arithmetic scorer over golden fixtures. Live prompt
loops (prompt hash, set version, score, cost per attempt) plug in here.
Usage: python3 -m harness.eval_runner [golden_dir]"""
import glob, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from harness.scorers.arithmetic import verify_receipt


def main():
    gdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "golden")
    files = sorted(glob.glob(os.path.join(gdir, "*.json")))
    ok = 0
    for f in files:
        good = verify_receipt(json.load(open(f)))
        ok += good
        print(f"{os.path.basename(f)}: arithmetic={'OK' if good else 'MISMATCH'}")
    print(f"{ok}/{len(files)} fixtures pass")
    return 0 if ok == len(files) else 1


if __name__ == "__main__":
    sys.exit(main())
