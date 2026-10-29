"""Push reminders for running low (flag: ARYA_PUSH_REMINDERS=1, off by
default). A phone opts in from Profile, which saves its Web Push
subscription in push.json (per account). A small daily job
(`python -m api.reminders`) finds staples that run out within the
account's notice window and sends ONE push per account per day.
Deterministic code, $0, no model calls. VAPID keys come from env
(ARYA_VAPID_PUBLIC_KEY, ARYA_VAPID_PRIVATE_KEY, ARYA_VAPID_SUBJECT) and
are never logged or returned by any route except the public key."""
import json, os
from datetime import date

from api import state

_FILE = "push.json"
DEFAULT_DAYS, MIN_DAYS, MAX_DAYS = 2, 1, 7
MAX_SUBS = 5
MAX_LISTED = 3


def flag_on():
    return os.environ.get("ARYA_PUSH_REMINDERS") == "1"


def public_key():
    return os.environ.get("ARYA_VAPID_PUBLIC_KEY", "").strip()


def configured():
    return bool(flag_on() and public_key()
                and os.environ.get("ARYA_VAPID_PRIVATE_KEY", "").strip())


def _doc():
    d = state._load(_FILE, {})
    d.setdefault("subs", [])
    d.setdefault("notice_days", DEFAULT_DAYS)
    d.setdefault("sent", {})
    d.setdefault("last_sent", None)
    return d


def config():
    d = _doc()
    return {"enabled": configured(), "public_key": public_key() if configured() else "",
            "notice_days": d["notice_days"], "subscribed": bool(d["subs"])}


def _valid_sub(sub):
    if not isinstance(sub, dict):
        return False
    keys = sub.get("keys")
    ep = sub.get("endpoint")
    return (isinstance(ep, str) and ep.startswith("https://") and len(ep) < 1000
            and isinstance(keys, dict)
            and isinstance(keys.get("p256dh"), str) and isinstance(keys.get("auth"), str))


def subscribe(sub):
    if not _valid_sub(sub):
        raise ValueError("that is not a push subscription")
    with state.file_lock(_FILE):
        d = _doc()
        d["subs"] = [s for s in d["subs"] if s["endpoint"] != sub["endpoint"]]
        d["subs"].append({"endpoint": sub["endpoint"],
                          "keys": {"p256dh": sub["keys"]["p256dh"], "auth": sub["keys"]["auth"]}})
        d["subs"] = d["subs"][-MAX_SUBS:]
        state._save(_FILE, d)


def unsubscribe(endpoint=None):
    with state.file_lock(_FILE):
        d = _doc()
        d["subs"] = [s for s in d["subs"] if endpoint and s["endpoint"] != endpoint]
        state._save(_FILE, d)


def set_notice_days(n):
    try:
        n = int(n)
    except (TypeError, ValueError):
        raise ValueError("days must be a whole number")
    if not MIN_DAYS <= n <= MAX_DAYS:
        raise ValueError(f"days must be {MIN_DAYS} to {MAX_DAYS}")
    with state.file_lock(_FILE):
        d = _doc()
        d["notice_days"] = n
        state._save(_FILE, d)
    return n


def due_items(notice_days, d=None):
    """Staples that run out within notice_days: (name, days_left, key).
    Same admission as Today's running-low rule (judge verdict or the
    user's own word, 3+ kept buys or a report), plus the ones whose
    next run-out lands inside the window. key = item + last buy, so
    one cycle is announced once and a new receipt re-arms it."""
    d = d or state.derived()
    nm = state.names()
    out = []
    for p in d["patterns"]:
        if not p.get("admitted") or not (p["purchase_count"] >= 3 or p.get("user_report")):
            continue
        gap = p.get("median_interval_days")
        if p.get("due") or p.get("user_report"):
            left = 0
        elif gap:
            left = round(gap - p["days_since_last"])
        else:
            continue
        if left <= notice_days:
            out.append((nm.get(p["item_id"], p["item_id"]), max(left, 0),
                        f'{p["item_id"]}@{p.get("last_bought")}'))
    return sorted(out, key=lambda t: (t[1], t[0]))


def _when(left):
    return "running out" if left <= 0 else f"running out in {left} day" + ("" if left == 1 else "s")


def compose(items, test=False):
    """items: [(name, days_left, key)] -> the notification payload."""
    if test:
        return {"title": "Arya reminders are on", "body": "This is a test. A real one looks like this.",
                "url": "/#list", "tag": "arya-test"}
    if len(items) == 1:
        n, left, _ = items[0]
        return {"title": f"{n} is probably {_when(left)}",
                "body": "Add it to this week's list? Tap to open your list.",
                "url": "/#list", "tag": "arya-low"}
    names = [n for n, _, _ in items]
    shown = ", ".join(names[:MAX_LISTED]) + (f", and {len(names) - MAX_LISTED} more" if len(names) > MAX_LISTED else "")
    return {"title": f"{len(items)} things are about to run out",
            "body": shown + ". Tap to see them.", "url": "/#list", "tag": "arya-low"}


def _send_one(sub, payload):
    from pywebpush import webpush
    webpush(subscription_info=sub, data=json.dumps(payload),
            vapid_private_key=os.environ["ARYA_VAPID_PRIVATE_KEY"].strip(),
            vapid_claims={"sub": os.environ.get("ARYA_VAPID_SUBJECT", "mailto:admin@example.com")},
            ttl=12 * 3600)


def send(payload, sender=None):
    """Send to every saved phone of the current account. Dead
    subscriptions (404/410) are dropped. Returns how many phones got it."""
    sender = sender or _send_one
    with state.file_lock(_FILE):
        d = _doc()
        alive, ok = [], 0
        for s in d["subs"]:
            try:
                sender(s, payload)
                alive.append(s)
                ok += 1
            except Exception as e:  # noqa: BLE001
                status = getattr(getattr(e, "response", None), "status_code", None)
                if status not in (404, 410):
                    alive.append(s)
        d["subs"] = alive
        state._save(_FILE, d)
    return ok


def run_for_current_user(today=None, sender=None):
    """One account's daily pass. At most one push a day."""
    today = today or date.today().isoformat()
    d = _doc()
    if not d["subs"] or d["last_sent"] == today:
        return 0
    items = [i for i in due_items(d["notice_days"]) if d["sent"].get(i[2]) is None]
    if not items:
        return 0
    n = send(compose(items), sender)
    if n:
        with state.file_lock(_FILE):
            d = _doc()
            d["last_sent"] = today
            for _, _, key in items:
                d["sent"][key] = today
            state._save(_FILE, d)
    return n


def run_all(today=None, sender=None):
    """The daily job: every real account with a saved phone."""
    from api import auth
    if not configured():
        return 0
    total = 0
    root = state._current_user.set(None)
    try:
        names = list(auth.users())
    finally:
        state._current_user.reset(root)
    for u in names:
        tok = state._current_user.set(u)
        try:
            total += run_for_current_user(today, sender)
        except Exception as e:  # noqa: BLE001 - one account never stops the rest
            print(f"reminders: {u}: {type(e).__name__}")
        finally:
            state._current_user.reset(tok)
    return total


if __name__ == "__main__":
    print(f"reminders sent: {run_all()}")
