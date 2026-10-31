"""cost_ledger — one row per API call (IMPLEMENTATION §2.4).

Rows are JSON lines: time, mode, model, input/cached/output tokens, cost.
The ledger totals render against the $150 credit ceiling (plan §8).
"""
import contextvars, datetime, json, os, time

BUDGET_USD = 150.0

# What a request is for, so the usage screen can say where a person's
# spend went. The login middleware sets it from the URL; a call made
# outside a request books as "helps".
usage_kind = contextvars.ContextVar("arya_usage_kind", default="")
KINDS = ("reads", "ask", "maps", "helps")
_KIND_PATHS = (("/api/chat", "ask"), ("/api/storemap", "maps"), ("/api/quest/", "maps"),
               ("/decode", "reads"), ("/import", "reads"), ("/eyes", "reads"),
               ("/api/intake", "reads"), ("/api/list/from-photo", "reads"))


def kind_for_path(path):
    for prefix, kind in _KIND_PATHS:
        if path.startswith(prefix):
            return kind
    return "helps"


def _epoch(ts):
    try:
        return datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S%z").timestamp()
    except (TypeError, ValueError):
        return 0.0


class CostLedger:
    def __init__(self, path, bucket="app", user=""):
        self.path = path
        # The account a real (non-demo) call is booked to. Rows from
        # before this field have no user and belong to nobody.
        self.user = user
        # Spend bucket: "app" for real accounts, "demo" for the demo
        # household's live doors. The buckets share one file but are
        # totalled separately, so demo spend can never consume the
        # real accounts' daily budget (review 2026-10-28, H4).
        self.bucket = bucket

    def record(self, mode, model, input_tokens=0, cached_tokens=0, output_tokens=0,
               cost_usd=0.0, ms=None, ok=True, err=""):
        """One row per model call. ms is how long the call took; ok=False
        books a failed call (cost 0, err names the kind of failure) so
        error rates and slow calls can be counted (ops review 2026-10-31).
        Rows from before these fields have neither."""
        row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "mode": mode, "model": model,
               "bucket": self.bucket, "kind": usage_kind.get() or "helps",
               "input_tokens": input_tokens, "cached_tokens": cached_tokens,
               "output_tokens": output_tokens, "cost_usd": round(cost_usd, 6)}
        if ms is not None:
            row["ms"] = int(ms)
        if not ok:
            row["ok"] = False
            row["err"] = err
        if self.user and self.bucket == "app":
            row["user"] = self.user
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        with open(self.path, "a") as f:
            f.write(json.dumps(row) + "\n")
        return row

    def rows(self):
        if not os.path.exists(self.path):
            return []
        return [json.loads(l) for l in open(self.path) if l.strip()]

    def total_usd(self):
        return round(sum(r["cost_usd"] for r in self.rows()), 4)

    def remaining_usd(self):
        return round(BUDGET_USD - self.total_usd(), 4)

    def spent_today(self, bucket=None):
        """Today's spend. bucket=None totals every row; "app" counts
        rows with no bucket (pre-bucket history) or bucket "app";
        "demo" counts only demo rows."""
        today = time.strftime("%Y-%m-%d")

        def in_bucket(r):
            if bucket is None:
                return True
            if bucket == "app":
                return r.get("bucket", "app") == "app"
            return r.get("bucket") == bucket

        return round(sum(r["cost_usd"] for r in self.rows()
                         if str(r.get("ts", "")).startswith(today)
                         and in_bucket(r)), 4)

    def usage(self, user):
        """One account's spend: lifetime and this month in dollars, the
        first booked call, and a count and total per kind."""
        month = time.strftime("%Y-%m")
        hour_ago = time.time() - 3600
        out = {"lifetime_usd": 0.0, "month_usd": 0.0, "hour_usd": 0.0, "since": "",
               "kinds": {k: {"n": 0, "usd": 0.0} for k in KINDS}}
        for r in self.rows():
            if not user or r.get("user") != user or r.get("ok") is False:
                continue
            c = r["cost_usd"]
            out["lifetime_usd"] += c
            if str(r.get("ts", "")).startswith(month):
                out["month_usd"] += c
            out["since"] = out["since"] or str(r.get("ts", ""))[:10]
            if _epoch(r.get("ts")) >= hour_ago:
                out["hour_usd"] += c
            k = r.get("kind") if r.get("kind") in KINDS else "helps"
            out["kinds"][k]["n"] += 1
            out["kinds"][k]["usd"] += c
        out["lifetime_usd"] = round(out["lifetime_usd"], 4)
        out["month_usd"] = round(out["month_usd"], 4)
        out["hour_usd"] = round(out["hour_usd"], 4)
        for v in out["kinds"].values():
            v["usd"] = round(v["usd"], 4)
        return out

    def whole(self):
        """Everyone's real-account spend and how many accounts made it
        (rows with a user; the demo and old rows are left out)."""
        total, people = 0.0, set()
        for r in self.rows():
            if r.get("bucket", "app") == "app" and r.get("user") and r.get("ok") is not False:
                total += r["cost_usd"]
                people.add(r["user"])
        return {"usd": round(total, 4), "people": len(people)}

    def health(self, hours=24):
        """What the ops report needs from the last `hours`: calls, failures
        and p50/p95 latency by model mode and by kind, plus spend per
        account. Failed rows count as calls with cost 0."""
        since = time.time() - hours * 3600
        by_mode, by_kind, users = {}, {}, {}
        for r in self.rows():
            if _epoch(r.get("ts")) < since:
                continue
            failed = r.get("ok") is False
            for table, key in ((by_mode, r.get("mode", "?")),
                               (by_kind, r.get("kind") or "helps")):
                t = table.setdefault(key, {"calls": 0, "failed": 0, "usd": 0.0,
                                           "ms": [], "errs": {}})
                t["calls"] += 1
                t["usd"] += r.get("cost_usd", 0)
                if failed:
                    t["failed"] += 1
                    t["errs"][r.get("err") or "error"] = t["errs"].get(r.get("err") or "error", 0) + 1
                if isinstance(r.get("ms"), int):
                    t["ms"].append(r["ms"])
            if r.get("user") and not failed:
                users[r["user"]] = users.get(r["user"], 0.0) + r.get("cost_usd", 0)
        for table in (by_mode, by_kind):
            for t in table.values():
                ms = sorted(t.pop("ms"))
                t["p50_ms"] = ms[len(ms) // 2] if ms else None
                t["p95_ms"] = ms[min(len(ms) - 1, int(len(ms) * 0.95))] if ms else None
                t["usd"] = round(t["usd"], 4)
        top = sorted(users.items(), key=lambda kv: -kv[1])[:5]
        return {"hours": hours, "by_mode": by_mode, "by_kind": by_kind,
                "top_users": [(u, round(v, 4)) for u, v in top]}
