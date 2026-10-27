"""Smart list — derived view over patterns (§3). Deterministic narration."""


def build_list(patterns, list_id="list-auto"):
    items = []
    for p in patterns:
        # The list is a trust surface: a cadence claim needs >= 3 kept
        # purchases before it may put an item on the list (SPEC keeps the
        # pattern label at >= 2; the list is stricter).
        if not p["due"] or p["purchase_count"] < 3:
            continue
        items.append({"item_id": p["item_id"], "qty": p["typical_qty"],
                      "due_reason": f"every ~{p['median_interval_days']:.0f} days; last bought {p['days_since_last']} days ago",
                      "source": "pattern"})
    narration = (f"{len(items)} items are due from your patterns."
                 if items else "Nothing is due yet.")
    return {"list_id": list_id, "items": items, "narration": narration}
