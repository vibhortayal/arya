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


class TestResolveMerchants(unittest.TestCase):
    """A receipt filed with no trip: Places names its store (owner,
    2026-10-30). The Places calls are faked; no key, no network."""
    def setUp(self):
        import os, tempfile
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["GOOGLE_PLACES_API_KEY"] = "k"
        from api import places, stores
        self.places, self.stores = places, stores
        self._keep = (places.autocomplete, places.details)
        stores._MISSED.clear()
        self.det = {"street": "8000 Gateway Blvd", "city": "Newark", "state": "CA", "zip": "94560"}
        self.asked = []
        places.autocomplete = lambda q, **k: (self.asked.append(q) or [{"place_id": "p1", "name": "Costco Wholesale", "secondary": ""}])
        places.details = lambda pid: self.det

    def tearDown(self):
        import os
        self.places.autocomplete, self.places.details = self._keep
        os.environ.pop("GOOGLE_PLACES_API_KEY", None)

    def test_merchant_with_a_place_is_filed_and_then_matches_locally(self):
        got = self.stores.resolve_merchants(["Costco Newark #1660"])
        self.assertEqual([s["city"] for s in got], ["Newark"])
        self.assertEqual(self.stores.resolve_merchants(["Costco Wholesale Newark #1660"]), [])
        self.assertEqual(len(self.asked), 1)
        m = storename.merge(["Costco Wholesale #1660", "Costco Newark #1660"], self.stores.directory())
        self.assertEqual(m["Costco Newark #1660"]["sub"], "8000 Gateway Blvd, Newark")

    def test_city_that_google_returns_must_be_in_the_receipt_text(self):
        self.det["city"] = "Newark Valley"
        self.assertEqual(self.stores.resolve_merchants(["Costco Fremont #778"]), [])
        self.assertEqual(self.stores.resolve_merchants(["Costco Fremont #778"]), [])
        self.assertEqual(len(self.asked), 1)   # a miss is not asked twice

    def test_bare_chain_and_unprovisioned_ask_nothing(self):
        import os
        self.assertEqual(self.stores.resolve_merchants(["Costco", "Costco #1660"]), [])
        os.environ.pop("GOOGLE_PLACES_API_KEY")
        self.assertEqual(self.stores.resolve_merchants(["Costco Newark #1660"]), [])
        self.assertEqual(self.asked, [])


class TestTripLinkedReceipts(unittest.TestCase):
    """A receipt settled against a trip takes the trip's store (owner,
    2026-10-30), when the receipt text agrees with it."""
    STORE = {"id": "s1", "name": "Costco Wholesale", "street": "8000 Gateway Blvd", "city": "Newark"}

    def lab(self, merchant, ref="s1"):
        r = {"receipt_id": "r", "merchant": merchant, "store_ref": ref}
        return storename.labels([r], stores=[self.STORE])["r"]

    def test_linked_receipt_takes_the_trips_store(self):
        self.assertEqual(self.lab("Costco #1660"), {"label": "Costco Newark", "sub": "8000 Gateway Blvd, Newark"})
        self.assertEqual(self.lab("Costco Wholesale Newark #1660")["label"], "Costco Newark")

    def test_a_receipt_from_another_city_or_chain_keeps_its_own_text(self):
        self.assertEqual(self.lab("Costco Fremont #778")["label"], "Costco Fremont")
        self.assertEqual(self.lab("Safeway")["label"], "Safeway")

    def test_unknown_or_missing_link_falls_back(self):
        self.assertEqual(self.lab("Costco Fremont #778", ref="gone")["label"], "Costco Fremont")
        self.assertEqual(self.lab("Safeway", ref=None)["label"], "Safeway")


