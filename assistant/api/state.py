"""Household state — file-backed store (Stage 3 v1).
Files in ARYA_DATA_DIR: receipts.json (DecodedReceipts), dictionary.json,
cart.json, flags.json. Derived state (ledger/patterns/list) is recomputed
on read — at household scale that is milliseconds, and it can never drift
from the stored receipts. Postgres replaces the files when volume demands.
"""
import json, os

from api.ledger.build import build_ledger
from api.patterns.engine import summarize
from api.list.build import build_list
from api.cart.build import prepare

def data_dir():
    return os.environ.get("ARYA_DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))


def _load(name, default):
    p = os.path.join(data_dir(), name)
    if os.path.exists(p):
        return json.load(open(p))
    return default


def _save(name, obj):
    os.makedirs(data_dir(), exist_ok=True)
    json.dump(obj, open(os.path.join(data_dir(), name), "w"), indent=1)


def receipts():
    return _load("receipts.json", [])


def add_receipts(new):
    cur = receipts()
    seen = {r["receipt_id"] for r in cur}
    added = [r for r in new if r["receipt_id"] not in seen]
    _save("receipts.json", cur + added)
    return len(added)


def dictionary():
    return _load("dictionary.json", {"entries": []})


def names():
    return {e["item_id"]: e["canonical_name"] for e in dictionary()["entries"]}


def fee_skus():
    return {e["sku"] for e in dictionary()["entries"] if e.get("kind") == "fee"}


def flags():
    return _load("flags.json", {})


def set_flag(item_id, flag):
    f = flags()
    f[item_id] = flag
    _save("flags.json", f)


def as_of():
    rs = receipts()
    return max((r["purchased_at"] for r in rs), default=None)


def derived():
    rs = receipts()
    entries = build_ledger(rs, fee_skus=fee_skus())
    patterns = summarize(entries, as_of=as_of())
    fl = flags()
    today = as_of()
    def hidden(pid):
        f = fl.get(pid, {})
        return f.get("never") or (f.get("snoozed_until") and today and f["snoozed_until"] >= today)
    visible = [p for p in patterns if not hidden(p["item_id"])]
    smart = build_list(visible)
    have = {i["item_id"] for i in smart["items"]}
    for pid, f in fl.items():
        if f.get("manual") and pid not in have:
            smart["items"].append({"item_id": pid, "qty": 1, "due_reason": "Added by you",
                                    "source": "user"})
    for item in smart["items"]:
        item["name"] = names().get(item["item_id"], item["item_id"])
    return {"entries": entries, "patterns": patterns, "smart_list": smart}


def get_cart():
    cart = _load("cart.json", None)
    if cart is None:
        cart = prepare(derived()["smart_list"], names())
        _save("cart.json", cart)
    return cart


def save_cart(cart):
    _save("cart.json", cart)


def dashboard():
    rs = receipts()
    entries = build_ledger(rs, fee_skus=fee_skus())
    spend = round(sum(e["price"] for e in entries if e["event_type"] == "purchase"), 2)
    returns = round(-sum(e["price"] for e in entries if e["event_type"] == "return"), 2)
    others = round(sum(e["price"] for e in entries if e["allocation"] in ("FOR_OTHERS", "FOR-OTHERS")), 2)
    by_month, by_store, by_item = {}, {}, {}
    for e in entries:
        if e["event_type"] != "purchase":
            continue
        by_month[e["date"][:7]] = round(by_month.get(e["date"][:7], 0) + e["price"], 2)
        by_store[e["store_id"]] = round(by_store.get(e["store_id"], 0) + e["price"], 2)
        by_item[e["item_id"]] = round(by_item.get(e["item_id"], 0) + e["price"], 2)
    nm = names()
    top = sorted(by_item.items(), key=lambda kv: -kv[1])[:10]
    return {"spend_total": spend, "returns_total": returns, "for_others_total": others,
            "trip_count": len(rs), "spend_by_month": dict(sorted(by_month.items())),
            "spend_by_store": by_store,
            "top_items": [{"item_id": k, "name": nm.get(k, k), "spend": v} for k, v in top]}


def review_queue():
    lines = []
    for r in receipts():
        for ln in r["lines"]:
            if ln.get("status") == "unverified":
                lines.append({"receipt_id": r["receipt_id"], "date": r["purchased_at"],
                              "raw": ln["raw"], "decoded_name": ln.get("decoded_name"),
                              "confidence": ln.get("confidence"),
                              "alternatives": ln.get("alternatives", [])})
    unresolved = [{"item_id": e["item_id"], "name": e["canonical_name"],
                   "candidates": e["resolution"].get("candidates", [])}
                  for e in dictionary()["entries"]
                  if e.get("resolution", {}).get("status") == "unresolved"]
    return {"lines": lines, "unresolved": unresolved}


def item_detail(item_id):
    d = derived()
    entry = next((e for e in dictionary()["entries"] if e["item_id"] == item_id), None)
    pattern = next((p for p in d["patterns"] if p["item_id"] == item_id), None)
    history = [e for e in d["entries"] if e["item_id"] == item_id]
    prices = {}
    for e in history:
        if e["event_type"] == "purchase":
            prices.setdefault(e["store_id"], []).append(e["price"])
    price_by_store = {s: {"min": min(v), "median": sorted(v)[len(v) // 2], "max": max(v), "count": len(v)}
                      for s, v in prices.items()}
    return {"entry": entry, "pattern": pattern,
            "history": sorted(history, key=lambda e: e["date"], reverse=True),
            "price_by_store": price_by_store}
