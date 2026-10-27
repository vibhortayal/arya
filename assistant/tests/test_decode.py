import json, os, unittest
from api.decode.service import decode_text, normalize_costco_json

GOLDEN = os.path.join(os.path.dirname(__file__), "..", "golden")


def load(name):
    return json.load(open(os.path.join(GOLDEN, name)))


class StubClient:
    def chat(self, messages, **kw):
        assert kw.get("personal") is True and kw.get("mode") == "standard"
        payload = {"merchant": "Costco", "purchased_at": "2026-10-01",
                   "lines": [
                       {"raw": "ORG SPINACH", "sku": "96716", "decoded_name": "Organic Spinach",
                        "qty": 1, "unit_price": 5.39, "line_total": 5.39, "line_type": "item",
                        "discount_parent_sku": None, "confidence": 0.95, "alternatives": []},
                       {"raw": "SAVINGS", "sku": None, "decoded_name": "Instant Savings",
                        "qty": 1, "unit_price": -1.40, "line_total": -1.40, "line_type": "discount",
                        "discount_parent_sku": None, "confidence": 0.9, "alternatives": []},
                       {"raw": "MYSTERY", "sku": None, "decoded_name": "Unknown Item",
                        "qty": 1, "unit_price": 3.00, "line_total": 3.00, "line_type": "item",
                        "discount_parent_sku": None, "confidence": 0.5, "alternatives": ["A", "B"]}],
                   "subtotal": 6.99, "tax": 0.0, "total": 6.99}
        return json.dumps(payload), {}, 0.01


class TestJsonImport(unittest.TestCase):
    def test_sales_receipt_normalizes(self):
        r = normalize_costco_json(load("synthetic-costco-receipt.json"))
        self.assertTrue(r["totals_reconcile"])
        types = [l["line_type"] for l in r["lines"]]
        self.assertEqual(types, ["item", "item", "discount"])
        disc = r["lines"][2]
        self.assertEqual(disc["discount_parent_sku"], "1063232")  # previous item
        self.assertTrue(all(l["allocation"] == "HOUSEHOLD" for l in r["lines"]))

    def test_refund_lines_are_returns(self):
        r = normalize_costco_json(load("synthetic-costco-refund.json"))
        self.assertTrue(r["totals_reconcile"])
        self.assertEqual(r["lines"][0]["line_type"], "return")
        self.assertEqual(r["lines"][0]["qty"], 1)


class TestDecodeText(unittest.TestCase):
    def test_post_rules(self):
        r = decode_text("any text", StubClient())
        self.assertTrue(r["totals_reconcile"])
        self.assertEqual(r["lines"][0]["status"], "auto")
        self.assertEqual(r["lines"][2]["status"], "unverified")   # low confidence
        self.assertEqual(r["lines"][1]["discount_parent_sku"], "96716")
        self.assertEqual(r["lines"][1]["status"], "unverified")   # inferred attach


class TestApi(unittest.TestCase):
    def test_import_route(self):
        from fastapi.testclient import TestClient
        from api.main import app
        c = TestClient(app)
        resp = c.post("/import/costco-json", json=load("synthetic-costco-receipt.json"))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["totals_reconcile"])
        self.assertEqual(c.post("/import/costco-json", json={"nope": 1}).status_code, 422)
        self.assertEqual(c.get("/health").json()["status"], "ok")


if __name__ == "__main__":
    unittest.main()