class TestOwnerReceipts(unittest.TestCase):
    """The spellings on the owner's 114-receipt batch (2026-11-01)."""
    RAWS = ["Costco Wholesale", "Costco Wholesale Sunnyvale #423", "SUNNYVALE #423", "COSTCO WHOLESALE",
            "COSTCO WHOLESALE CYPRESS CA #748", "COSTCO WHOLESALE SUNNYVALE #423", "Costco",
            "Costco Wholesale - CYPRESS CA #748", "FREMONT #778", "Costco Wholesale Fremont #778",
            "COSTCO WHOLESALE SANTA CLARA #129"]

    def test_one_readable_name_per_store(self):
        m = storename.merge(self.RAWS, stores=[])
        for raw in ("Costco Wholesale Sunnyvale #423", "SUNNYVALE #423", "COSTCO WHOLESALE SUNNYVALE #423"):
            self.assertEqual(m[raw]["label"], "Costco Sunnyvale")
        for raw in ("COSTCO WHOLESALE CYPRESS CA #748", "Costco Wholesale - CYPRESS CA #748"):
            self.assertEqual(m[raw]["label"], "Costco Cypress")
        self.assertEqual(m["FREMONT #778"]["label"], "Costco Fremont")
        self.assertEqual(m["COSTCO WHOLESALE SANTA CLARA #129"]["label"], "Costco Santa Clara")

    def test_bare_names_stay_honest(self):
        m = storename.merge(self.RAWS, stores=[])
        for raw in ("Costco Wholesale", "COSTCO WHOLESALE", "Costco"):
            self.assertEqual(m[raw]["label"], "Costco, location unknown")

    def test_address_read_from_the_photo_wins(self):
        recs = [{"receipt_id": "a", "merchant": "Costco Wholesale",
                 "store_info": {"chain": "Costco", "city": "SUNNYVALE", "number": "423"}},
                {"receipt_id": "b", "merchant": "COSTCO WHOLESALE SUNNYVALE #423"},
                {"receipt_id": "c", "merchant": "Costco Wholesale"}]
        out = storename.labels(recs, stores=[])
        self.assertEqual(out["a"]["label"], "Costco Sunnyvale")
        self.assertEqual(out["b"]["label"], "Costco Sunnyvale")
        self.assertEqual(out["c"]["label"], "Costco, location unknown")


class TestStoreInfoFromPhoto(unittest.TestCase):
    def test_reader_address_is_kept_on_the_receipt(self):
        from api.decode import service
        dec = {"store": "COSTCO WHOLESALE", "date": "2026-10-01", "lines": [], "subtotal": 0, "tax": 0, "total": 0,
               "store_info": {"chain": "Costco", "number": "423", "street": "", "city": "Sunnyvale", "state": None, "zip": "94086"}}
        rec = service._photo_record(dec, b"x", "m")
        self.assertEqual(rec["store_info"], {"chain": "Costco", "number": "423", "city": "Sunnyvale", "zip": "94086"})
        self.assertNotIn("store_info", service._photo_record({**dec, "store_info": None}, b"y", "m"))


class TestReceiptMeta(unittest.TestCase):
    def test_everything_printed_is_kept_and_numbers_are_cut_to_four_digits(self):
        from api.decode import service
        meta = service.clean_receipt_meta({
            "phone": "(408) 730-9034", "time": "14:07", "register": "Reg 12", "transaction_no": "0042 0113",
            "cashier": "Maria", "member_last4": "111122223333",
            "payments": [{"method": "VISA", "last4": "4111111111111234", "amount": 214.38}, {"method": "", "amount": 1}],
            "tax_lines": [{"label": "TAX A", "amount": 3.1}, {"label": "x"}],
            "other": ["Thank you for shopping", "Card 4111111111111234 approved"], "junk": "dropped"})
        self.assertEqual(meta["member_last4"], "3333")
        self.assertEqual(meta["payments"], [{"method": "VISA", "last4": "1234", "amount": 214.38}])
        self.assertEqual(meta["tax_lines"], [{"label": "TAX A", "amount": 3.1}])
        self.assertNotIn("junk", meta)
        self.assertNotIn("4111111111111234", " ".join(meta["other"]))
        self.assertEqual(meta["phone"], "(408) 730-9034")

    def test_photo_record_and_backfill_keep_lines_untouched(self):
        import os, tempfile
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state
        from api.decode import service
        dec = {"store": "COSTCO WHOLESALE", "date": "2026-10-01", "lines": [], "subtotal": 0, "tax": 0, "total": 0,
               "store_info": {"chain": "Costco", "city": "Sunnyvale", "number": "423"},
               "receipt_meta": {"cashier": "Maria"}}
        rec = service._photo_record(dec, b"z", "m")
        self.assertEqual(rec["receipt_meta"], {"cashier": "Maria"})
        rec.update(receipt_id="bf1", merchant="Costco Wholesale", purchased_at="2026-10-01", lines=[
            {"raw": "MILK", "decoded_name": "Milk", "qty": 1, "line_total": 3.0, "line_type": "item", "status": "auto"}])
        rec.pop("store_info"); rec.pop("receipt_meta")
        state.set_current_user(None)
        state.add_receipts([rec])
        self.assertTrue(state.set_receipt_store_info("bf1", {"city": "Sunnyvale"}, {"cashier": "Maria"}))
        got = [r for r in state.own_receipts() if r["receipt_id"] == "bf1"][0]
        self.assertEqual(got["store_info"], {"city": "Sunnyvale"})
        self.assertEqual(got["lines"][0]["line_total"], 3.0)
