"""An add that names no list goes to the list for the item's usual
store (retest 2026-10-31 #5), in the Demo Town household."""
import unittest

from tests.test_demo_town import TownCase


class TestUsualList(TownCase):
    def test_an_add_goes_to_the_usual_stores_list(self):
        # Retest 2026-10-31 #5: Running low's Add put Whole Milk (mostly
        # bought at Trader Jill's) on Everything else.
        # Every item on a list (owner, 2026-11-02): with two lists Arya asks,
        # with the usual store's list picked first.
        r = self.c.post("/api/list/add", json={"item_id": "demo-milk"})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"]["suggested"], "l-demo-tj")
        self.c.post("/api/list/add", json={"item_id": "demo-milk", "list_id": "l-demo-tj"})
        rows = {i["item_id"]: i for i in self.c.get("/api/home").json()["list"]["items"]}
        self.assertEqual(rows["demo-milk"].get("list"), "l-demo-tj")
        # A list the person names still wins.
        self.c.post("/api/list/add", json={"item_id": "demo-spinach", "list_id": "l-demo-costco"})
        rows = {i["item_id"]: i for i in self.c.get("/api/home").json()["list"]["items"]}
        self.assertEqual(rows["demo-spinach"].get("list"), "l-demo-costco")


if __name__ == "__main__":
    unittest.main()
