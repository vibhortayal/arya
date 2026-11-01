"""What the owner's Ops screen shows: one dict from the cost ledger, the
data folder and the owner's switches. Reads only; $0, no model calls
(ops review 2026-10-31). The same limits drive `python -m harness.ops`."""
import os
import shutil
import time

from api import deps, feedback, meta_client, settings, site_flags, state, waitlist
from api.auth import users as _users
from api.cost_ledger import CostLedger

FAIL_RATE = 0.10        # a type or feature failing more than this is flagged
MIN_CALLS = 5
SLOW_P95_MS = 20000
BUDGET_WARN = 0.8
BACKUP_DIR = "/backups"   # compose mounts the VM backups folder here, read only
BACKUP_STALE_H = 30

KIND_LABEL = {"reads": "Photo and receipt reads", "ask": "Ask", "maps": "Store maps", "helps": "Other helps"}


def _num(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def backup_age_hours():
    """Hours since the newest backup file in the mounted backups
    folder, or None when the folder is not mounted or is empty."""
    try:
        newest = max((os.path.getmtime(os.path.join(BACKUP_DIR, f))
                      for f in os.listdir(BACKUP_DIR)), default=None)
    except OSError:
        return None
    return None if newest is None else (time.time() - newest) / 3600


def recent_changes(n=30):
    """The newest changes made from Ops, newest first (ops-changes.jsonl)."""
    import json
    try:
        with open(os.path.join(state.base_dir(), "ops-changes.jsonl")) as fh:
            lines = fh.read().splitlines()[-n:]
    except OSError:
        return []
    out = []
    for ln in reversed(lines):
        try:
            out.append(json.loads(ln))
        except ValueError:
            pass
    return out


def summary(hours=24):
    led = CostLedger(deps._LEDGER)
    h = led.health(hours)
    now = time.time()
    needs = []

    spend = {}
    for b, key in (("app", "daily_budget_usd"), ("demo", "demo_daily_budget_usd")):
        cap, spent = settings.get(key), led.spent_today(b)
        spend[b] = {"spent": round(spent, 2), "cap": cap}
        if cap and spent / cap >= BUDGET_WARN:
            needs.append({"title": "Spend is high" if b == "app" else "Demo spend is high",
                          "sub": f"${spent:.2f} of ${cap:.2f} today.", "chip": f"{spent / cap:.0%}", "bad": True})
    total = led.total_usd()
    spend["credit"] = {"left": round(led.remaining_usd(), 2), "total": round(total + led.remaining_usd(), 2)}

    calls = []
    for key, t in sorted(h["by_kind"].items(), key=lambda kv: -kv[1]["calls"]):
        calls.append({"key": key, "label": KIND_LABEL.get(key, key), **{k: t[k] for k in
                      ("calls", "failed", "usd", "p95_ms", "errs")}})
    if "voice" in h["by_mode"]:
        t = h["by_mode"]["voice"]
        calls.append({"key": "voice", "label": "Voice", **{k: t[k] for k in
                      ("calls", "failed", "usd", "p95_ms", "errs")}})
    for c in calls:
        c["bad"] = c["calls"] >= MIN_CALLS and c["failed"] / c["calls"] > FAIL_RATE
        if c["bad"]:
            errs = ", ".join(f"“{k}”" for k in sorted(c["errs"]))
            needs.append({"title": f"{c['label']} failing",
                          "sub": f"{c['failed']} of {c['calls']} failed in {hours} h ({errs}).",
                          "chip": f"{c['failed']} of {c['calls']}", "bad": True})
        elif c["p95_ms"] and c["p95_ms"] > SLOW_P95_MS:
            needs.append({"title": f"{c['label']} is slow", "sub": f"Slowest tenth took {c['p95_ms'] / 1000:.0f} s.",
                          "chip": "Slow", "bad": True})

    frozen = []
    for u, d in deps._freezes().items():
        if d.get("until", 0) > now:
            hrs = round((d["until"] - now) / 3600)
            frozen.append({"user": u, "usd_hour": d.get("usd_hour", 0), "hours_left": hrs})
            needs.append({"title": f"{u} is frozen", "sub": f"${d.get('usd_hour', 0):.2f} in one hour. Back in {hrs} h.",
                          "freeze": u})

    du = shutil.disk_usage(state.base_dir())
    floor = _num("ARYA_HEALTH_MIN_FREE_MB", 500) * 1024 * 1024
    disk_low = du.free < max(floor * 4, 2e9)
    if disk_low:
        needs.append({"title": "Disk is getting low", "sub": f"{du.free / 1e9:.1f} GB free.", "chip": "Low", "bad": True})
    age = backup_age_hours()
    backup = None
    if os.path.isdir(BACKUP_DIR):
        backup = {"hours": None if age is None else round(age, 1),
                  "ok": age is not None and age <= BACKUP_STALE_H}
        if not backup["ok"]:
            needs.append({"title": "No recent backup",
                          "sub": "None found." if age is None else f"The newest is {age:.0f} h old.",
                          "chip": "Check", "bad": True})

    notes = [n for n in feedback.list_all() if n.get("at", 0) >= now - hours * 3600]
    waiting = sum(1 for r in waitlist.rows() if not r.get("approved"))
    return {
        "hours": hours, "updated": int(now), "needs": needs,
        "box": {"disk_free_gb": round(du.free / 1e9, 1), "disk_total_gb": round(du.total / 1e9, 1),
                "disk_ok": not disk_low, "backup": backup},
        "spend": spend, "calls": calls, "frozen": frozen,
        "controls": {**{"ai_paused": site_flags.ai_paused(), "demo_live": site_flags.demo_live(),
                        "photo_reader": site_flags.photo_reader()
                        or ("spark" if os.environ.get("ARYA_PHOTO_READER", "wonder").lower() in ("spark", "standard")
                            else "wonder")},
                     "spark_tier": meta_client.spark_tier(),
                     "open_model": site_flags.open_model(), "reasoning_effort": site_flags.reasoning_effort(),
                     "registration_open": deps._registration_open()},
        "settings": settings.snapshot(),
        "overrides": (site_flags.raw().get("overrides") or {}),
        "meta_says": site_flags.raw().get("meta_says"),
        "changes": recent_changes(),
        "people": {"accounts": len(_users()), "top": h["top_users"], "waitlist": waiting,
                   "feedback_new": len(notes)},
    }
