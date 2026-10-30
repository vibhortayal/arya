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

    def record(self, mode, model, input_tokens, cached_tokens, output_tokens, cost_usd):
        row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "mode": mode, "model": model,
               "bucket": self.bucket, "kind": usage_kind.get() or "helps",
               "input_tokens": input_tokens, "cached_tokens": cached_tokens,
               "output_tokens": output_tokens, "cost_usd": round(cost_usd, 6)}
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
            if not user or r.get("user") != user:
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
            if r.get("bucket", "app") == "app" and r.get("user"):
                total += r["cost_usd"]
                people.add(r["user"])
        return {"usd": round(total, 4), "people": len(people)}
