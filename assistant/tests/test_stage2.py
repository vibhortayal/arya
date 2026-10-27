import unittest
from api.ledger.build import build_ledger
from api.patterns.engine import summarize, net_purchases
from api.list.build import build_list
from api.cart.build import prepare, approve
from api.reconcile.engine import reconcile


def receipt(rid, day, lines):
    return {"receipt_id": rid, "merchant": "Costco X", "purchased_at": day,
            "lines": lines, "subtotal": 0, "tax": 0, "total": 0, "totals_reconcile": True}


def line(sku, total, ltype="item", qty=1, alloc="HOUSEHOLD", parent=None):
    return {"raw": sku, "sku": sku, "qty": qty, "line_total": total, "line_type": ltype,
            "discount_parent_sku": parent, "allocation": alloc, "item_id": f"costco-{sku}"}


HISTORY = [
    receipt("r1", "2026-01-01", [line("A", 10.0), line("B", 5.0), line("C", 7.0)]),
    receipt("r2", "2026-01-11", [line("A", 10.0), line("D", 3.0, alloc="FOR_OTHERS")]),
    receipt("r3", "2026-01-21", [line("A", 10.0), line("B", 5.0)]),
    receipt("r4", "2026-01-25", [line("B", -5.0, ltype="return")]),
]


class TestStage2(unittest.TestCase):
    def setUp(self):
        self.entries = build_ledger(HISTORY)

    def test_netting_removes_returned(self):
        kept = net_purchases(self.entries)
        b_events = kept["costco-B"]
        self.assertEqual(len(b_events), 1)  # r3 purchase cancelled by the r4 return (FIFO leaves r1? FIFO cancels earliest first)
        self.assertNotIn("costco-D", kept)  # for-others never enters patterns

    def test_pattern_and_due(self):
        pats = {p["item_id"]: p for p in summarize(self.entries, as_of="2026-01-31")}
        a = pats["costco-A"]
        self.assertEqual(a["purchase_count"], 3)
        self.assertEqual(a["median_interval_days"], 10.0)
        self.assertTrue(a["due"])  # 10 days since last, interval 10
        self.assertEqual(pats["costco-C"]["history_state"], "not-enough-history")

    def test_discount_nets_into_price(self):
        rs = [receipt("r9", "2026-02-01", [line("A", 10.0), line("A", -2.0, ltype="discount", parent="A")])]
        es = build_ledger(rs)
        self.assertEqual(len(es), 1)
        self.assertEqual(es[0]["price"], 8.0)

    def test_lapsed_is_not_due(self):
        rs = [receipt("x1", "2026-01-01", [line("E", 4.0)]),
              receipt("x2", "2026-01-06", [line("E", 4.0)]),
              receipt("x3", "2026-01-11", [line("E", 4.0)])]
        pats = {p["item_id"]: p for p in summarize(build_ledger(rs), as_of="2026-06-01")}
        self.assertEqual(pats["costco-E"]["history_state"], "lapsed")
        self.assertFalse(pats["costco-E"]["due"])

    def test_list_and_cart(self):
        pats = summarize(self.entries, as_of="2026-01-31")
        lst = build_list(pats)
        self.assertEqual([i["item_id"] for i in lst["items"]], ["costco-A"])
        cart = prepare(lst, {"costco-A": "Thing A"})
        self.assertEqual(cart["state"], "waiting")
        approve(cart)
        self.assertEqual(cart["state"], "approved")

    def test_reconcile(self):
        trip = receipt("r5", "2026-02-01", [line("A", 10.0), line("Z", 1.0)])
        res = reconcile("t1", ["costco-A", "costco-B"], trip)
        self.assertEqual([m["item_id"] for m in res["matched"]], ["costco-A"])
        self.assertEqual(res["unverified"][0]["item_id"], "costco-B")
        self.assertEqual(res["surprises"][0]["raw"], "Z")


if __name__ == "__main__":
    unittest.main()


def _entry(item_id, dt):
    return {"item_id": item_id, "date": dt, "qty": 1, "price": 5.0,
            "event_type": "purchase", "allocation": "HOUSEHOLD",
            "store_id": "costco"}


class TestEngineFacts(unittest.TestCase):
    def pat(self, dates, as_of):
        entries = [_entry("x", d) for d in dates]
        out = summarize(entries, as_of=as_of)
        return out[0] if out else None

    def test_two_buys_is_not_a_cadence(self):
        p = self.pat(["2026-01-01", "2026-06-30"], "2026-12-27")
        self.assertEqual(p["history_state"], "not-enough-history")
        self.assertFalse(p["due"])

    def test_seasonal_facts_reported(self):
        dates = ["2024-06-05", "2024-07-01", "2024-07-26", "2025-06-10", "2025-07-05", "2025-08-02"]
        p = self.pat(dates, "2026-10-24")
        self.assertEqual(p["analysis"]["seasonal_months"], [5, 6, 7, 8] if p["analysis"]["seasonal_months"] else None)
        self.assertIsNotNone(p["analysis"]["seasonal_months"])

    def test_steady_weekly_still_due(self):
        p = self.pat(["2026-10-01", "2026-10-08", "2026-10-15"], "2026-10-24")
        self.assertEqual(p["history_state"], "pattern")
        self.assertTrue(p["due"])
