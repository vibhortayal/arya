"""After a shopping trip's receipt is read: does it agree with the list?

The list is the shopper's own words, so the answer uses their names. It
reuses the hunt's receipt matcher (haul.match) on a plain list, so a
list trip and a Quest hunt agree on what "the same item" means.

A full match is silent: the caller shows nothing. Only two things are
worth a note: a list item with no receipt line (left out, or the store
did not have it) and a receipt line that is not on the list (an extra).
"""
from api import haul, quest


def check(receipt, names):
    """names: the list's item names as the person wrote them.
    Returns {merchant, lines, matched, list_only, receipt_only, quiet}."""
    names = [n.strip() for n in names or [] if n and n.strip()]
    sess = {"id": "list-trip", "items": [
        {"name": n, "checked": True, "group": quest.resolve_group(n)} for n in names]}
    lines = []
    for ln in receipt.get("lines") or []:
        if ln.get("line_type", "item") != "item":
            continue
        nm = haul._line_name(ln)
        if nm:
            lines.append(dict(ln, _name=nm, _qty=haul._qty(ln.get("qty", 1))))
    r = haul.match(sess, lines, {})
    # A weak swap ("Oat Milk" for "Milk") is a note both ways, not a match.
    list_only = [e["name"] for e in r["grabbed_only"]] + [e["name"] for e in r["swapped"] if e.get("suggested")]
    receipt_only = [e["name"] for e in r["on_receipt_only"]] + [e["from"] for e in r["swapped"] if e.get("suggested")]
    matched = len(r["matched"]) + len([e for e in r["swapped"] if not e.get("suggested")])
    # A list name with extra words ("Eggs - Pasture Raised") against a
    # receipt line with other words ("EGGS LARGE BROWN ORGANIC") shares
    # the product but not enough of the rest for the strict matcher.
    # When the shared word is the product and neither side adds a
    # product form (juice, sauce, ...), that is the same item.
    spare = list(receipt_only)
    for n in list(list_only):
        a = quest._core_tokens(n)
        for rn in spare:
            b = quest._core_tokens(rn)
            if a & b and not ((a ^ b) & quest._FORMS):
                list_only.remove(n)
                spare.remove(rn)
                matched += 1
                break
    receipt_only = spare
    return {"merchant": receipt.get("merchant"), "lines": len(lines),
            "matched": matched,
            "list_only": list_only, "receipt_only": receipt_only,
            "quiet": not list_only and not receipt_only}
