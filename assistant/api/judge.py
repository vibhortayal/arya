"""Staple judge — the reasoning layer over the pattern facts.

The deterministic engine reports facts (buys, gaps, spread, season). This
judge decides what kind of thing an item IS — a staple, a seasonal item,
an occasional buy, a one-off, or not a consumable at all — and whether it
may appear on the shopping list. Precision over recall: an unnecessary
suggestion annoys; a missed one costs one tap.

Personal data: Spark 1.3 Standard only (MODEL-POLICY). Verdicts are cached
per item and re-judged only when the purchase count moves materially."""
import json
import os

_PROMPT = open(os.path.join(os.path.dirname(__file__), "prompts", "staple_judge_v1.md")).read()
CLASSES = {"STAPLE", "SEASONAL", "OCCASIONAL", "ONE_OFF", "NOT_CONSUMABLE"}


def facts_line(name, p):
    a = p.get("analysis") or {}
    return (f"{name} | buys {p['purchase_count']} | last {p['last_bought']} | "
            f"gaps {a.get('gaps_days')} | median gap {p.get('median_interval_days')}d | "
            f"typical qty {p.get('typical_qty')} | total ${p.get('total_spend')} | "
            f"seasonal months {a.get('seasonal_months')}")


def judge_batch(client, items):
    """items: [(item_id, facts_line)] -> {item_id: {class, list_ok, reason}}"""
    listing = "\n".join(f"[{iid}] {facts}" for iid, facts in items)
    text, _usage, _cost = client.chat(
        [{"role": "system", "content": _PROMPT},
         {"role": "user", "content": listing}],
        mode="standard", personal=True, reasoning_effort="low")
    start, end = text.find("{"), text.rfind("}")
    if start < 0:
        return {}
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {}
    out = {}
    for v in data.get("verdicts", []):
        cls = str(v.get("class", "")).upper()
        if v.get("item_id") and cls in CLASSES:
            out[v["item_id"]] = {"class": cls,
                                 "list_ok": cls in ("STAPLE", "SEASONAL"),
                                 "reason": str(v.get("reason", ""))[:120]}
    return out
