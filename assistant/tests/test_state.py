import json, os, tempfile, unittest

from api import state
from api.decode.service import normalize_costco_json

GOLDEN = os.path.join(os.path.dirname(__file__), "..", "golden")


class TestState(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()

    def test_import_and_home(self):
        obj = json.load(open(os.path.join(GOLDEN, "synthetic-costco-receipt.json")))
        obj["transactionBarcode"] = "SYNTHETIC-STATE-1"  # avoid collision with the API test's import
        self.assertEqual(state.add_receipts([normalize_costco_json(obj)]), 1)
        self.assertEqual(state.add_receipts([normalize_costco_json(obj)]), 0)  # dedupe
        dash = state.dashboard()
        self.assertEqual(dash["trip_count"], 1)
        self.assertGreater(dash["spend_total"], 0)
        home = state.home() if hasattr(state, "home") else None
        d = state.derived()
        self.assertIn("smart_list", d)

    def test_dateless_receipt_refused(self):
        obj = json.load(open(os.path.join(GOLDEN, "synthetic-costco-receipt.json")))
        dec = normalize_costco_json(obj)
        dec["purchased_at"] = None
        dec["receipt_id"] = "dateless-1"
        self.assertEqual(state.add_receipts([dec]), 0)

    def test_review_queue_shape(self):
        q = state.review_queue()
        self.assertIn("lines", q)
        self.assertIn("unresolved", q)


if __name__ == "__main__":
    unittest.main()
