"""cost_ledger — one row per API call (IMPLEMENTATION §2.4).

Rows are JSON lines: time, mode, model, input/cached/output tokens, cost.
The ledger totals render against the $150 credit ceiling (plan §8).
"""
import json, os, time

BUDGET_USD = 150.0


class CostLedger:
    def __init__(self, path):
        self.path = path

    def record(self, mode, model, input_tokens, cached_tokens, output_tokens, cost_usd):
        row = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "mode": mode, "model": model,
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

    def spent_today(self):
        today = time.strftime("%Y-%m-%d")
        return round(sum(r["cost_usd"] for r in self.rows()
                         if str(r.get("ts", "")).startswith(today)), 4)
