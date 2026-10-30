"""Tidy up with Arya (owner, 2026-10-30): rule-based fixes, undoable."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ.pop("MODEL_API_KEY", None)
from fastapi.testclient import TestClient  # noqa: E402

from api.list import tidy  # noqa: E402


def fresh(case):
    os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
    from api import main
    from api import deps
    deps._login_fails.clear()
    case.c = TestClient(main.app)
    r = case.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
    assert r.status_code == 200, r.text


class TestFind(unittest.TestCase):
    def test_key_ignores_size_and_describers(self):
        self.assertEqual(tidy.key("Whole Milk 1 gal"), tidy.key("milk"))
        self.assertEqual(tidy.key("Organic Lemons"), tidy.key("lemon"))
        self.assertNotEqual(tidy.key("Almond milk"), tidy.key("milk"))

    def test_finds_double_amount_and_errand(self):
        rows = [{"item_id": "manual-milk", "name": "Milk", "qty": 1},
                {"item_id": "manual-whole-milk", "name": "Whole milk 1 gal", "qty": 2},
                {"item_id": "manual-2-lemons", "name": "2 lemons", "qty": 1},
                {"item_id": "manual-call-vet", "name": "Call the vet", "qty": 1, "not_grocery": "other"}]
        kinds = {f["kind"]: f for f in tidy.find(rows)}
        self.assertEqual(set(kinds), {"double", "amount", "errand"})
        self.assertEqual(kinds["double"]["keep"], "manual-milk")
        self.assertEqual((kinds["amount"]["new_name"], kinds["amount"]["qty"]), ("Lemons", 2))

    def test_nothing_to_tidy(self):
        self.assertEqual(tidy.find([{"item_id": "manual-eggs", "name": "Eggs", "qty": 1}]), [])


class TestRoutes(unittest.TestCase):
    def setUp(self):
        fresh(self)
        self.lid = self.c.post("/api/lists", json={"name": "Costco", "stores": ["Costco"]}).json()["id"]
        for n in ("Milk", "Whole milk", "Eggs"):
            self.c.post("/api/list/add", json={"name": n, "list_id": self.lid})

    def names(self):
        return sorted(i["name"] for i in self.c.get("/api/home").json()["list"]["items"]
                      if i.get("on_list") and i.get("list") == self.lid)

    def test_find_apply_and_undo(self):
        fixes = self.c.get("/api/list/tidy", params={"list_id": self.lid}).json()["fixes"]
        self.assertEqual([f["kind"] for f in fixes], ["double"])
        r = self.c.post("/api/list/tidy/apply", json={"fixes": fixes}).json()
        self.assertEqual(r["applied"], 1)
        self.assertEqual(len(self.names()), 2)
        qty = {i["name"]: i.get("qty") for i in self.c.get("/api/home").json()["list"]["items"] if i.get("on_list")}
        self.assertEqual(qty["Milk"], 2)
        self.c.post("/api/list/tidy/undo", json={"undo": r["undo"]})
        self.assertEqual(self.names(), ["Eggs", "Milk", "Whole milk"])
        self.assertEqual(self.c.get("/api/list/tidy", params={"list_id": self.lid}).json()["fixes"][0]["kind"], "double")

    def test_apply_needs_fixes(self):
        self.assertEqual(self.c.post("/api/list/tidy/apply", json={"fixes": []}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
