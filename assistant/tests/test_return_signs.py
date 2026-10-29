"""Returns keep a NEGATIVE amount and quantity on receipts (owner,
2026-10-29), and every consumer treats them as a refund: spend nets,
a return is not a purchase, and a negative unit price is no price."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

from api.decode.service import decode_photo, sign_returns  # noqa: E402
from api.ledger.build import build_ledger  # noqa: E402
from api.patterns.engine import net_purchases  # noqa: E402
from api import prices  # noqa: E402


class PhotoClient:
    """Returns a photo read the way the model does: a refund printed positive."""
    def chat(self, messages, **k):
        import json
        return json.dumps({"store": "Trader Joe's", "date": "2026-10-05", "lines": [
            {"item_no": "111", "product": "Chicken Thighs", "price": 12.30, "qty": 2,
             "is_return": True, "confidence": 0.95},
            {"item_no": "222", "product": "Bananas", "price": 1.50, "qty": 1,
             "is_return": False, "confidence": 0.95}],
            "subtotal": -10.80, "tax": 0, "total": -10.80}), 0, 0


class TestSignReturns(unittest.TestCase):
    def test_positive_return_is_flipped_negative(self):
        ln = {"raw": "Milk", "line_type": "return", "qty": 1, "unit_price": 4.99, "line_total": 4.99}
        sign_returns([ln])
        self.assertEqual((ln["line_total"], ln["unit_price"], ln["qty"]), (-4.99, -4.99, -1))

    def test_negative_return_keeps_its_sign(self):
        ln = {"raw": "Milk", "line_type": "return", "qty": -2, "unit_price": -2.5, "line_total": -5.0}
        sign_returns([ln])
        self.assertEqual((ln["line_total"], ln["unit_price"], ln["qty"]), (-5.0, -2.5, -2))

    def test_label_makes_a_return(self):
        for label in ("REFUND Milk", "Return - Eggs", "VOID bread", "Credit: Butter"):
            ln = {"raw": label, "line_type": "item", "qty": 1, "line_total": 3.0}
            sign_returns([ln])
            self.assertEqual(ln["line_type"], "return", label)
            self.assertEqual(ln["line_total"], -3.0)

    def test_plain_item_and_discount_untouched(self):
        item = {"raw": "Returnable Bottles", "line_type": "item", "qty": 1, "line_total": 1.0}
        disc = {"raw": "/ 1234", "line_type": "discount", "qty": 1, "line_total": -2.0}
        sign_returns([item, disc])
        self.assertEqual((item["line_type"], item["line_total"]), ("item", 1.0))
        self.assertEqual(disc["line_total"], -2.0)


class TestPhotoReturn(unittest.TestCase):
    def test_photo_return_is_stored_negative_and_reconciles(self):
        rec = decode_photo(b"img", PhotoClient())
        ret = next(l for l in rec["lines"] if l["line_type"] == "return")
        self.assertEqual((ret["line_total"], ret["unit_price"], ret["qty"]), (-12.30, -12.30, -2))
        self.assertEqual(sum(l["line_total"] for l in rec["lines"]), -10.80)
        self.assertTrue(rec["totals_reconcile"])


def _receipt(rid, day, lines):
    return {"receipt_id": rid, "purchased_at": day, "merchant": "Trader Joe's", "lines": lines}


def _line(sku, kind, total, qty):
    return {"sku": sku, "line_type": kind, "line_total": total, "qty": qty,
            "decoded_name": "Chicken"}


class TestLedgerAndPatterns(unittest.TestCase):
    def setUp(self):
        self.entries = build_ledger([
            _receipt("a", "2026-10-03", [_line("1", "item", 24.60, 2)]),
            # filed before returns were signed: positive amount, still a refund
            _receipt("b", "2026-10-05", [_line("1", "return", 12.30, -1)])])

    def test_return_entry_is_negative_price_positive_qty(self):
        ret = next(e for e in self.entries if e["event_type"] == "return")
        self.assertEqual((ret["price"], ret["qty"]), (-12.30, 1))

    def test_return_is_not_a_purchase_for_running_low(self):
        kept = net_purchases(self.entries)
        self.assertEqual(sum(p["qty"] for p in kept["costco-1"]), 1)

    def test_returned_everything_leaves_nothing_kept(self):
        entries = build_ledger([
            _receipt("a", "2026-10-03", [_line("1", "item", 12.30, 1)]),
            _receipt("b", "2026-10-05", [_line("1", "return", -12.30, -1)])])
        self.assertEqual(net_purchases(entries), {})

    def test_negative_unit_price_is_no_price_point(self):
        ret = next(e for e in self.entries if e["event_type"] == "return")
        self.assertIsNone(prices.unit_price(ret))


class TestReceiptsApi(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps

        class Fake:
            def __init__(self, *a, **k): pass
            def chat(self, *a, **k): raise AssertionError("no model")
        deps.MetaClient = Fake
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "ret@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text

    def _file(self, rid, day, lines, total):
        r = self.c.post("/api/intake/structured", json={
            "merchant": "Trader Joe's", "purchased_at": day, "receipt_id": rid,
            "lines": lines, "subtotal": total, "tax": 0, "total": total})
        assert r.status_code == 200, r.text

    def test_return_receipt_shows_negative_and_nets_spend(self):
        self._file("buy", "2026-10-03", [
            {"decoded_name": "Chicken", "sku": "1", "line_total": 12.30, "qty": 1,
             "confidence": 0.95}], 12.30)
        # the reader gave the refund as a positive number next to a label
        self._file("ret", "2026-10-05", [
            {"decoded_name": "Chicken", "sku": "1", "line_total": 4.99, "qty": 1,
             "line_type": "return", "confidence": 0.95}], -4.99)
        detail = self.c.get("/api/quest/receipts/ret").json()
        line = detail["lines"][0]
        self.assertEqual((line["line_total"], line["qty"]), (-4.99, -1))
        self.assertEqual(detail["returns_total"], -4.99)
        d = self.c.get("/api/dashboard").json()
        self.assertEqual(d["spend_total"], 7.31)
        self.assertEqual(d["returns_total"], 4.99)
        self.assertEqual(d["spend_by_month"]["2026-10"], 7.31)


if __name__ == "__main__":
    unittest.main()
