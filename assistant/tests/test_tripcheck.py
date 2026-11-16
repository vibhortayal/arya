import unittest
from api import tripcheck


def rec(*names):
    return {"merchant": "Trader Joe's", "lines": [{"line_type": "item", "decoded_name": n, "qty": 1} for n in names]}


class TripCheck(unittest.TestCase):
    def test_full_match_is_quiet_and_uses_list_names(self):
        r = tripcheck.check(rec("MILK ORGANIC GALLON LOW", "BANANA ORG EACH", "EGGS LARGE BROWN ORGANIC", "APPLE EACH HONEYCRISP"),
                            ["Milk - Organic", "Banana", "Eggs - Pasture Raised", "Apple"])
        self.assertTrue(r["quiet"], r)
        self.assertEqual(r["matched"], 4)

    def test_list_item_missing_and_extra_on_receipt(self):
        r = tripcheck.check(rec("MILK ORGANIC GALLON LOW", "CHOCOLATE BAR"), ["Milk - Organic", "Bread"])
        self.assertFalse(r["quiet"])
        self.assertEqual(r["list_only"], ["Bread"])
        self.assertEqual(r["receipt_only"], ["CHOCOLATE BAR"])


if __name__ == "__main__":
    unittest.main()
