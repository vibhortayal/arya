"""A bulk receipt add that fails must say why (2026-11-01: 114 PNG
receipts answered "Added 0 receipts. 114 could not be read." with no
reason), stop on a refusal that every file would hit, and read refund
receipts as negative."""
import os, sys, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from api.decode.service import _refund_totals, _finish
from tests import frontend


def _ret(price):
    return {"line_type": "return", "line_total": price, "unit_price": price, "qty": -1,
            "raw": "2PK BATH SHT", "decoded_name": "2PK BATH SHT", "confidence": 0.9}


class TestRefundTotals(unittest.TestCase):
    def test_all_returns_make_totals_negative_and_reconcile(self):
        lines = [_ret(41.99), _ret(23.99), _ret(41.99)]
        sub, tax, total = _refund_totals(lines, 107.97, 9.85, 117.82)
        self.assertEqual((sub, tax, total), (-107.97, -9.85, -117.82))
        _lines, ok = _finish(lines, sub)
        self.assertTrue(ok)

    def test_a_normal_receipt_is_untouched(self):
        lines = [{"line_type": "item", "line_total": 5.0}]
        self.assertEqual(_refund_totals(lines, 5.0, 0.4, 5.4), (5.0, 0.4, 5.4))


class TestBulkSurfacesReasons(unittest.TestCase):
    def test_bulk_keeps_and_shows_reasons_and_stops_on_refusal(self):
        src = frontend.src_raw("screens/Receipts.tsx")
        self.assertIn("isSystemic", src)
        self.assertIn('t("receipts.bulkWhy"', src)
        self.assertIn("rc-photo-failures", src)
        self.assertIn("if (res.stop)", src)
        self.assertIn("e.status = r.status", frontend.src_raw("ui/AddReceiptSheet.tsx"))


if __name__ == "__main__":
    unittest.main()
