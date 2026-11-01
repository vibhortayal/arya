#!/usr/bin/env python3
"""Gate 0 PUBLIC set scoring.

Line alignment and identity verdicts were made by hand against the label
files (labels were written BEFORE any decode ran). Identity rule (primary):
a line is correct when the decoded identity (brand + product + detail,
normalized case/spacing/punctuation, token-set comparison, qty/weight
annotation tokens ignored) is the same product as printed — abbreviation
expansions the SYSTEM prompt itself instructs (e.g. Bh -> Boar's Head,
BC -> Betty Crocker, KS -> Kirkland Signature) preserve identity — AND the
paid price is exact. STRICT rule (reported alongside): the normalized
decoded string must equal the printed string as a token set with NO
abbreviation expansion. Item numbers are reported separately and are not
part of either pass mark.
"""
import json, os

base = os.path.expanduser("~/workspace/meta-hackathon-2026/spike2/public-set")

# per receipt: verdicts keyed by label-line index (labelable lines only)
# value: (identity_verdict, strict_correct)  verdict in correct|product_wrong|price_wrong
V = {
 "pub-01": {i: ("correct", i not in (3, 11)) for i in range(13)},          # strict fails: GV expanded x2
 "pub-02": {i: ("correct", i not in (0, 3, 4)) for i in range(10)},        # strict fails: Bh, Olv, Plc/Rst expansions
 "pub-03": {i: ("correct", True) for i in range(12)},
 "pub-04": {**{i: ("correct", i not in (4, 5, 13)) for i in range(27)},    # strict fails: BC x2, SWTHR expansions
            16: ("product_wrong", False),   # SNK FRT/S CHRY48 -> CHRY8
            19: ("product_wrong", False),   # LGE BRWN 8PK -> SPK
            21: ("product_wrong", False),   # M&M 15%FREE 1884 -> 18&4
            24: ("product_wrong", False),   # KBLR. T/HOUSE16BN -> T/HOUSE 168N
            26: ("product_wrong", False)},  # CHEER 96ZPP499 -> 962PP499
 "pub-05": {**{i: ("correct", True) for i in range(13)},
            4: ("price_wrong", False),      # ORANGE JUICE 8.99 -> 3.99
            9: ("price_wrong", False),      # NAPOLITANER 2.99 -> 4.05
            10: ("price_wrong", False)},    # PIZZA POCKETS WITH TOM 4.05 -> 7.99 (3 prices rotated)
 "pub-06": {i: ("correct", True) for i in range(3)},
 "pub-07": {i: ("correct", True) for i in range(2)},
 # pub-08 label entries: idx 1,2,3,11,12 are unreadable; labelable idx below
 "pub-08": {i: ("correct", True) for i in (0, 4, 5, 6, 7, 8, 9, 10)},
 # pub-09 label entries: idx 0,1,12,13,14 unreadable; idx 3 = CRNCHMASTER,
 # correct via the established savings-fold convention (paid 5.99 = 7.99 - 2.00
 # INST SAV, discount carried in the discount field; spike1/spike2 convention)
 "pub-09": {**{i: ("correct", True) for i in (2, 3, 4, 5, 6, 9, 10, 11)},
            7: ("correct", False), 8: ("correct", False)},  # strict fails: KS expanded x2
}
NOTES = {
 "pub-01": "Item number wrong x1 (RED BELL 000000004688KF -> ...4680KF), reported separately. items_sold 14 matches label.",
 "pub-02": "Photo is rotated 90 deg and crumpled; model handled both. Two savings folds (0.50, 0.68) folded correctly. Tax merged 0.46+2.85=3.31. items_sold not printed; model output 10 (line count).",
 "pub-03": "25%-off line decoded as list 9.32 / paid 6.99 / discount 2.33 — textbook fold. items_sold 12 matches label.",
 "pub-04": "Faded dot-matrix vintage receipt. All 5 product errors are digit/code misreads in abbreviated strings; 4 of 5 carried needs_user_check. All prices exact. items_sold not printed; model output 27 (line count).",
 "pub-05": "Three prices rotated across lines (8.99/2.99/4.05 read as 3.99/4.05/7.99); line sum still reconciles because the rotation preserves the total. ORANGE JUICE error was high-confidence (0.9, no check flag). Item numbers wrong x2 (BOUNTY ...81539 -> ...81599; NAPOLITANER 0765600721 -> 07858000721), reported separately. items_sold not printed; model output 14 (qty-aware count).",
 "pub-06": "Clean. items_sold 3 matches label.",
 "pub-07": "Model duplicated the brand token into the product field (schema artifact); token-set identity unaffected.",
 "pub-08": "PARTIAL receipt (bottom out of frame, total null). All 8 labelable lines correct; the 5 label-unreadable lines were also emitted by the model as partial reads with needs_user_check — they are excluded from scoring, not counted as extra lines. Model total 46.45 is the sum of visible lines only.",
 "pub-09": "PARTIAL receipt (bottom out of frame, total null). The 5 label-unreadable lines were emitted as partial reads with needs_user_check — excluded from scoring. Instant-savings line folded into CRNCHMASTER (paid 5.99, discount 2.00). Item numbers: 8 emitted, all correct; SAUERKRAUT number not emitted (printed digits partly covered by thumb).",
}
ITEM_NO = {  # (checked, wrong) where a photo-read reference exists
 "pub-01": (13, 1), "pub-03": (12, 0), "pub-05": (13, 2), "pub-09": (8, 0),
}

