"""Tidy up with Arya (owner, 2026-10-30): small, rule-based fixes for the
mess a pasted list leaves. Doubles ("Milk 1 gal" and "Whole milk"), an
amount typed into the name ("2 lemons"), and items that are not shop
items. Code only: no model, so it costs nothing and does the same every
time."""
import re

_DESCRIBERS = {"whole", "organic", "fresh", "large", "small", "medium", "extra", "the", "of", "a",
               "gal", "gallon", "lb", "lbs", "oz", "ct", "pack", "pk", "kg", "g", "l", "ml", "dozen"}
_AMOUNT = re.compile(r"^\s*(\d{1,2})\s+([A-Za-z][A-Za-z' -]{1,60})$")


def _stem(w):
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("es") and w[-3] in "sxz":
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def key(name):
    words = re.findall(r"[a-z]+", str(name or "").lower())
    words = [_stem(w) for w in words if w not in _DESCRIBERS]
    return " ".join(sorted(words))


def find(rows):
    """rows: open items on one list ({item_id, name, qty, not_grocery}).
    -> fixes, each {kind, ...}. Only items a person typed (manual-*) are
    renamed or merged; the rest keep their names."""
    fixes, by_key = [], {}
    for r in rows:
        k = key(r["name"])
        if k:
            by_key.setdefault(k, []).append(r)
    for group in by_key.values():
        if len(group) > 1:
            keep, drop = group[0], group[1:]
            fixes.append({"kind": "double", "keep": keep["item_id"], "drop": [d["item_id"] for d in drop],
                          "names": [r["name"] for r in group]})
    merged = {i for f in fixes for i in [f["keep"], *f["drop"]]}
    for r in rows:
        if r["item_id"] in merged:
            continue
        m = _AMOUNT.match(r["name"])
        if m and str(r["item_id"]).startswith("manual-") and int(r.get("qty") or 1) == 1:
            fixes.append({"kind": "amount", "id": r["item_id"], "name": r["name"],
                          "new_name": m.group(2).strip().capitalize(), "qty": int(m.group(1))})
        elif r.get("not_grocery"):
            fixes.append({"kind": "errand", "id": r["item_id"], "name": r["name"]})
    return fixes
