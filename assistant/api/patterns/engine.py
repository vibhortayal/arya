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
        n = len(events)
        # --- evidence facts (the reasoning judge reads these) ---
        # The engine reports facts; whether an item is a staple worth
        # listing is a judgment call, made by the staple judge (api/judge).
        positive = [g for g in gaps if g > 0]
        spread = (max(positive) / min(positive)) if len(positive) >= 2 else None
        seasonal_months = None
        season_share = 0.0
        if n >= 3:
            months = [d.month for d in dates]
            best = None
            for start_m in range(1, 13):
                window = {((start_m - 1 + k) % 12) + 1 for k in range(4)}
                share = sum(1 for mo in months if mo in window) / n
                if best is None or share > best[0]:
                    best = (share, sorted(window))
            if best and best[0] >= 0.7:
                season_share, seasonal_months = best[0], best[1]
        if n < 3 or median_gap is None:
            state_name, verdict = "not-enough-history", "fewer than 3 kept purchases"
        elif median_gap >= 2 and since > 4 * median_gap:
            state_name, verdict = "lapsed", "silent for over 4x its rhythm"
        else:
            state_name, verdict = "pattern", "3+ kept purchases"
        has_pattern = state_name == "pattern"
        out.append({
            "item_id": item_id, "purchase_count": n,
            "median_interval_days": median_gap, "last_bought": last.isoformat(),
            "typical_qty": statistics.median([e["qty"] for e in events]),
            "total_spend": round(sum(e["price"] for e in events), 2),
            "due": bool(has_pattern and since >= median_gap),
            "history_state": state_name,
            "analysis": {"gaps_days": gaps, "gap_spread": spread,
                         "seasonal_months": seasonal_months, "verdict": verdict},
            "days_since_last": since,
            "due_window": [ (last.fromordinal(last.toordinal() + int(median_gap * 0.75))).isoformat(),
                            (last.fromordinal(last.toordinal() + int(median_gap * 1.25))).isoformat() ] if has_pattern else None})
    return sorted(out, key=lambda s: (-(s["days_since_last"] / s["median_interval_days"]) if s["median_interval_days"] else 0))