receipts, tot_lab, tot_ok, tot_strict = {}, 0, 0, 0
cls = {"product_wrong": 0, "price_wrong": 0, "missed_line": 0, "extra_line": 0}
usage_tot = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
for name in sorted(V):
    lab = json.load(open(f"{base}/labels/{name}.json"))
    res = json.load(open(f"{base}/results/{name}.json"))
    dec = res["decoded"]
    for k in usage_tot:
        usage_tot[k] += res.get("usage", {}).get(k, 0)
    labelable = [i for i, l in enumerate(lab["lines"]) if not l.get("unreadable")]
    unreadable = len(lab["lines"]) - len(labelable)
    ok = sum(1 for i in labelable if V[name][i][0] == "correct")
    strict_ok = sum(1 for i in labelable if V[name][i][0] == "correct" and V[name][i][1])
    errs = [V[name][i][0] for i in labelable if V[name][i][0] != "correct"]
    for e in errs:
        cls[e] += 1
    dsum = round(sum(l["price"] for l in dec["lines"]), 2)
    arith = None
    if lab["total"] is not None:
        arith = abs(dsum - (dec.get("subtotal") if dec.get("subtotal") is not None else dsum)) <= 0.05 \
            and abs(dec.get("total", -999) - lab["total"]) <= 0.005
    receipts[name] = {
        "store_label": lab["store"], "store_decoded": dec.get("store"),
        "lines_labelable": len(labelable), "lines_unreadable_excluded": unreadable,
        "lines_decoded": len(dec["lines"]),
        "lines_correct_identity": ok, "lines_correct_strict": strict_ok,
        "line_errors": errs,
        "decoded_line_sum": dsum, "decoded_subtotal": dec.get("subtotal"),
        "decoded_total": dec.get("total"), "label_total": lab["total"],
        "arithmetic_match": arith,
        "items_sold_label": lab["items_sold"], "items_sold_decoded": dec.get("items_sold"),
        "item_numbers_checked": ITEM_NO.get(name, (0, 0))[0],
        "item_numbers_wrong": ITEM_NO.get(name, (0, 0))[1],
        "notes": NOTES[name],
    }
    tot_lab += len(labelable); tot_ok += ok; tot_strict += strict_ok

owner = {"receipts": 4, "lines": 32, "lines_correct": 32}
out = {
 "public_set": {
   "receipts": len(receipts), "lines_labelable": tot_lab,
   "lines_correct_identity": tot_ok, "accuracy_identity_pct": round(100 * tot_ok / tot_lab, 2),
   "lines_correct_strict": tot_strict, "accuracy_strict_pct": round(100 * tot_strict / tot_lab, 2),
   "error_classes": cls,
   "item_numbers_checked": sum(v[0] for v in ITEM_NO.values()),
   "item_numbers_wrong": sum(v[1] for v in ITEM_NO.values()),
   "arithmetic_matches": sum(1 for r in receipts.values() if r["arithmetic_match"]),
   "arithmetic_scored": sum(1 for r in receipts.values() if r["arithmetic_match"] is not None),
   "usage_tokens": usage_tot,
   "per_receipt": receipts,
 },
 "owner_subset_reference": owner,
 "combined_gate": {
   "lines": owner["lines"] + tot_lab,
   "correct_identity": owner["lines_correct"] + tot_ok,
   "accuracy_identity_pct": round(100 * (owner["lines_correct"] + tot_ok) / (owner["lines"] + tot_lab), 2),
   "correct_strict_if_owner_scored_strict": owner["lines_correct"] + tot_strict,
   "accuracy_strict_pct": round(100 * (owner["lines_correct"] + tot_strict) / (owner["lines"] + tot_lab), 2),
   "gate_mark_pct": 90,
 },
}
json.dump(out, open(f"{base}/results/scores.json", "w"), indent=2)
print(json.dumps({k: out["public_set"][k] for k in
      ("receipts", "lines_labelable", "lines_correct_identity", "accuracy_identity_pct",
       "lines_correct_strict", "accuracy_strict_pct", "error_classes",
       "item_numbers_checked", "item_numbers_wrong", "arithmetic_matches", "arithmetic_scored",
       "usage_tokens")}, indent=2))
print("COMBINED:", json.dumps(out["combined_gate"], indent=2))
