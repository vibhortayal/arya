"""Dictionary build — aggregate the corpus into DictionaryEntry records (§3).

Canonical names start deterministic: a conservative abbreviation expansion
of the most common raw description. A model resolution pass (harness) may
upgrade ambiguous entries; it never runs inside this module.
Fee/deposit pseudo-items (CA redemption values) are kind="fee" and are
excluded from patterns by the pattern engine.
"""
import re, statistics
from collections import Counter

FEE_RE = re.compile(r"REDEMP|DEPOSIT|ECO FEE|BAG FEE|\bCRV\b", re.I)

EXPANSIONS = {
    "ORG": "Organic", "ORGNC": "Organic", "KS": "Kirkland Signature",
    "BLUES": "Blueberries", "BLACKBRY": "Blackberries", "STRWBRY": "Strawberries",
    "CHKN": "Chicken", "BRST": "Breast", "THG": "Thighs", "THIGH": "Thighs",
    "BS": "Boneless Skinless", "WHL": "Whole", "GRND": "Ground",
    "PWDR": "Powder", "SLC": "Sliced", "CHX": "Chicken", "VEG": "Vegetable",
    "FRZ": "Frozen", "WHLWHEATROTI": "Whole Wheat Roti",
}


def expand(desc):
    desc = desc.strip("* ").strip()
    toks = [EXPANSIONS.get(t, t.title() if t.isupper() else t) for t in desc.split()]
    return " ".join(toks).strip()


def aggregate(normalized_receipts):
    """Input: DecodedReceipt dicts (decode.service.normalize_costco_json)."""
    by_sku = {}
    for r in normalized_receipts:
        for ln in r["lines"]:
            if ln["line_type"] != "item" or not ln.get("sku"):
                continue
            e = by_sku.setdefault(ln["sku"], {"descs": Counter(), "details": Counter(), "prices": [],
                                              "first": r["purchased_at"], "last": r["purchased_at"]})
            e["descs"][ln["raw"]] += 1
            if ln.get("detail"): e["details"][ln["detail"]] += 1
            if ln["line_total"] > 0:
                e["prices"].append(ln["line_total"])
            e["first"] = min(e["first"], r["purchased_at"])
            e["last"] = max(e["last"], r["purchased_at"])
    entries = []
    for sku, e in by_sku.items():
        top_desc = e["descs"].most_common(1)[0][0]
        kind = "fee" if FEE_RE.search(top_desc) else "product"
        entries.append({
            "item_id": f"costco-{sku}", "sku": sku,
            "canonical_name": expand(top_desc), "kind": kind,
            "category": None, "aliases": sorted(e["descs"]),
            "spoken_names": [], "typical_unit": None, "sam_concept": None,
            "detail_variants": [d for d, _ in e["details"].most_common(3)],
            "purchase_count": sum(e["descs"].values()),
            "median_price": round(statistics.median(e["prices"]), 2) if e["prices"] else None,
            "first_seen": e["first"], "last_seen": e["last"],
            "resolution": {"status": "auto", "confidence": None, "candidates": []}})
    return sorted(entries, key=lambda x: -x["purchase_count"])
