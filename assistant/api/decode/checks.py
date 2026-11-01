"""Cheap checks on a receipt photo read, with no second model call.

The photo reader (Spark) can be wrong in ways its own confidence does not
show. These checks look only at the numbers it returned. validate()
returns the reasons a read should not be trusted as it is; an empty list
means every check passed. Photo decode escalates a failing receipt to
Wonder (decode/service.py, ARYA_PHOTO_READER=auto).

What they catch: a misread digit (the lines no longer add up), a read
total that disagrees with subtotal plus tax, a footer item count that
differs from the lines, impossible prices, a price far from what the same
item number cost on this account's earlier receipts, and a read the model
itself marked unsure on too many lines.

What they cannot catch on their own: two prices swapped between lines
(the sum is the same). The price-history check covers that only for item
numbers seen before.
"""
CENT = 0.05
LOW_CONF = 0.5
UNSURE_SHARE = 0.25
PRICE_JUMP = 0.5      # more than 50% away from every earlier price
MAX_PRICE = 2000.0


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def validate(rec, known_prices=None):
    reasons = []
    lines = [l for l in rec.get("lines", [])]
    items = [l for l in lines if l.get("line_type", "item") == "item"
             and not (l.get("raw") or "").lstrip().startswith("/")]
    if not items:
        return ["no_lines"]

    if not rec.get("totals_reconcile"):
        reasons.append("lines_do_not_add_up")

    sub, tax, total = rec.get("subtotal"), rec.get("tax"), rec.get("total")
    if _num(sub) and _num(total) and _num(tax) and abs(sub + tax - total) > CENT:
        reasons.append("total_mismatch")

    sold = rec.get("items_sold")
    if _num(sold):
        counted = sum(abs(l.get("qty") or 1) for l in items)
        if abs(counted - sold) > 0.01:
            reasons.append("item_count_mismatch")

    for l in items:
        p = l.get("line_total")
        if not _num(p) or p <= 0 or p > MAX_PRICE or round(p, 2) != round(float(p), 6):
            reasons.append("bad_price")
            break

    unsure = [l for l in items if (l.get("confidence") or 0) < LOW_CONF
              or l.get("status") == "unverified"]
    if len(unsure) / len(items) > UNSURE_SHARE:
        reasons.append("many_unsure_lines")

    if known_prices:
        for l in items:
            seen = known_prices.get(str(l.get("sku") or ""))
            p = l.get("line_total")
            if seen and _num(p) and all(abs(p - q) > PRICE_JUMP * max(q, 0.01) for q in seen):
                reasons.append("price_changed")
                break
    return reasons
