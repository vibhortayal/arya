"""Build the synthetic demo household (owner decision 2026-10-27: BOTH —
the owner's real data stays private; judges get a synthetic household).
Deterministic, no model calls, $0. Writes receipts.json + dictionary.json
into <data_dir>/users/demo/. The household is fictional: the Sharma family,
two stores, weekly Saturday trips, May-Oct 2026. Designed outcomes:
milk/spinach/bread due at the last trip, a returned chicken netted in the
ledger, one FOR-OTHERS gift card, one folded discount. Bulk staples
(eggs, rice, paper towels, batteries) come from a same-day Costco run,
so Plan a hunt can show "usually from Costco" (owner, 2026-10-28)."""
import json, os, sys
from datetime import date, timedelta

ITEMS = {
    # sku suffix: (name, price, every-N-trips on the weekly run, qty)
    "milk": ("Whole Milk 1 gal", 4.29, 1, 1),
    "eggs": ("Pasture Eggs 12 ct", 6.49, 2, 1),       # ~14d gaps
    "spinach": ("Baby Spinach 16 oz", 3.99, 2, 1),
    "yogurt": ("Greek Yogurt 32 oz", 5.79, 2, 1),
    "coffee": ("Coffee Beans 12 oz", 11.99, 3, 1),
    "rice": ("Jasmine Rice 10 lb", 13.49, 6, 1),
    "pasta": ("Pasta 1 lb", 1.79, 2, 2),
    "chicken": ("Chicken Breast", 12.30, 2, 1),
    "bread": ("Sourdough Loaf", 4.99, 1, 1),
    "bananas": ("Bananas", 2.10, 1, 1),
    "papertowel": ("Paper Towels 6 ct", 9.99, 4, 1),
    "batteries": ("AA Batteries 8 ct", 8.99, 8, 1),
    "avocado": ("Avocados 4 ct", 5.49, 2, 1),
}


# Bought at Costco on the same Saturday (owner, 2026-10-28: "my milk is
# typically bought from TJ, eggs from costco"). One eggs trip stays at
# the grocery store, so the pattern reads "Costco, most of the time".
COSTCO = {"eggs", "rice", "papertowel", "batteries"}
EGGS_AT_GROCERY_TRIP = 10


def line(sku_key, price=None, qty=None, ltype="item", total=None, alloc="HOUSEHOLD", parent=None):
    name, p, _n, q = ITEMS[sku_key]
    qty = qty if qty is not None else q
    price = price if price is not None else p
    return {"raw": name.upper(), "detail": None, "sku": f"demo-{sku_key}",
            "decoded_name": name, "qty": qty, "unit_price": price,
            "line_total": total if total is not None else round(price * qty, 2),
            "line_type": ltype, "discount_parent_sku": parent,
            "confidence": 1.0, "status": "auto", "allocation": alloc,
            "for_person": None, "item_id": f"demo-{sku_key}", "judge_agree": None}


def receipt(rid, merchant, day, lines):
    subtotal = round(sum(l["line_total"] for l in lines), 2)
    return {"receipt_id": rid, "source_type": "grocery", "merchant": merchant,
            "purchased_at": day.isoformat(), "lines": lines,
            "subtotal": subtotal, "tax": 0.0, "total": subtotal,
            "totals_reconcile": True, "image_ref": None}


def build():
    receipts = []
    start = date(2026, 5, 2)          # first Saturday
    trips = 26                        # Saturdays through Oct 24, 2026
    for t in range(trips):
        day = start + timedelta(days=7 * t)
        merchant = "Trader Joe's" if t % 3 else "Safeway"
        lines, bulk = [], []
        for key, (_name, _p, every, _q) in ITEMS.items():
            if t % every != 0:
                continue
            if t == trips - 1 and key not in ("eggs", "bananas", "coffee"):
                continue              # the last trip is small: staples lapse -> due
            costco = key in COSTCO and not (key == "eggs" and t == EGGS_AT_GROCERY_TRIP)
            (bulk if costco else lines).append(line(key))
        if t == 8:                    # one folded discount on spinach
            lines.append(line("spinach", ltype="discount", total=-1.00, parent="demo-spinach"))
        if t == 12:                   # a gift card for someone else
            lines.append({"raw": "GIFT CARD $25", "detail": None, "sku": "demo-giftcard",
                          "decoded_name": "Gift Card $25", "qty": 1, "unit_price": 25.0,
                          "line_total": 25.0, "line_type": "item", "discount_parent_sku": None,
                          "confidence": 1.0, "status": "auto", "allocation": "FOR-OTHERS",
                          "for_person": None, "item_id": "demo-giftcard", "judge_agree": None})
        receipts.append(receipt(f"demo-r{t:02d}", merchant, day, lines))
        if bulk:
            receipts.append(receipt(f"demo-c{t:02d}", "Costco", day, bulk))
    # The returned chicken: bought Oct 3 (trip 22 is Sep 26; trip 23 = Oct 3), returned Oct 5.
    receipts.append(receipt("demo-ret1", "Trader Joe's", date(2026, 10, 5),
                            [line("chicken", ltype="return", total=-12.30)]))
    dictionary = {"version": 1, "entries": [
        {"item_id": f"demo-{k}", "sku": f"demo-{k}", "canonical_name": v[0],
         "kind": "product", "category": None, "aliases": [], "spoken_names": [],
         "typical_unit": None, "sam_concept": None, "detail_variants": [],
         "purchase_count": 0, "median_price": v[1], "first_seen": None, "last_seen": None,
         "resolution": {"status": "auto", "confidence": None, "candidates": []}}
        for k, v in ITEMS.items()] + [
        {"item_id": "demo-giftcard", "sku": "demo-giftcard", "canonical_name": "Gift Card $25",
         "kind": "product", "category": None, "aliases": [], "spoken_names": [],
         "typical_unit": None, "sam_concept": None, "detail_variants": [],
         "purchase_count": 0, "median_price": 25.0, "first_seen": None, "last_seen": None,
         "resolution": {"status": "auto", "confidence": None, "candidates": []}}]}
    return receipts, dictionary


def main(out_root):
    receipts, dictionary = build()
    dest = os.path.join(out_root, "users", "demo")
    os.makedirs(dest, exist_ok=True)
    json.dump(receipts, open(os.path.join(dest, "receipts.json"), "w"), indent=1)
    json.dump(dictionary, open(os.path.join(dest, "dictionary.json"), "w"), indent=1)
    judged = {
        "demo-milk": {"class": "STAPLE", "list_ok": True, "reason": "weekly household staple", "buys": 5},
        "demo-bread": {"class": "STAPLE", "list_ok": True, "reason": "weekly household staple", "buys": 4},
        "demo-spinach": {"class": "STAPLE", "list_ok": True, "reason": "regular weekly greens", "buys": 3},
        "demo-yogurt": {"class": "OCCASIONAL", "list_ok": False, "reason": "bought a few times a year", "buys": 3},
    }
    json.dump(judged, open(os.path.join(dest, "judged.json"), "w"), indent=1)
    print(f"demo household: {len(receipts)} receipts -> {dest}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ARYA_DATA_DIR", "data"))
