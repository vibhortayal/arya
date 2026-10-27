"""Ledger build — DecodedReceipts -> LedgerEntry records (§3).
Prices are net: a discount line folds into its parent item's price.
Returns are their own entries; netting happens in the pattern engine.
Fee-class SKUs never enter the ledger."""
import hashlib


def build_ledger(receipts, fee_skus=frozenset()):
    entries = []
    for r in receipts:
        discounts = {}
        for ln in r["lines"]:
            if ln["line_type"] == "discount" and ln.get("discount_parent_sku"):
                discounts[ln["discount_parent_sku"]] = discounts.get(ln["discount_parent_sku"], 0) + ln["line_total"]
        for ln in r["lines"]:
            if ln["line_type"] == "discount" or not ln.get("sku") or ln["sku"] in fee_skus:
                continue
            net = ln["line_total"] + (discounts.get(ln["sku"], 0) if ln["line_type"] == "item" else 0)
            eid = "le-" + hashlib.sha1(f"{r['receipt_id']}|{ln['sku']}|{ln['line_type']}".encode()).hexdigest()[:10]
            entries.append({
                "entry_id": eid, "receipt_id": r["receipt_id"],
                "item_id": ln.get("item_id") or f"costco-{ln['sku']}",
                "store_id": r.get("merchant"), "date": r["purchased_at"],
                "qty": ln["qty"], "price": round(net, 2),
                "event_type": "return" if ln["line_type"] == "return" else "purchase",
                "allocation": ln.get("allocation", "HOUSEHOLD"),
                "supersedes": None})
    return sorted(entries, key=lambda e: e["date"])
