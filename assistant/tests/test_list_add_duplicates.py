"""One item, one row — audit 2026-10-29.

Typing "eggs" when Eggs is already tracked, or "Egg" after "eggs",
used to make a second row. Exact match after case, spacing and a
plural "s" now reuses the first. "milk" is NOT merged into "Whole
Milk" (a looser match would merge "milk" into "almond milk").
"""
import os, tempfile, unittest
from datetime import date, timedelta

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient  # noqa: E402

from api.list.intake import existing_item_id  # noqa: E402
from tests.test_list_pass import FakeClient, seed_receipt  # noqa: E402

ENTRIES = [{"item_id": "costco-2002", "canonical_name": "Eggs", "aliases": ["Organic Eggs"]},
           {"item_id": "costco-2001", "canonical_name": "Whole Milk", "aliases": []}]


class TestExistingItemId(unittest.TestCase):
    def test_case_plural_and_spacing(self):
        for t in ("eggs", "Egg", " EGGS ", "organic egg"):
            self.assertEqual(existing_item_id(t, ENTRIES, {}), "costco-2002", t)

    def test_looser_matches_stay_separate(self):
        self.assertIsNone(existing_item_id("milk", ENTRIES, {}))
        self.assertIsNone(existing_item_id("egg whites", ENTRIES, {}))
        self.assertIsNone(existing_item_id("", ENTRIES, {}))

    def test_typed_item_is_reused(self):
        fl = {"manual-bagels": {"manual": True, "name": "Bagels"}}
        self.assertEqual(existing_item_id("bagel", ENTRIES, fl), "manual-bagels")
        self.assertEqual(existing_item_id("glass", [], {"manual-glass": {"name": "Glass"}}), "manual-glass")


class TestAddRoutes(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state
        main.MetaClient = FakeClient
        main._login_fails.clear()
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
        seed_receipt(self.c, "Costco", (date.today() - timedelta(days=3)).isoformat(),
                     [("Eggs", "2002", 5.0)], "r1")
        state.set_current_user("t@x.y")
        state._save("dictionary.json", {"entries": ENTRIES[:1]})
        state.set_current_user(None)
        self.state = state

    def rows(self):
        return [(i["item_id"], i["name"]) for i in
                self.c.get("/api/home").json()["list"]["items"]]

    def test_typed_name_of_tracked_item_makes_no_twin(self):
        for t in ("eggs", "Egg"):
            self.c.post("/api/list/add", json={"name": t})
        self.assertEqual(self.rows(), [("costco-2002", "Eggs")])

    def test_repeat_typing_collapses_and_qty_rides(self):
        self.c.post("/api/list/from-text", json={"text": "bagel x3, Bagels"})
        r = [x for x in self.c.get("/api/home").json()["list"]["items"]
             if x["item_id"].startswith("manual-")]
        self.assertEqual(len(r), 1)
