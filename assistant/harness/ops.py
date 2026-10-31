"""Owner ops report: how the app and the model calls did (ops review
2026-10-31). Reads the data folder like the app; no network except the
optional email, no model calls, $0.

    python -m harness.ops report [--hours 24] [--email]

Run it on the VM:  docker compose exec -T api python -m harness.ops report
--email sends the same text to ARYA_OPS_EMAIL through Resend (the daily
digest; a cron line is in docs/OPS.md). Lines under "Needs a look" are
the ones worth acting on; an empty section means nothing is.
"""
import html
import os
import shutil
import sys
import time

from api import deps, feedback, mailer, state, waitlist
from api.auth import users as _users
from api.cost_ledger import CostLedger

FAIL_RATE = 0.10        # a mode failing more than this (with MIN_CALLS) is flagged
MIN_CALLS = 5
SLOW_P95_MS = 20000
BUDGET_WARN = 0.8


def _num(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def build(hours=24):
    """The report as (subject, text). Pure reads."""
    led = CostLedger(deps._LEDGER)
    h = led.health(hours)
    warn = []
    lines = []

    spent = {"app": led.spent_today("app"), "demo": led.spent_today("demo")}
    cap = {"app": _num("ARYA_DAILY_BUDGET_USD", 10), "demo": _num("ARYA_DEMO_DAILY_BUDGET_USD", 20)}
    lines.append("SPEND TODAY")
    for b in ("app", "demo"):
        pct = spent[b] / cap[b] if cap[b] else 0
        lines.append(f"  {b:<5} ${spent[b]:.2f} of ${cap[b]:.2f} ({pct:.0%})")
        if cap[b] and pct >= BUDGET_WARN:
            warn.append(f"{b} budget is at {pct:.0%} of today's cap")
    lines.append(f"  all time ${led.total_usd():.2f} of ${led.remaining_usd() + led.total_usd():.0f} credit"
                 f" (${led.remaining_usd():.2f} left)")

    for title, table in (("MODEL CALLS BY TYPE", h["by_mode"]), ("MODEL CALLS BY FEATURE", h["by_kind"])):
        lines += ["", f"{title} (last {hours} h)"]
        if not table:
            lines.append("  none")
        for key, t in sorted(table.items(), key=lambda kv: -kv[1]["calls"]):
            slow = f"  p50 {t['p50_ms']} ms  p95 {t['p95_ms']} ms" if t["p50_ms"] is not None else ""
            errs = ""
            if t["failed"]:
                errs = "  [" + ", ".join(f"{k} x{v}" for k, v in sorted(t["errs"].items())) + "]"
            lines.append(f"  {key:<10} {t['calls']:>4} calls  {t['failed']:>3} failed  ${t['usd']:.2f}{slow}{errs}")
            if t["calls"] >= MIN_CALLS and t["failed"] / t["calls"] > FAIL_RATE:
                warn.append(f"{key}: {t['failed']} of {t['calls']} calls failed")
            if t["p95_ms"] is not None and t["p95_ms"] > SLOW_P95_MS and title.endswith("TYPE"):
                warn.append(f"{key}: slow, p95 {t['p95_ms'] / 1000:.0f} s")

    lines += ["", "TOP ACCOUNTS BY SPEND (last %d h)" % hours]
    lines += [f"  {u}  ${v:.2f}" for u, v in h["top_users"]] or ["  none"]

    now = time.time()
    frozen = {u: d for u, d in deps._freezes().items() if d.get("until", 0) > now}
    lines += ["", "FROZEN ACCOUNTS"]
    for u, d in frozen.items():
        lines.append(f"  {u}  was ${d.get('usd_hour', 0)} in an hour; back in "
                     f"{(d['until'] - now) / 3600:.0f} h")
        warn.append(f"{u} is frozen for heavy use")
    if not frozen:
        lines.append("  none")

    base = state.base_dir()
    free = shutil.disk_usage(base).free
    floor_mb = _num("ARYA_HEALTH_MIN_FREE_MB", 500)
    lines += ["", "THE BOX", f"  data folder free {free / 1e9:.1f} GB"]
    if free < max(floor_mb * 1024 * 1024 * 4, 2e9):
        warn.append(f"disk is getting low ({free / 1e9:.1f} GB free)")

    notes = [n for n in feedback.list_all() if n.get("at", 0) >= now - hours * 3600]
    pending = [r for r in waitlist.rows() if not r.get("approved")]
    lines += ["", "PEOPLE",
              f"  accounts {len(_users())}",
              f"  waitlist waiting {len(pending)}",
              f"  feedback in last {hours} h: {len(notes)}"]
    for n in notes[:5]:
        lines.append(f"    [{n.get('kind', '')}] {str(n.get('text', ''))[:120]}")
    if notes:
        warn.append(f"{len(notes)} new feedback note(s)")

    head = ["ARYA OPS REPORT  " + time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())]
    if warn:
        head += ["", "NEEDS A LOOK"] + [f"  * {w}" for w in warn]
    else:
        head += ["", "Nothing needs a look."]
    subject = ("[Arya] Needs a look: " + warn[0]) if warn else "[Arya] Daily report: all quiet"
    return subject, "\n".join(head + [""] + lines) + "\n"


def main(argv):
    if not argv or argv[0] != "report":
        print(__doc__)
        return 2
    hours = 24
    if "--hours" in argv:
        try:
            hours = max(1, int(argv[argv.index("--hours") + 1]))
        except (IndexError, ValueError):
            print("--hours needs a whole number")
            return 2
    subject, text = build(hours)
    print(text)
    if "--email" in argv:
        to = os.environ.get("ARYA_OPS_EMAIL", "")
        if not to:
            print("ARYA_OPS_EMAIL is not set: nothing sent")
            return 1
        ok = mailer.send(to, subject, text,
                         "<pre style=\"font:13px/1.45 ui-monospace,Menlo,monospace\">"
                         + html.escape(text) + "</pre>")
        print("emailed" if ok else "email failed (is RESEND_API_KEY set?)")
        return 0 if ok else 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
