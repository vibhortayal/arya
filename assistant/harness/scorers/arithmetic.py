"""Arithmetic scorer: a decoded/imported receipt is correct in money iff the
signed line amounts sum to the stated subtotal (tolerance 1.1 cents).
Works on the Costco JSON shape (itemArray/amount/subTotal) and on decoded
output (lines/price/subtotal)."""


def verify_receipt(receipt):
    if "itemArray" in receipt:
        s = round(sum(l["amount"] for l in receipt["itemArray"]), 2)
        return abs(s - receipt["subTotal"]) <= 0.011
    lines = receipt.get("lines", [])
    s = round(sum(l["price"] for l in lines), 2)
    return abs(s - float(receipt.get("subtotal", -10**9))) <= 0.011
