import os, tempfile, unittest
from api.cost_ledger import CostLedger, BUDGET_USD


class TestCostLedger(unittest.TestCase):
    def test_record_and_totals(self):
        with tempfile.TemporaryDirectory() as d:
            led = CostLedger(os.path.join(d, "ledger.jsonl"))
            led.record("standard", "muse-spark-1.3", 1000, 0, 200, 0.0021)
            led.record("contributor", "muse-spark-1.3-contributor", 5000, 0, 500, 0.0006)
            self.assertEqual(len(led.rows()), 2)
            self.assertAlmostEqual(led.total_usd(), 0.0027, places=6)
            self.assertAlmostEqual(led.remaining_usd(), BUDGET_USD - 0.0027, places=4)


if __name__ == "__main__":
    unittest.main()
