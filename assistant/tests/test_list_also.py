"""One item on more than one list (owner, 2026-10-30, option B): adding
from a second list keeps it on both, ticking is per list, Move here moves."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ.pop("MODEL_API_KEY", None)
from fastapi.testclient import TestClient  # noqa: E402


class TestAlso(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        assert self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"}).status_code == 200
        self.a = self.c.post("/api/lists", json={"name": "Costco"}).json()
        self.b = self.c.post("/api/lists", json={"name": "Trader Joe's"}).json()
        self.a = self.a.get("id") or self.a["list"]["id"]
        self.b = self.b.get("id") or self.b["list"]["id"]

    def items(self):
        return {i["name"].lower(): i for i in self.c.get("/api/home").json()["list"]["items"] if i.get("on_list")}

    def id(self, name):
        return self.items()[name.lower()]["item_id"]

    def add(self, name, lid, **kw):
        return self.c.post("/api/list/from-text", json={"text": name, "list_id": lid, **kw}).json()

    def test_second_list_keeps_both(self):
        self.add("Milk", self.a)
        r = self.add("Milk", self.b)
        self.assertEqual([x["list"] for x in r["also"]], ["Costco"])
        it = self.items()["milk"]
        self.assertEqual((it["list"], it["also"]), (self.a, [self.b]))

    def test_tick_is_per_list(self):
        self.add("Milk", self.a); self.add("Milk", self.b)
        self.c.post("/api/list/check", json={"item_id": self.id("Milk"), "list_id": self.b, "checked": True})
        it = self.items()["milk"]
        self.assertEqual(it["checked_in"], [self.b])
        self.assertFalse(it.get("checked"))
        self.c.post("/api/list/check", json={"item_id": self.id("Milk"), "list_id": self.a, "checked": True})
        self.assertTrue(self.items()["milk"].get("checked"))

    def test_move_here_leaves_the_old_list(self):
        self.add("Milk", self.a); self.add("Milk", self.b)
        self.c.post("/api/list/move", json={"item_id": self.id("Milk"), "list_id": self.b})
        it = self.items()["milk"]
        self.assertEqual(it["list"], self.b)
        self.assertNotIn("also", it)

    def test_also_endpoint_adds_and_removes(self):
        self.add("Eggs", self.a)
        self.c.post("/api/list/also", json={"item_id": self.id("Eggs"), "list_id": self.b})
        self.assertEqual(self.items()["eggs"]["also"], [self.b])
        self.c.post("/api/list/also", json={"item_id": self.id("Eggs"), "list_id": self.b, "on": False})
        self.assertNotIn("also", self.items()["eggs"])

    def test_remove_from_one_list_keeps_the_other(self):
        self.add("Milk", self.a); self.add("Milk", self.b)
        mid = self.id("Milk")
        self.c.post("/api/list/remove", json={"item_id": mid, "list_id": self.a})
        it = self.items()["milk"]
        self.assertEqual(it["list"], self.b)
        self.assertNotIn("also", it)
        self.c.post("/api/list/remove", json={"item_id": mid, "list_id": self.b})
        self.assertNotIn("milk", self.items())

    def test_move_out_of_the_extra_list_keeps_the_main_one(self):
        self.add("Milk", self.a); self.add("Milk", self.b)
        c3 = self.c.post("/api/lists", json={"name": "Corner"}).json()["id"]
        self.c.post("/api/list/move", json={"item_id": self.id("Milk"), "list_id": c3, "from_list": self.b})
        it = self.items()["milk"]
        self.assertEqual((it["list"], it["also"]), (self.a, [c3]))

    def test_quest_plan_carries_the_extra_lists(self):
        self.add("Milk", self.a); self.add("Milk", self.b)
        row = [r for r in self.c.get("/api/quest/plan").json()["list"] if r["name"].lower() == "milk"][0]
        self.assertEqual((row["list"], row["also"]), (self.a, [self.b]))

    def test_item_page_knows_when_it_is_on_a_list(self):
        self.add("Milk", self.a)
        self.assertTrue(self.c.get("/api/items/" + self.id("Milk")).json()["on_list"])

    def test_bulk_import_move_mode(self):
        self.add("Milk", self.a)
        self.c.post("/api/list/import", json={"list_id": self.b, "mode": "move", "items": [{"name": "Milk"}]})
        it = self.items()["milk"]
        self.assertEqual(it["list"], self.b)
        self.assertNotIn("also", it)

    def test_everything_else_item_just_moves(self):
        self.add("Rice", None)
        self.add("Rice", self.a)
        it = self.items()["rice"]
        self.assertEqual(it["list"], self.a)
        self.assertNotIn("also", it)


if __name__ == "__main__":
    unittest.main()
