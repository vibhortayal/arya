"""A package size is not a count (owner, 2026-11-04): "Hummus 10 oz"
on a list is one tub, so the trip, the sample receipt and the haul
review never show "Hummus x10" or "Greek Yogurt 32 oz x32". A count
unit ("2 ct") or no unit still counts."""
import os
import tempfile
import unittest


class TestSizeNotCount(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import haul, itemmeta, quest
        self.haul, self.im, self.q = haul, itemmeta, quest

    def test_count_of(self):
        c = self.im.count_of
        self.assertEqual(c({"qty": 10, "unit": "oz"}), 1)
        self.assertEqual(c({"qty": 32, "unit": "oz"}), 1)
        self.assertEqual(c({"qty": 1, "unit": "gal"}), 1)
        self.assertEqual(c({"qty": 2, "unit": "ct"}), 2)
        self.assertEqual(c({"qty": 6, "unit": "Pack"}), 6)
        self.assertEqual(c({"qty": 3}), 3)
        self.assertEqual(c({"qty": "x"}), 1)
        self.assertEqual(c({}), 1)

    def test_the_trip_keeps_the_unit(self):
        items = self.q.make_items([{"name": "Hummus", "qty": 10, "unit": "oz"}])
        self.assertEqual(items[0]["unit"], "oz")
        self.assertEqual(self.im.count_of(items[0]), 1)

    def test_the_haul_review_takes_one_of_a_sized_package(self):
        sess = {"id": "s1", "items": self.q.make_items([
            {"name": "Greek Yogurt 32 oz", "qty": 32, "unit": "oz"},
            {"name": "Bananas", "qty": 2, "unit": "ct"}])}
        for it in sess["items"]:
            it["checked"] = True
        review = self.haul.match(sess, [])
        qty = {e["name"]: e["qty"] for e in review["grabbed_only"]}
        self.assertEqual(qty, {"Greek Yogurt 32 oz": 1, "Bananas": 2})

    def test_the_sample_receipt_lists_one_tub(self):
        from api import state
        s = self.q.create_session("Trader Joe's", raw_items=[
            {"name": "Hummus", "qty": 10, "unit": "oz"}, {"name": "Bananas", "qty": 2}])
        for it in s["items"]:
            self.q.check_item(s["id"], it["name"], True)
        self.q.sample_receipt(s["id"])
        lines = state.receipts()[-1]["lines"]
        self.assertEqual([(ln["decoded_name"], ln["qty"]) for ln in lines], [("Hummus", 1), ("Bananas", 2)])


if __name__ == "__main__":
    unittest.main()
