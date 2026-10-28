"""Receipt dates (sweep finding, 2026-10-28): a photo decode returns
the date as printed ('07/29/26'); stored verbatim it crashed every
ISO-only consumer — patterns.summarize raised ValueError, taking
/api/home and the decode route's judge step to 500 with the receipt
already filed. Two-part fix under test: decode normalizes to ISO at
the store boundary, and the pattern engine parses legacy US formats
instead of raising."""
import os, sys, tempfile, unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from api.decode.service import _iso_day
from api.patterns.engine import summarize


class TestIsoDay(unittest.TestCase):
    def test_us_formats_normalize(self):
        self.assertEqual(_iso_day("07/29/26"), "2026-07-29")
        self.assertEqual(_iso_day("7/4/2026"), "2026-07-04")
        self.assertEqual(_iso_day("12/31/99"), "1999-12-31")

    def test_iso_passthrough(self):
        self.assertEqual(_iso_day("2026-07-29"), "2026-07-29")
        self.assertEqual(_iso_day("2026-07-29T17:17:00"), "2026-07-29")

    def test_empty_and_garbage(self):
        self.assertIsNone(_iso_day(None))
        self.assertEqual(_iso_day(""), "")
        self.assertEqual(_iso_day("not a date"), "not a date")


def _e(item, d, price=5.99):
    return {"item_id": item, "event_type": "purchase", "allocation": "SELF",
            "qty": 1, "price": price, "date": d}


class TestSummarizeMixedFormats(unittest.TestCase):
    def test_us_dated_entries_do_not_crash(self):
        out = summarize([_e("x", "2026-07-01"), _e("x", "07/29/26"),
                         _e("x", "2026-08-20")])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["last_bought"], "2026-08-20")
        self.assertEqual(out[0]["purchase_count"], 3)

    def test_ordering_is_chronological_not_lexical(self):
        # String sort would place '07/29/26' before both ISO dates;
        # the median gap must come from true chronology.
        out = summarize([_e("x", "07/29/26"), _e("x", "2026-07-01"),
                         _e("x", "2026-08-20")])
        self.assertEqual(out[0]["median_interval_days"], 25.0)

    def test_unparseable_dates_are_skipped_not_fatal(self):
        out = summarize([_e("x", "2026-07-01"), _e("x", "someday"),
                         _e("y", "someday")])
        by_id = {p["item_id"]: p for p in out}
        self.assertEqual(by_id["x"]["purchase_count"], 1)
        self.assertNotIn("y", by_id)


class TestHomeWithUSDatedReceipt(unittest.TestCase):
    """The live failure, end to end: an account whose only receipt
    carries a US-format purchased_at must still get /api/home."""

    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from tests.test_quest import make_client, setup_account
        make_client(self)
        from api import state
        state._save("dictionary.json", {"entries": [
            {"sku": "01509649", "brand": "", "product": "Alecs Ice Cream BR",
             "canonical_name": "Alecs Ice Cream BR",
             "item_id": "alecs-ice-cream-br"}]})
        state._save("receipts.json", [
            {"receipt_id": "dec-us1", "merchant": "SAFEWAY",
             "purchased_at": "07/29/26", "source_type": "grocery",
             "lines": [{"raw": "ALECS ICE CREAM BR", "sku": "01509649",
                        "decoded_name": "Alecs Ice Cream BR", "qty": 1,
                        "unit_price": 5.99, "line_total": 5.99,
                        "line_type": "item", "status": "auto"}],
             "subtotal": 5.99, "tax": 0, "total": 5.99,
             "totals_reconcile": True}])
        setup_account(self)

    def test_home_survives_us_dated_receipt(self):
        r = self.c.get("/api/home")
        self.assertEqual(r.status_code, 200, r.text[:300])


if __name__ == "__main__":
    unittest.main()
