"""Suggestions need a readable name and a real, current rhythm; "cheaper
at" needs another chain (owner, 2026-11-01: a Costco card suggested
"costco-1736931", last bought 363 days ago on a 136-day rhythm, "cheaper
at COSTCO SUNNYVALE" against another Costco)."""
import unittest
from datetime import date, timedelta

from api import prices, state
from api.patterns.engine import summarize


def buys(item_id, days_ago, today, store="Costco Newark", price=10.0):
    return [{"item_id": item_id, "event_type": "purchase", "allocation": "HOUSEHOLD",
             "date": (today - timedelta(days=d)).isoformat(), "qty": 1, "price": price,
             "store_id": store} for d in days_ago]


class TestLongCycleNeedsEstablishedRhythm(unittest.TestCase):
    today = date(2026, 11, 1)

    def pat(self, days_ago):
        return summarize(buys("x", days_ago, self.today), as_of=self.today.isoformat())[0]

    def test_the_screenshot_case_is_lapsed_and_not_established(self):
        # 5 buys about 136 days apart, the last one 363 days ago.
        p = self.pat([363 + 136 * k for k in range(5)])
        self.assertEqual(p["history_state"], "lapsed")
        self.assertFalse(state._established(p))

    def test_a_steady_current_long_cycle_is_established(self):
        p = self.pat([100 + 90 * k for k in range(5)])  # every 90 days, 100 since
        self.assertEqual(p["history_state"], "pattern")
        self.assertTrue(state._established(p))

    def test_a_long_cycle_with_three_buys_is_not_enough(self):
        self.assertFalse(state._established(self.pat([95, 185, 275])))

    def test_a_ragged_long_cycle_is_not_established(self):
        self.assertFalse(state._established(self.pat([80, 150, 400, 470])))  # gaps 70,250,70

    def test_a_long_cycle_overdue_past_1_5x_is_not_established(self):
        self.assertFalse(state._established(self.pat([140 + 90 * k for k in range(5)])))

    def test_frequent_items_keep_the_usual_rule(self):
        p = self.pat([20, 34, 48])  # every 14 days, three buys
        self.assertTrue(state._established(p))

    def test_a_weekly_item_after_a_short_break_stays_due(self):
        p = self.pat([30, 37, 44, 51])  # every 7 days, 30 since: 4.3x but only a month
        self.assertEqual(p["history_state"], "lapsed")  # over 4x its rhythm
        p = self.pat([20, 27, 34, 41])  # under 4x, short absolute gap
        self.assertEqual(p["history_state"], "pattern")


class TestReadableNames(unittest.TestCase):
    def test_raw_ids_are_unreadable(self):
        self.assertTrue(state._unreadable("costco-1736931", "costco-1736931"))
        self.assertTrue(state._unreadable("COSTCO-42", "x"))
        self.assertTrue(state._unreadable("", "x"))
        self.assertFalse(state._unreadable("Kirkland Eggs", "costco-1"))


class TestCheaperNeedsAnotherChain(unittest.TestCase):
    today = date(2026, 11, 1)

    def test_two_costco_warehouses_are_not_a_deal(self):
        rows = (buys("x", [10, 40], self.today, "Costco Newark", 15.99)
                + buys("x", [400], self.today, "COSTCO SUNNYVALE", 13.99)
                + buys("x", [500], self.today, "Costco", 13.99))
        self.assertIsNone(prices.item_prices("x", {"entries": rows})["cheaper"])

    def test_another_chain_is_a_deal(self):
        rows = (buys("x", [10, 40], self.today, "Costco Newark", 15.99)
                + buys("x", [20], self.today, "Trader Joe's", 12.99))
        ch = prices.item_prices("x", {"entries": rows})["cheaper"]
        self.assertEqual(ch["store"], "Trader Joe's")

    def test_a_price_over_a_year_older_is_not_a_deal(self):
        rows = (buys("x", [10, 40], self.today, "Costco Newark", 15.99)
                + buys("x", [500], self.today, "Safeway", 12.99))
        self.assertIsNone(prices.item_prices("x", {"entries": rows})["cheaper"])

    def test_chain_of(self):
        self.assertEqual(prices.chain_of("COSTCO SUNNYVALE"), prices.chain_of("Costco - NEWARK"))
        self.assertEqual(prices.chain_of("Costco Wholesale #778 Fremont"), "costco")
        self.assertNotEqual(prices.chain_of("Trader Joe's"), prices.chain_of("Costco"))


if __name__ == "__main__":
    unittest.main()


class TestNumberedNamesGetFixed(unittest.TestCase):
    """An item that showed as "costco-791185" (owner, 2026-11-01)."""

    def setUp(self):
        import os, tempfile
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        state.set_current_user(None)
        self.receipts = [
            {"receipt_id": "a", "purchased_at": "2026-01-02", "lines": [
                {"sku": "791185", "raw": "KS BATH TISSUE", "line_type": "item"},
                {"sku": "555", "raw": "", "line_type": "item"}]},
            {"receipt_id": "b", "purchased_at": "2026-03-02", "lines": [
                {"sku": "791185", "raw": "KS BATH TISS", "decoded_name": "Kirkland Bath Tissue",
                 "line_type": "item"}]}]
        self._orig = state.receipts
        state.receipts = lambda: self.receipts
        state._save("dictionary.json", {"entries": [
            {"item_id": "costco-791185", "sku": "791185", "canonical_name": "costco-791185"}]})

    def tearDown(self):
        state.receipts = self._orig

    def test_a_numbered_dictionary_name_takes_the_receipts_decoded_name(self):
        nm = state.names()
        self.assertEqual(nm["costco-791185"], "Kirkland Bath Tissue")
        self.assertNotIn("costco-555", state.readable_names())

    def test_renaming_teaches_the_dictionary_even_with_no_entry(self):
        state.learn_item_name("costco-555", "Paper Plates")
        self.assertEqual(state.names()["costco-555"], "Paper Plates")
        state.teach_name("791185", "Toilet Paper")
        self.assertEqual(state.names()["costco-791185"], "Toilet Paper")
