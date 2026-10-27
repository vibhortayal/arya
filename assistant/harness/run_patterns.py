#!/usr/bin/env python3
"""Stage 2 pipeline over the staged corpus: receipts -> ledger -> patterns
-> smart list -> prepared cart. Pure code; $0.
Usage: run_patterns.py <corpus.json> <dictionary.json> <as_of> <out.json>"""
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from api.decode.service import normalize_costco_json
from api.ledger.build import build_ledger
from api.patterns.engine import summarize
from api.list.build import build_list
from api.cart.build import prepare


def main():
    corpus = json.load(open(sys.argv[1]))
    dictionary = json.load(open(sys.argv[2]))
    as_of = sys.argv[3]
    fee_skus = {e["sku"] for e in dictionary["entries"] if e["kind"] == "fee"}
    names = {e["item_id"]: e["canonical_name"] for e in dictionary["entries"]}
    receipts = [normalize_costco_json(r) for r in corpus]
    entries = build_ledger(receipts, fee_skus=fee_skus)
    patterns = summarize(entries, as_of=as_of)
    smart = build_list(patterns)
    cart = prepare(smart, names)
    out = {"as_of": as_of, "ledger_entries": len(entries),
           "patterns_with_history": sum(1 for p in patterns if p["history_state"] == "pattern"),
           "due_count": len(smart["items"]), "smart_list": smart, "cart": cart,
           "top_patterns": patterns[:10]}
    json.dump(out, open(sys.argv[4], "w"), indent=1)
    print(f"ledger={len(entries)} patterns={out['patterns_with_history']} due={len(smart['items'])}")
    for i in smart["items"][:12]:
        print("-", names.get(i["item_id"], i["item_id"]), "|", i["due_reason"])


if __name__ == "__main__":
    main()
