"""Pattern engine — deterministic, $0 (MODEL-POLICY rule 1).
Input set per §3: purchases minus returns minus FOR-OTHERS lines.
A return cancels earlier purchases of the same item, FIFO, by quantity.
A cadence claim needs >= 2 kept purchases (SPEC: pattern rule)."""
import statistics
from datetime import date


def _d(s):
    return date.fromisoformat(s)


def net_purchases(entries):
    """Kept purchase events after returns netting, by item_id."""
    kept = {}
    returns = []
    for e in entries:
        if e["allocation"] in ("FOR_OTHERS", "FOR-OTHERS"):
            continue
        if e["event_type"] == "purchase":
            kept.setdefault(e["item_id"], []).append(dict(e))
        elif e["event_type"] == "return":
            returns.append(e)
    for ret in returns:
        qty = ret["qty"]
        for p in kept.get(ret["item_id"], []):
            if qty <= 0:
                break
            take = min(p["qty"], qty)
            p["qty"] -= take
            qty -= take
    return {k: [p for p in v if p["qty"] > 0] for k, v in kept.items() if any(p["qty"] > 0 for p in v)}


def summarize(entries, as_of=None):
    kept = net_purchases(entries)
    out = []
    for item_id, events in kept.items():
        events = sorted(events, key=lambda e: e["date"])
        dates = [_d(e["date"]) for e in events]
        gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
        median_gap = round(statistics.median(gaps), 1) if gaps else None
        last = dates[-1]
        ref = _d(as_of) if as_of else last
        since = (ref - last).days
        has_pattern = len(events) >= 2 and median_gap is not None
        # Lapsed: silence far beyond the cadence means the household stopped
        # buying it (moved, switched, disliked) — it is not "due", it is over.
        lapsed = bool(has_pattern and since > 4 * median_gap)
        out.append({
            "item_id": item_id, "purchase_count": len(events),
            "median_interval_days": median_gap, "last_bought": last.isoformat(),
            "typical_qty": statistics.median([e["qty"] for e in events]),
            "total_spend": round(sum(e["price"] for e in events), 2),
            "due": bool(has_pattern and not lapsed and since >= median_gap),
            "history_state": ("lapsed" if lapsed else "pattern") if has_pattern else "not-enough-history",
            "days_since_last": since,
            "due_window": [ (last.fromordinal(last.toordinal() + int(median_gap * 0.75))).isoformat(),
                            (last.fromordinal(last.toordinal() + int(median_gap * 1.25))).isoformat() ] if has_pattern else None})
    return sorted(out, key=lambda s: (-(s["days_since_last"] / s["median_interval_days"]) if s["median_interval_days"] else 0))
