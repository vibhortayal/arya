import json, os, unittest

from api.decode import checks, service


def rec(lines, sub=None, tax=0.0, total=None, **kw):
    ls = [{"raw": n, "decoded_name": n, "sku": s, "qty": 1, "line_total": p, "line_type": "item",
           "confidence": 0.95, "status": "auto"} for n, s, p in lines]
    s = round(sum(p for _, _, p in lines), 2) if sub is None else sub
    r = {"lines": ls, "subtotal": s, "tax": tax, "total": s + tax if total is None else total,
         "totals_reconcile": abs(sum(p for _, _, p in lines) - s) <= 0.05}
    r.update(kw)
    return r


BASE = [("MILK", "1", 3.99), ("EGGS", "2", 7.49), ("BREAD", "3", 4.29), ("CHEESE", "4", 12.99)]


class TestChecks(unittest.TestCase):
    def test_clean_read_passes(self):
        self.assertEqual(checks.validate(rec(BASE, items_sold=4)), [])

    def test_misread_digit_breaks_the_sum(self):
        bad = rec(BASE, sub=28.76)
        bad["lines"][1]["line_total"] = 1.49
        bad["totals_reconcile"] = False
        self.assertIn("lines_do_not_add_up", checks.validate(bad))

    def test_total_mismatch(self):
        self.assertIn("total_mismatch", checks.validate(rec(BASE, tax=1.0, total=30.0)))

    def test_item_count_mismatch(self):
        self.assertIn("item_count_mismatch", checks.validate(rec(BASE, items_sold=5)))

    def test_bad_price(self):
        for p in (0, -1, 99999):
            r = rec([("A", "1", p)] + BASE[1:], sub=sum(x[2] for x in BASE[1:]) + p)
            self.assertIn("bad_price", checks.validate(r))

    def test_unsure_share(self):
        r = rec(BASE)
        for l in r["lines"][:2]:
            l["confidence"] = 0.3
        self.assertIn("many_unsure_lines", checks.validate(r))

    def test_swapped_prices_pass_arithmetic_but_not_history(self):
        swapped = rec([("MILK", "1", 12.99), ("EGGS", "2", 7.49), ("BREAD", "3", 4.29), ("CHEESE", "4", 3.99)])
        self.assertEqual(checks.validate(swapped), [])  # the known gap
        known = {"1": [3.99, 4.09], "4": [12.99]}
        self.assertIn("price_changed", checks.validate(swapped, known))
        self.assertEqual(checks.validate(rec(BASE), known), [])

    def test_no_lines(self):
        self.assertEqual(checks.validate({"lines": []}), ["no_lines"])


class FakeClient:
    """Returns canned JSON per mode and counts calls."""
    def __init__(self, spark, wonder=None, spark_err=False, wonder_err=False):
        self.out = {"standard": spark, "wonder": wonder}
        self.err = {"standard": spark_err, "wonder": wonder_err}
        self.calls = []

    def chat(self, messages, mode="standard", **kw):
        self.calls.append(mode)
        if self.err[mode]:
            raise RuntimeError("down")
        return json.dumps(self.out[mode]), {}, 0.0


def dec(prices, subtotal=None, **kw):
    d = {"store": "Costco", "date": "2026-10-01",
         "lines": [{"item_no": str(i), "product": f"P{i}", "price": p, "qty": 1, "confidence": 0.95}
                   for i, p in enumerate(prices)],
         "subtotal": sum(prices) if subtotal is None else subtotal, "tax": 0, "total": sum(prices)}
    d.update(kw)
    return d


class TestAutoReader(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_PHOTO_READER"] = "auto"
        os.environ["ARYA_DATA_DIR"] = __import__("tempfile").mkdtemp()

    def tearDown(self):
        os.environ.pop("ARYA_PHOTO_READER", None)

    def test_good_spark_read_stays_on_spark(self):
        c = FakeClient(dec([3.99, 7.49, 4.29]))
        r = service.decode_photo(b"img1", c)
        self.assertEqual(c.calls, ["standard"])
        self.assertEqual(r["decoded_by"], service.spark_model())
        self.assertNotIn("second_read", r)

    def test_failed_check_goes_to_wonder(self):
        c = FakeClient(dec([3.99, 1.49, 4.29], subtotal=15.77), dec([3.99, 7.49, 4.29]))
        r = service.decode_photo(b"img2", c)
        self.assertEqual(c.calls, ["standard", "wonder"])
        self.assertEqual(r["decoded_by"], service.MODELS["wonder"])
        self.assertIn("lines_do_not_add_up", r["second_read"])

    def test_spark_down_goes_to_wonder(self):
        c = FakeClient(None, dec([3.99, 7.49]), spark_err=True)
        r = service.decode_photo(b"img3", c)
        self.assertEqual(r["decoded_by"], service.MODELS["wonder"])
        self.assertEqual(r["second_read"], ["spark_failed"])

    def test_wonder_down_keeps_spark_and_flags_every_line(self):
        c = FakeClient(dec([3.99, 1.49], subtotal=9.0), wonder_err=True)
        r = service.decode_photo(b"img4", c)
        self.assertEqual(r["decoded_by"], service.spark_model())
        self.assertIn("wonder_failed", r["second_read"])
        self.assertTrue(all(l["status"] == "unverified" for l in r["lines"]))

    def test_default_reader_is_unchanged(self):
        os.environ.pop("ARYA_PHOTO_READER")
        c = FakeClient(dec([3.99]), dec([3.99]))
        service.decode_photo(b"img5", c)
        self.assertEqual(c.calls, ["wonder"])


if __name__ == "__main__":
    unittest.main()
