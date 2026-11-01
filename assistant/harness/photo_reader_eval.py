#!/usr/bin/env python3
"""Does the arithmetic gate make Spark-first safe? (ARYA_PHOTO_READER=auto)

Two modes.

  python3 -m harness.photo_reader_eval --synthetic
      Offline, no key. Takes the golden receipts, injects price errors
      (a misread digit, two prices swapped, a dropped line) and reports how
      many of each the checks in api/decode/checks.py flag. This measures
      the CHECKS, not Spark.

  python3 -m harness.photo_reader_eval --photos DIR
      Live, needs MODEL_API_KEY. DIR holds receipt photos. Each is read by
      Spark and by Wonder through the app's own decode path; prints, per
      photo, the lines whose price differs between the two readers, whether
      the gate flagged the Spark read, and the cost of each. Wonder is the
      reference (97/98 hand-adjudicated in the Gate 0 eval); disagreements
      still need a human look at the photo. The pass bar is: every price
      that differs is on a flagged receipt.
"""
import copy, glob, json, os, random, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from api.decode import checks, service


def _golden():
    out = []
    for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "golden", "synthetic-costco-receipt.json"))):
        rec = service.normalize_costco_json(json.load(open(f)))
        for l in rec["lines"]:
            l["confidence"] = 0.95
        rec["lines"] = [l for l in rec["lines"] if l.get("line_type", "item") == "item"
                        and not (l.get("raw") or "").startswith("/")]
        rec["subtotal"] = round(sum(l["line_total"] for l in rec["lines"]), 2)
        rec["tax"] = 0.0
        rec["total"] = rec["subtotal"]
        rec["totals_reconcile"] = True
        out.append(rec)
    return out


def _mutate(rec, kind, rng):
    r = copy.deepcopy(rec)
    ls = r["lines"]
    i = rng.randrange(len(ls))
    if kind == "digit":
        p = ls[i]["line_total"]
        ls[i]["line_total"] = round(p + rng.choice([1, 10, -1, 0.9, 5.0]) if p > 2 else p + 10, 2)
    elif kind == "swap":
        j = (i + 1 + rng.randrange(len(ls) - 1)) % len(ls)
        if ls[i]["line_total"] == ls[j]["line_total"]:
            return None
        ls[i]["line_total"], ls[j]["line_total"] = ls[j]["line_total"], ls[i]["line_total"]
    elif kind == "dropped":
        ls.pop(i)
    r["totals_reconcile"] = abs(sum(l["line_total"] for l in ls) - r["subtotal"]) <= 0.05
    return r


def synthetic(n=300, seed=7):
    rng = random.Random(seed)
    base = _golden()
    # price history as the app would hold it: every item number seen before
    known = {}
    for rec in base:
        for l in rec["lines"]:
            known.setdefault(str(l["sku"]), []).append(l["line_total"])
    print(f"{len(base)} golden receipt(s), {sum(len(r['lines']) for r in base)} lines")
    for kind in ("digit", "swap", "dropped"):
        for hist in (False, True):
            hit = tot = 0
            for _ in range(n):
                m = _mutate(rng.choice(base), kind, rng)
                if m is None:
                    continue
                tot += 1
                hit += bool(checks.validate(m, known if hist else None))
            print(f"{kind:8s} history={'on ' if hist else 'off'} flagged {hit}/{tot}")
    clean = sum(bool(checks.validate(r, None)) for r in base)
    print(f"clean receipts wrongly flagged: {clean}/{len(base)}")


def photos(d):
    from api import deps
    from api.meta_client import MetaClient
    client = MetaClient(ledger=None)
    exts = ("*.jpg", "*.jpeg", "*.png", "*.webp")
    files = sorted(f for e in exts for f in glob.glob(os.path.join(d, e)))
    wrong = flagged_wrong = 0
    for f in files:
        data = open(f, "rb").read()
        mt = "image/png" if f.endswith(".png") else "image/webp" if f.endswith(".webp") else "image/jpeg"
        os.environ["ARYA_PHOTO_READER"] = "spark"
        sp = service.decode_photo(data, client, mt)
        os.environ["ARYA_PHOTO_READER"] = "wonder"
        wo = service.decode_photo(data, client, mt)
        reasons = checks.validate(sp, None)
        diff = []
        if len(sp["lines"]) == len(wo["lines"]):
            diff = [(a["decoded_name"], a["line_total"], b["line_total"])
                    for a, b in zip(sp["lines"], wo["lines"]) if a["line_total"] != b["line_total"]]
        else:
            diff = [("line count", len(sp["lines"]), len(wo["lines"]))]
        wrong += len(diff)
        if diff and reasons:
            flagged_wrong += len(diff)
        print(f"{os.path.basename(f)}: spark!=wonder on {len(diff)} price(s); gate: {reasons or 'passed'}")
        for x in diff:
            print("   ", x)
    print(f"{wrong} differing prices, {flagged_wrong} on flagged receipts, "
          f"{wrong - flagged_wrong} on receipts the gate let through")


if __name__ == "__main__":
    if "--synthetic" in sys.argv:
        synthetic()
    elif "--photos" in sys.argv:
        photos(sys.argv[sys.argv.index("--photos") + 1])
    else:
        print(__doc__)
