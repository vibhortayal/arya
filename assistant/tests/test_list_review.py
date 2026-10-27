import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient


def seed_owner(c):
    import importlib.util, shutil
    base = os.environ["ARYA_DATA_DIR"]
    spec = importlib.util.spec_from_file_location(
        "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    gen.main(base)
    os.makedirs(os.path.join(base, "users"), exist_ok=True)
    shutil.copytree(os.path.join(base, "users", "demo"), os.path.join(base, "users", "owner"))
    c.post("/auth/setup", json={"username": "owner", "password": "pw"})


class TestListEditing(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api.main import app
        self.c = TestClient(app)
        seed_owner(self.c)

    def list_names(self):
        home = self.c.get("/api/home").json()
        return {i["name"]: i for i in home["list"]["items"]}, home

    def test_remove_and_readd(self):
        items, _ = self.list_names()
        self.assertIn("Whole Milk 1 gal", items)
        self.c.post("/api/list/remove", json={"item_id": "demo-milk"})
        items, home = self.list_names()
        self.assertNotIn("Whole Milk 1 gal", items)
        # the waiting cart follows the list
        self.assertNotIn("Whole Milk 1 gal", [i["name"] for i in home["cart"]["items"]])
        self.c.post("/api/list/add", json={"item_id": "demo-milk"})
        items, _ = self.list_names()
        self.assertIn("Whole Milk 1 gal", items)

    def test_add_tracked_and_free_text(self):
        self.c.post("/api/list/add", json={"item_id": "demo-yogurt"})
        self.c.post("/api/list/add", json={"name": "Oat Milk"})
        items, _ = self.list_names()
        self.assertIn("Greek Yogurt 32 oz", items)
        self.assertIn("Oat Milk", items)

    def test_qty_and_check(self):
        self.c.post("/api/list/qty", json={"item_id": "demo-milk", "qty": 3})
        self.c.post("/api/list/check", json={"item_id": "demo-bread", "checked": True})
        items, home = self.list_names()
        self.assertEqual(items["Whole Milk 1 gal"]["qty"], 3)
        self.assertTrue(items["Sourdough Loaf"].get("checked"))
        # checked items leave the prepared cart
        self.assertNotIn("Sourdough Loaf", [i["name"] for i in home["cart"]["items"]])

    def test_unresolved_names_stay_off_the_list(self):
        path = os.path.join(os.environ["ARYA_DATA_DIR"], "users", "owner", "dictionary.json")
        d = json.load(open(path))
        for e in d["entries"]:
            if e["item_id"] == "demo-milk":
                e["resolution"] = {"status": "unresolved", "candidates": []}
        json.dump(d, open(path, "w"))
        items, _ = self.list_names()
        self.assertNotIn("Whole Milk 1 gal", items)

    def test_candidates(self):
        d = self.c.get("/api/list/candidates").json()
        names = {c["name"]: c for c in d["candidates"]}
        self.assertIn("Greek Yogurt 32 oz", names)
        self.assertTrue(names["Whole Milk 1 gal"]["on_list"])


class TestReviewActions(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state
        from api.decode.service import normalize_costco_json
        golden = os.path.join(os.path.dirname(__file__), "..", "golden", "synthetic-costco-receipt.json")
        rec = normalize_costco_json(json.load(open(golden)))
        rec["lines"][0]["status"] = "unverified"
        state.set_current_user(None)
        state.add_receipts([rec])
        # an unresolved dictionary entry
        d = state.dictionary()
        d["entries"] = [{"item_id": "costco-999", "sku": "999", "canonical_name": "KS BLUBERY",
                          "kind": "product", "aliases": [],
                          "resolution": {"status": "unresolved", "candidates": ["KS Blueberry Muffins"]}}]
        state._save("dictionary.json", d)
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/setup", json={"username": "owner", "password": "pw"})

    def test_confirm_and_resolve(self):
        q = self.c.get("/api/review").json()
        self.assertGreaterEqual(len(q["lines"]), 1)
        self.assertEqual(len(q["unresolved"]), 1)
        for line in list(q["lines"]):
            self.c.post("/api/review/line", json={"receipt_id": line["receipt_id"], "idx": line["idx"], "action": "confirm"})
        self.c.post("/api/review/resolve", json={"item_id": "costco-999", "name": "KS Blueberry Muffins"})
        q = self.c.get("/api/review").json()
        self.assertEqual(q["lines"], [])
        self.assertEqual(q["unresolved"], [])

    def test_rename_teaches_dictionary(self):
        from api import state
        q = self.c.get("/api/review").json()
        line = q["lines"][0]
        self.c.post("/api/review/line", json={"receipt_id": line["receipt_id"], "idx": line["idx"],
                                              "action": "rename", "name": "Fixed Name"})
        q = self.c.get("/api/review").json()
        self.assertNotIn((line["receipt_id"], line["idx"]),
                         [(l["receipt_id"], l["idx"]) for l in q["lines"]])


if __name__ == "__main__":
    unittest.main()


class TestSkuGrouping(unittest.TestCase):
    """Costco re-SKUs the same product: patterns key on the product."""

    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state
        from api.decode.service import normalize_costco_json
        self.state = state
        state.set_current_user(None)

        def receipt(barcode, date, sku):
            return normalize_costco_json({
                "warehouseName": "TEST", "documentType": "WarehouseReceiptDetail",
                "transactionDate": date, "transactionType": "Sales",
                "transactionBarcode": barcode, "totalItemCount": 1,
                "subTotal": 10.0, "taxes": 0.0, "total": 10.0,
                "itemArray": [{"itemNumber": sku, "itemDescription01": "EGGS",
                               "itemDescription02": None, "unit": 1,
                               "amount": 10.0, "taxFlag": "0"}]})
        state.add_receipts([receipt("G-1", "2026-08-01", "111"),
                            receipt("G-2", "2026-08-21", "111"),
                            receipt("G-3", "2026-09-10", "111"),
                            receipt("G-4", "2026-10-26", "222")])
        state._save("dictionary.json", {"entries": [
            {"item_id": "costco-111", "sku": "111", "canonical_name": "Eggs",
             "kind": "product", "aliases": [], "resolution": {"status": "auto", "candidates": []}},
            {"item_id": "costco-222", "sku": "222", "canonical_name": "Eggs",
             "kind": "product", "aliases": [], "resolution": {"status": "auto", "candidates": []}}]})

    def test_one_product_one_pattern(self):
        d = self.state.derived()
        eggs = [p for p in d["patterns"] if p["item_id"] in ("costco-111", "costco-222")]
        self.assertEqual(len(eggs), 1)
        self.assertEqual(eggs[0]["purchase_count"], 4)
        self.assertEqual(eggs[0]["last_bought"], "2026-10-26")
        self.assertFalse(eggs[0]["due"])  # bought on the latest receipt
