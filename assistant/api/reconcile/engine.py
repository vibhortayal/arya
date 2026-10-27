"""Reconciliation — list vs receipt vs cart (§3)."""


def reconcile(trip_id, list_item_ids, receipt, cart_item_ids=()):
    receipt_ids = {f"costco-{ln['sku']}" for ln in receipt["lines"] if ln.get("sku") and ln["line_type"] == "item"}
    cart_ids = set(cart_item_ids)
    matched, unverified = [], []
    for iid in list_item_ids:
        if iid in receipt_ids:
            ev = ["list", "receipt"] + (["cart"] if iid in cart_ids else [])
            price = next((ln["line_total"] for ln in receipt["lines"]
                          if ln.get("sku") and f"costco-{ln['sku']}" == iid and ln["line_type"] == "item"), None)
            matched.append({"item_id": iid, "evidence": ev, "price": price})
        else:
            unverified.append({"item_id": iid, "seen_in": ["cart"] if iid in cart_ids else [],
                               "reason": "on the list, not on the receipt"})
    surprises = [{"raw": ln["raw"], "reason": "bought but not on the list"}
                 for ln in receipt["lines"]
                 if ln.get("sku") and ln["line_type"] == "item" and f"costco-{ln['sku']}" not in list_item_ids]
    return {"trip_id": trip_id, "matched": matched, "unverified": unverified, "surprises": surprises}
