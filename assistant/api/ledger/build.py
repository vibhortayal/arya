"""Ledger build — DecodedReceipts -> LedgerEntry records (§3).
Prices are net: a discount line folds into its parent item's price.
Returns are their own entries (negative price, positive qty); netting happens in the pattern engine.
Fee-class SKUs never enter the ledger."""
import hashlib

from api import storename


def receipt_savings(r):
    """What coupons, deals and discounts took off one receipt, as a
    positive number. Itemized receipts carry discount lines (negative
    totals); photo reads fold the discount into the price and keep its
    value on the line as discount_amount. Already inside the net item
    prices, so this is shown, never subtracted again."""
    total = 0.0
    for ln in r.get("lines", []):
        if ln.get("line_type") == "discount":
            total += abs(ln.get("line_total") or 0)
        else:
            total += abs(ln.get("discount_amount") or 0)
    return round(total, 2)


def build_ledger(receipts, fee_skus=frozenset()):
    entries = []
    stores = storename.labels(receipts)
    for r in receipts:
        discounts = {}
        for ln in r["lines"]:
            if ln["line_type"] == "discount" and ln.get("discount_parent_sku"):
                discounts[ln["discount_parent_sku"]] = discounts.get(ln["discount_parent_sku"], 0) + ln["line_total"]
        for ln in r["lines"]:
            if ln["line_type"] == "discount" or not ln.get("sku") or ln["sku"] in fee_skus:
                continue
            is_return = ln["line_type"] == "return"
            net = ln["line_total"] + (discounts.get(ln["sku"], 0) if not is_return else 0)
            if is_return:  # receipts filed before returns were signed carry a positive amount
                net = -abs(net)
            eid = "le-" + hashlib.sha1(f"{r['receipt_id']}|{ln['sku']}|{ln['line_type']}".encode()).hexdigest()[:10]
            entries.append({
                "entry_id": eid, "receipt_id": r["receipt_id"],
                "item_id": ln.get("item_id") or f"costco-{ln['sku']}",
                "store_id": stores[r["receipt_id"]]["label"] or r.get("merchant"), "date": r["purchased_at"],
                "qty": abs(ln["qty"]), "price": round(net, 2),
                "event_type": "return" if ln["line_type"] == "return" else "purchase",
                "allocation": ln.get("allocation", "HOUSEHOLD"),
                "supersedes": None})
    return sorted(entries, key=lambda e: e["date"])
