"""One price per store on every screen (retest 2026-10-31 #11) and the
demo's sample receipt for Just my list (#16), in the Demo Town household."""
import unittest

from tests.test_demo_town import TownCase


class TestOnePrice(TownCase):
    def test_today_item_and_prices_agree(self):
        today = self.c.get("/api/today").json()["home"]["price_by_store"]
        item = self.c.get("/api/items/demo-milk").json()["price_by_store"]
        prices = self.c.get("/api/prices/item/demo-milk").json()["stores"]
        for store, p in prices.items():
            self.assertEqual(item[store]["median"], p["median"], store)
            self.assertEqual(item[store]["last"], p["last"], store)
            if store in today.get("demo-milk", {}):
                self.assertEqual(today["demo-milk"][store]["median"], p["median"], store)

    def test_sample_receipt_for_ticked_items(self):
        before = len(self.c.get("/api/quest/receipts").json()["receipts"])
        self.assertTrue(before)
        r = self.c.post("/api/list/sample-receipt", json={"store": "Trader Jill's", "item_ids": ["demo-milk", "demo-avocado"]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["merchant"], "Trader Jill's")
        self.assertEqual(r.json()["lines"], 2)
        self.assertEqual(len(self.c.get("/api/quest/receipts").json()["receipts"]), before + 1)
        self.assertEqual(self.c.post("/api/list/sample-receipt", json={"item_ids": []}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
