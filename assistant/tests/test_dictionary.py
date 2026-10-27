import unittest
from api.decode.service import normalize_costco_json
from api.dictionary.build import aggregate, expand


def receipt(barcode, date, items, rtype="Sales"):
    return normalize_costco_json({
        "transactionBarcode": barcode, "transactionDate": date,
        "transactionType": rtype, "warehouseName": "X", "subTotal": sum(i[2] for i in items),
        "taxes": 0, "total": sum(i[2] for i in items),
        "itemArray": [{"itemNumber": n, "itemDescription01": d, "itemDescription02": None,
                       "unit": 1, "amount": a} for n, d, a in items]})


class TestDictionary(unittest.TestCase):
    def test_expand(self):
        self.assertEqual(expand("ORG SPINACH"), "Organic Spinach")
        self.assertEqual(expand("KS EGG WHITE"), "Kirkland Signature Egg White")

    def test_aggregate_and_fees(self):
        rs = [receipt("1", "2026-01-01", [("96716", "ORG SPINACH", 5.39), ("1254", "CA REDEMP VAL T EI/99", 0.30)]),
              receipt("2", "2026-01-08", [("96716", "ORG SPINACH", 3.99)])]
        entries = {e["sku"]: e for e in aggregate(rs)}
        self.assertEqual(entries["96716"]["purchase_count"], 2)
        self.assertEqual(entries["96716"]["canonical_name"], "Organic Spinach")
        self.assertEqual(entries["1254"]["kind"], "fee")


if __name__ == "__main__":
    unittest.main()
