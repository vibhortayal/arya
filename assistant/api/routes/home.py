"""The Today screen and the dashboard."""
from fastapi import APIRouter

from api import state
from api.deps import _d_today

router = APIRouter()


@router.get("/api/home")
def home():
    d = state.derived()
    nm = state.names()
    from api.eyes.service import prior_days
    seen = [{"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
             "date": p["seen"]["date"], "kind": p["seen"].get("kind")}
            for p in d["patterns"] if p.get("seen")]
    checks = []
    _fl = state.flags()
    _MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    for p in d["patterns"]:
        prior = prior_days(nm.get(p["item_id"], ""))
        if prior and p.get("last_bought") and not p["due"]:
            if _fl.get(p["item_id"], {}).get("check_ok") == state.cycle():
                continue  # the user already answered this cycle
            if _fl.get(p["item_id"], {}).get("use_by"):
                continue  # a real printed date beats the usual-shelf-life guess
            from datetime import date as _d
            age = (_d.fromisoformat(state.today_ref()) - _d.fromisoformat(p["last_bought"])).days
            if age >= prior:
                _lb = p["last_bought"]
                checks.append({"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
                               "text": f"{nm.get(p['item_id'], p['item_id'])} from {_MON[int(_lb[5:7]) - 1]} {int(_lb[8:10])} usually turns about now — still good?"})
    low = [{"item_id": p["item_id"], "name": nm.get(p["item_id"], p["item_id"]),
            "judge_reason": (p.get("judge") or {}).get("reason", ""),
            "due_window": p["due_window"], "reason": p["due_reason"] if "due_reason" in p else
            f"every ~{p['median_interval_days']:.0f} days; last bought {p['days_since_last']} days ago"}
           for p in state.running_low(d)]
    # Store affinity for the list ships with this payload: the List
    # view used to make one /api/items/{id} call per list item just
    # for these keys (review 2026-10-28, M9). Same aggregation as
    # state.item_detail, computed once over the derived entries.
    gm = state.group_map()
    pbs = {}
    for item in d["smart_list"]["items"]:
        iid = gm.get(item["item_id"], item["item_id"])
        prices = {}
        for e in d["entries"]:
            if e["item_id"] == iid and e["event_type"] == "purchase":
                prices.setdefault(e["store_id"], []).append(e["price"])
        if prices:
            pbs[item["item_id"]] = {
                s: {"min": min(v), "median": sorted(v)[len(v) // 2],
                    "max": max(v), "count": len(v)}
                for s, v in prices.items()}
    from api import expiry
    last_bought = {p["item_id"]: p.get("last_bought") for p in d["patterns"]}
    use_soon = expiry.use_soon(_fl, nm, last_bought, _d_today())
    # After a receipt, the things that can expire or go bad (#207): asked once per
    # receipt, and never again after two "Not now"s.
    # The demo's receipts are fixed in time, so its window counts back
    # from its last receipt, not from today.
    pn = state._load("settings.json", {}).get("perish_nudge") or {}
    ref = (expiry.parse_iso(state.as_of()) if state._current_user.get() == state.DEMO_USER
           else None) or _d_today()
    perish = (None if pn.get("not_now", 0) >= expiry.NUDGE_STOP_AFTER else
              expiry.receipt_nudge(state.receipts(), _fl, pn.get("seen"), ref))
    return {"as_of": state.as_of(), "running_low": low,
            "list": d["smart_list"], "lists": state.named_lists(),
            "cart": state.get_cart(), "seen": seen, "checks": checks, "price_by_store": pbs,
            "use_soon": use_soon, "perishables": perish}


@router.get("/api/dashboard")
def dashboard_route():
    return state.dashboard()
