"""The user's own receipts, as plain data for the open API.

Pure functions over the receipts the account itself filed. Totals are
sums of what the receipts say; no ledger, staple judge, dictionary or
aisle map is read here, so the open API shows a user their own records
and none of Arya's inference."""
import csv
import io

RECEIPT_COLUMNS = ["receipt_id", "merchant", "date", "name", "qty",
                   "unit_price", "line_total", "line_type"]


def _line(ln):
    kind = ln.get("line_type") or "item"
    sign = -1 if kind == "return" else 1

    def signed(v):  # a return reads negative, even filed before returns were signed
        return sign * abs(v) if isinstance(v, (int, float)) and kind == "return" else v
    return {"name": ln.get("decoded_name") or ln.get("raw") or "",
            "qty": signed(ln.get("qty")) if ln.get("qty") is not None else 1,
            "unit_price": signed(ln.get("unit_price")),
            "line_total": signed(ln.get("line_total")), "line_type": kind}


def receipt_total(r):
    if r.get("total") is not None:
        return r["total"]
    return round(sum(ln.get("line_total") or 0 for ln in r.get("lines", [])), 2)


def summary(r):
    lines = r.get("lines", [])
    return {"id": r["receipt_id"], "merchant": r.get("merchant") or "",
            "date": r.get("purchased_at"), "total": receipt_total(r),
            "subtotal": r.get("subtotal"), "tax": r.get("tax"),
            "items": sum(1 for ln in lines if (ln.get("line_type") or "item") == "item"),
            "reconciles": bool(r.get("totals_reconcile")),
            "has_photo": bool(r.get("image_ref"))}


def detail(r):
    return {**summary(r), "lines": [_line(ln) for ln in r.get("lines", [])]}


def newest_first(receipts):
    return sorted(receipts, key=lambda r: r.get("purchased_at") or "", reverse=True)


def to_csv(receipts):
    out = io.StringIO(newline="")
    w = csv.writer(out, lineterminator="\n")
    w.writerow(RECEIPT_COLUMNS)
    for r in newest_first(receipts):
        for ln in map(_line, r.get("lines", [])):
            w.writerow([r["receipt_id"], _cell(r.get("merchant")),
                        r.get("purchased_at") or "", _cell(ln["name"]), ln["qty"],
                        _blank(ln["unit_price"]), _blank(ln["line_total"]),
                        ln["line_type"]])
    return out.getvalue()


def _blank(v):
    return "" if v is None else v


def _cell(v):
    """A spreadsheet runs a cell that starts with = + - @ as a formula."""
    v = "" if v is None else str(v)
    return "'" + v if v[:1] in ("=", "+", "-", "@") else v


def spending(receipts):
    """What the receipts add up to: total, returns, trips, and the
    total by month and by merchant."""
    by_month, by_store, spend, returns = {}, {}, 0.0, 0.0
    for r in receipts:
        amount = receipt_total(r)
        spend += amount
        month = (r.get("purchased_at") or "")[:7] or "unknown"
        by_month[month] = round(by_month.get(month, 0) + amount, 2)
        store = r.get("merchant") or "unknown"
        by_store[store] = round(by_store.get(store, 0) + amount, 2)
        returns += sum(abs(ln.get("line_total") or 0) for ln in r.get("lines", [])
                       if ln.get("line_type") == "return")
    return {"trips": len(receipts), "spend_total": round(spend, 2),
            "returns_total": round(returns, 2),
            "by_month": dict(sorted(by_month.items())),
            "by_store": dict(sorted(by_store.items(), key=lambda kv: -kv[1]))}


def purchases(receipts, limit=50):
    """What was bought and when, by the name printed on the receipt:
    times bought, quantity, first and last date, money spent."""
    rows = {}
    for r in receipts:
        day = r.get("purchased_at") or ""
        for ln in r.get("lines", []):
            if (ln.get("line_type") or "item") != "item":
                continue
            name = " ".join((ln.get("decoded_name") or ln.get("raw") or "").split())
            if not name:
                continue
            row = rows.setdefault(name.lower(), {
                "name": name, "times_bought": 0, "qty": 0, "spent": 0.0,
                "first_bought": day, "last_bought": day})
            row["times_bought"] += 1
            row["qty"] += ln.get("qty") if isinstance(ln.get("qty"), (int, float)) else 1
            row["spent"] += ln.get("line_total") or 0
            row["first_bought"] = min(row["first_bought"], day) if day else row["first_bought"]
            row["last_bought"] = max(row["last_bought"], day)
    out = sorted(rows.values(), key=lambda x: (-x["times_bought"], x["name"].lower()))
    for row in out:
        row["spent"] = round(row["spent"], 2)
    return out[:limit]
