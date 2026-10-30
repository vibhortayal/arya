"""One name per real store (owner, 2026-10-30): the receipt's merchant
text is matched to a directory store, else cleaned, and spellings of one
store fold into one label. Deterministic, no model call."""
import unittest

from api import storename
from api.ledger.build import build_ledger
from api.list.grocery import classify

COSTCOS = ["Costco Newark #1660", "Costco Wholesale #778 Fremont",
           "Costco Wholesale Newark #1660", "Costco Pentagon City #233",
           "Costco NE San Jose #1004", "Costco Wholesale #1660", "Costco"]


class TestStoreName(unittest.TestCase):
    def test_spellings_of_one_warehouse_fold_together(self):
        m = storename.merge(COSTCOS, stores=[])
        newark = {m[r]["label"] for r in COSTCOS[:1] + COSTCOS[2:3] + COSTCOS[5:6]}
        self.assertEqual(newark, {"Costco Newark"})
        self.assertEqual(m["Costco Wholesale #778 Fremont"]["label"], "Costco Fremont")
        self.assertEqual(m["Costco Newark #1660"]["sub"], "Store #1660")

    def test_bare_chain_name_is_location_unknown_when_numbered_siblings_exist(self):
        self.assertEqual(storename.merge(COSTCOS, stores=[])["Costco"]["label"], "Costco, location unknown")
        self.assertEqual(storename.merge(["Costco", "Safeway"], stores=[])["Costco"]["label"], "Costco")

    def test_directory_store_gives_label_and_street(self):
        d = [{"name": "Costco Wholesale", "street": "8000 Gateway Blvd", "city": "Newark"}]
        m = storename.merge(COSTCOS, stores=d)
        self.assertEqual(m["Costco Wholesale #1660"], {"label": "Costco Newark", "sub": "8000 Gateway Blvd, Newark"})
        self.assertEqual(m["Costco Wholesale #778 Fremont"]["sub"], "Store #778")

    def test_two_directory_stores_in_one_city_are_not_guessed(self):
        d = [{"name": "Costco Wholesale", "street": "1 A St", "city": "Newark"},
             {"name": "Costco Wholesale", "street": "2 B St", "city": "Newark"}]
        self.assertEqual(storename.merge(["Costco Newark #1"], stores=d)["Costco Newark #1"]["sub"], "Store #1")

    def test_other_chains_pass_through(self):
        self.assertEqual(storename.merge(["Trader Joe's", None], stores=[])["Trader Joe's"]["label"], "Trader Joe's")

    def test_ledger_store_id_is_the_merged_label(self):
        line = {"line_type": "item", "sku": "1", "item_id": "x", "line_total": 5.0, "qty": 1}
        rs = [{"receipt_id": f"r{i}", "merchant": m, "purchased_at": "2026-10-0%d" % (i + 1), "lines": [dict(line)]}
              for i, m in enumerate(["Costco Newark #1660", "Costco Wholesale #1660"])]
        self.assertEqual({e["store_id"] for e in build_ledger(rs)}, {"Costco Newark"})

    def test_delivery_and_air_purifier_are_not_groceries(self):
        for name in ("Uber Eats", "Winix Air Purifier"):
            self.assertEqual(classify(name)["kind"], "other", name)


if __name__ == "__main__":
    unittest.main()
