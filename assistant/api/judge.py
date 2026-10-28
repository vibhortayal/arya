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
SCHEMA = ("StapleVerdicts", {
    "type": "object",
    "properties": {"verdicts": {"type": "array", "items": {
        "type": "object",
        "properties": {"item_id": {"type": "string"},
                       "class": {"type": "string", "enum": sorted(
                           ["STAPLE", "SEASONAL", "OCCASIONAL", "ONE_OFF", "NOT_CONSUMABLE"])},
                       "reason": {"type": "string"}},
        "required": ["item_id", "class"]}}},
    "required": ["verdicts"]})
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
        mode="standard", personal=True, reasoning_effort="low",
        schema=SCHEMA, cache_key="arya-staple-judge-v1")
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


# --- Second seat (owner, 2026-10-28) ---------------------------------
# Muse Spark Open (open weights, via Baseten) re-judges item NAMES
# only — no purchase facts ever leave the hosted API (MODEL-POLICY).
# It judges what kind of thing an item IS; judge_batch above, with
# the household's facts, stays the decider. Disagreements are a
# curation signal, recorded by the caller, never an override.

_NAMES_PROMPT = open(os.path.join(os.path.dirname(__file__),
                                  "prompts",
                                  "staple_judge_names_v1.md")).read()


def second_seat_batch(open_client, items):
    """items: [(item_id, name)] -> {item_id: {class, list_ok, reason}}

    Name-only: the prompt forbids household reasoning and the facts
    line is never built. Same verdict shape as judge_batch."""
    listing = "\n".join(f"[{iid}] {name}" for iid, name in items)
    text, _usage, _cost = open_client.chat(
        [{"role": "system", "content": _NAMES_PROMPT},
         {"role": "user", "content": listing}],
        personal=False, temperature=0.0)
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
            out[v["item_id"]] = {
                "class": cls,
                "list_ok": cls in ("STAPLE", "SEASONAL"),
                "reason": str(v.get("reason", ""))[:120]}
    return out


def second_seat_report(open_verdicts, spark_verdicts, names):
    """Compare the two seats over the items both judged.

    Returns {checked, agreed, disagreements: [{item_id, name,
    open_class, spark_class, open_reason, spark_reason}]}."""
    rows = []
    agreed = 0
    for iid, ov in open_verdicts.items():
        sv = spark_verdicts.get(iid)
        if not sv:
            continue
        if ov["class"] == sv["class"]:
            agreed += 1
        else:
            rows.append({"item_id": iid, "name": names.get(iid, iid),
                         "open_class": ov["class"],
                         "spark_class": sv["class"],
                         "open_reason": ov.get("reason", ""),
                         "spark_reason": sv.get("reason", "")})
    return {"checked": agreed + len(rows), "agreed": agreed,
            "disagreements": rows}
