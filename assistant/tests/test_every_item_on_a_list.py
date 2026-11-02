"""Every item on a list (owner, 2026-11-02): "whenever you add item to a
list ... It should ask you to which list it should add it to. If you
don't have any list, it should ask you to create a list before you add
any items." With exactly one list, an add goes straight to it."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        assert self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"}).status_code == 200

    def make(self, name):
        r = self.c.post("/api/lists", json={"name": name, "stores": []})
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def rows(self):
        return {i["name"]: i for i in self.c.get("/api/home").json()["list"]["items"] if i.get("on_list")}


class TestAdds(Base):
    def test_no_lists_asks_to_make_one_and_adds_nothing(self):
        for path, body in (("/api/list/add", {"name": "milk"}),
                           ("/api/list/from-text", {"text": "milk, eggs"}),
                           ("/api/list/import", {"items": [{"name": "milk"}]})):
            r = self.c.post(path, json=body)
            self.assertEqual(r.status_code, 409, path)
            d = r.json()["detail"]
            self.assertEqual(d["code"], "no_lists")
            self.assertIn("Make a list first", d["message"])
        self.assertEqual(self.rows(), {})

    def test_one_list_takes_every_add(self):
        lid = self.make("Groceries")
        self.c.post("/api/list/add", json={"name": "milk"})
        self.c.post("/api/list/from-text", json={"text": "eggs, bread"})
        got = self.rows()
        self.assertEqual({n: r["list"] for n, r in got.items()},
                         {"milk": lid, "eggs": lid, "bread": lid})

    def test_two_lists_ask_which_and_add_nothing(self):
        a, b = self.make("Costco"), self.make("Trader Joe's")
        r = self.c.post("/api/list/from-text", json={"text": "salsa"})
        self.assertEqual(r.status_code, 409)
        d = r.json()["detail"]
        self.assertEqual(d["code"], "pick_list")
        self.assertEqual([l["id"] for l in d["lists"]], [a, b])
        self.assertEqual(d["names"], ["salsa"])
        self.assertNotIn("salsa", self.rows())
        # The app asks, then sends it again with the list.
        self.c.post("/api/list/from-text", json={"text": "salsa", "list_id": b})
        self.assertEqual(self.rows()["salsa"]["list"], b)

    def test_an_item_already_on_a_list_stays_there(self):
        self.make("Costco")
        b = self.make("Trader Joe's")
        iid = self.c.post("/api/list/add", json={"name": "hummus", "list_id": b}).json()["item_id"]
        self.assertEqual(self.c.post("/api/list/add", json={"item_id": iid}).status_code, 200)
        r = self.c.post("/api/list/from-text", json={"text": "hummus"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.rows()["hummus"]["list"], b)

    def test_a_list_photo_with_no_list_to_go_on_returns_the_names(self):
        from unittest import mock
        self.make("Costco"), self.make("Trader Joe's")
        with mock.patch.dict(os.environ, {"MODEL_API_KEY": "test-key"}), \
                mock.patch("api.list.intake.read_list_photo",
                           return_value={"kind": "list", "items": ["oat milk", "eggs"]}), \
                mock.patch("api.routes.lists.new_client", return_value=None):
            r = self.c.post("/api/list/from-photo", content=b"\xff\xd8\xff x",
                            headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 200, r.text)
        out = r.json()
        self.assertEqual((out["added"], out["names"], out["needs_list"]["code"]),
                         (0, ["oat milk", "eggs"], "pick_list"))
        self.assertEqual(self.rows(), {})


class TestDeleteAndOldRows(Base):
    def test_old_list_less_rows_are_filed_on_read(self):
        from api import state
        lid = self.make("Groceries")
        with state.as_user("t@x.y"):
            state.set_flag("manual-salt", {"manual": True, "name": "salt"})
            state.set_flag("manual-oil", {"manual": True, "name": "oil", "list": "l-gone"})
        got = self.rows()
        self.assertEqual((got["salt"]["list"], got["oil"]["list"]), (lid, lid))

    def test_with_two_lists_unplaced_rows_wait_for_a_choice(self):
        from api import state
        self.make("Costco"), self.make("Trader Joe's")
        with state.as_user("t@x.y"):
            state.set_flag("manual-salt", {"manual": True, "name": "salt"})
        self.assertIsNone(self.rows()["salt"].get("list"))


class TestAgents(Base):
    def setUp(self):
        super().setUp()
        tok = self.c.post("/auth/token").json()["token"]
        self.h = {"Authorization": f"Bearer {tok}"}

    def call(self, args):
        r = self.c.post("/api/mcp", headers=self.h, json={
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "add_items", "arguments": args}})
        return r.json()["result"]

    def test_add_items_names_a_list_or_is_told_to_ask(self):
        res = self.call({"items": ["milk"]})
        self.assertTrue(res["isError"])
        self.assertIn("no lists yet", res["content"][0]["text"])
        a, b = self.make("Costco"), self.make("Trader Joe's")
        res = self.call({"items": ["milk"]})
        self.assertTrue(res["isError"])
        self.assertIn("ask the user which list", res["content"][0]["text"])
        self.assertIn("Costco", res["content"][0]["text"])
        res = self.call({"items": ["milk"], "list": "trader joe's"})
        self.assertFalse(res["isError"], res)
        self.assertEqual(self.rows()["milk"]["list"], b)
        res = self.call({"items": ["eggs"], "list": "Nowhere"})
        self.assertTrue(res["isError"])
        self.assertIn("no list called Nowhere", res["content"][0]["text"])


if __name__ == "__main__":
    unittest.main()
