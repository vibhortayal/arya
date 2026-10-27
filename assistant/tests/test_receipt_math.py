import json, os, unittest
from harness.scorers.arithmetic import verify_receipt

GOLDEN = os.path.join(os.path.dirname(__file__), "..", "golden")


class TestReceiptMath(unittest.TestCase):
    def test_golden_fixture_balances(self):
        r = json.load(open(os.path.join(GOLDEN, "synthetic-costco-receipt.json")))
        self.assertTrue(verify_receipt(r))

    def test_tampered_fixture_fails(self):
        r = json.load(open(os.path.join(GOLDEN, "synthetic-costco-receipt.json")))
        r["itemArray"][0]["amount"] = 99.99
        self.assertFalse(verify_receipt(r))


if __name__ == "__main__":
    unittest.main()
