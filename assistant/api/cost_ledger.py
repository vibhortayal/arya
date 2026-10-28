"""cost_ledger — one row per API call (IMPLEMENTATION §2.4).

Rows are JSON lines: time, mode, model, input/cached/output tokens, cost.
The ledger totals render against the $150 credit ceiling (plan §8).
"""
import json, os, time

BUDGET_USD = 150.0


class CostLedger:
    def __init__(self, path, bucket="app"):
        self.path = path
        # Spend bucket: "app" for real accounts, "demo" for the demo
        # household's live doors. The buckets share one file but are
        # totalled separately, so demo spend can never consume the
        # real accounts' daily budget (review 2026-10-28, H4).
        self.bucket = bucket

    def record(self, mode, model, input_tokens, cached_tokens, output_tokens, cost_usd):
        row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "mode": mode, "model": model,
               "bucket": self.bucket,
               "input_tokens": input_tokens, "cached_tokens": cached_tokens,
               "output_tokens": output_tokens, "cost_usd": round(cost_usd, 6)}
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
