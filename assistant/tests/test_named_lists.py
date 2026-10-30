"""Named lists (owner, 2026-10-29): Costco, Trader Joe's, Indian
Store, Party. An item sits on one list; no list means "Everything
else". Deleting a list never deletes items and Undo restores the
same record. A list may link several stores (for hunts)."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


def fresh(case):
    os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
    from api import main
    from api import deps
    deps._login_fails.clear()
    case.c = TestClient(main.app)
    r = case.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
    assert r.status_code == 200, r.text
    return case.c


def rows(c):
    return {i["name"]: i for i in c.get("/api/home").json()["list"]["items"]}


class TestNamedLists(unittest.TestCase):
    def setUp(self):
        self.c = fresh(self)

    def make(self, name, stores=None):
        r = self.c.post("/api/lists", json={"name": name, "stores": stores or []})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_create_trims_dedupes_and_ships_in_home(self):
        r = self.make("  Costco  ", ["Costco", "costco", "Trader Joe's", ""])
        self.assertEqual(r["name"], "Costco")
        self.assertEqual(r["stores"], ["Costco", "Trader Joe's"])
        self.assertTrue(r["id"].startswith("l-"))
        self.assertEqual(self.c.get("/api/home").json()["lists"], [r])

    def test_name_rules(self):
        self.make("Costco")
        self.assertEqual(self.c.post("/api/lists", json={"name": "  "}).status_code, 400)
        self.assertEqual(self.c.post("/api/lists", json={"name": "COSTCO"}).status_code, 409)
        self.assertEqual(self.c.post("/api/lists", json={"name": "x", "stores": "Costco"}).status_code, 400)

    def test_add_into_a_list_and_leave_others_alone(self):
        l = self.make("Indian Store")
        r = self.c.post("/api/list/from-text", json={"text": "atta, basmati rice", "list_id": l["id"]})
        self.assertEqual(r.json()["added"], 2)
        self.c.post("/api/list/add", json={"name": "dish soap"})
        got = rows(self.c)
        self.assertEqual(got["atta"]["list"], l["id"])
        self.assertEqual(got["basmati rice"]["list"], l["id"])
        self.assertNotIn("list", got["dish soap"])

    def test_add_to_missing_list_is_404_and_writes_nothing(self):
        r = self.c.post("/api/list/add", json={"name": "milk", "list_id": "l-nope"})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.c.post("/api/list/from-text", json={"text": "eggs", "list_id": "l-nope"}).status_code, 404)
        self.assertNotIn("milk", rows(self.c))
        self.assertNotIn("eggs", rows(self.c))

    def test_re_adding_without_a_list_keeps_the_filing(self):
        l = self.make("Costco")
        self.c.post("/api/list/add", json={"name": "eggs", "list_id": l["id"]})
        self.c.post("/api/list/add", json={"name": "eggs"})
        self.assertEqual(rows(self.c)["eggs"]["list"], l["id"])

    def test_move_between_lists_and_to_none(self):
        a, b = self.make("Costco"), self.make("Party")
        iid = self.c.post("/api/list/add", json={"name": "cupcakes", "list_id": a["id"]}).json()["item_id"]
        self.c.post("/api/list/move", json={"item_id": iid, "list_id": b["id"]})
        self.assertEqual(rows(self.c)["cupcakes"]["list"], b["id"])
        self.c.post("/api/list/move", json={"item_id": iid, "list_id": None})
        self.assertNotIn("list", rows(self.c)["cupcakes"])
        self.assertEqual(self.c.post("/api/list/move", json={"item_id": iid, "list_id": "l-x"}).status_code, 404)

    def test_rename_and_relink_stores(self):
        l = self.make("Party")
        r = self.c.post("/api/lists/update", json={"id": l["id"], "name": "Birthday", "stores": ["Costco", "Trader Joe's"]})
        self.assertEqual((r.json()["name"], r.json()["stores"]), ("Birthday", ["Costco", "Trader Joe's"]))
        r = self.c.post("/api/lists/update", json={"id": l["id"], "stores": []})
        self.assertEqual(r.json()["name"], "Birthday")
        self.assertEqual(r.json()["stores"], [])
        self.make("Costco")
        self.assertEqual(self.c.post("/api/lists/update", json={"id": l["id"], "name": "costco"}).status_code, 409)
        self.assertEqual(self.c.post("/api/lists/update", json={"id": "l-x", "name": "z"}).status_code, 404)

    def test_two_same_name_stores_keep_their_ids(self):
        l = self.make("Trader Joe's")
        r = self.c.post("/api/lists/update", json={"id": l["id"], "stores": ["Trader Joe's"], "store_ids": ["s-b", "s-b", ""]})
        self.assertEqual((r.json()["stores"], r.json()["store_ids"]), (["Trader Joe's"], ["s-b"]))
        # Relinking by names alone drops ids that no longer describe the list.
        r = self.c.post("/api/lists/update", json={"id": l["id"], "stores": []})
        self.assertEqual(r.json()["store_ids"], [])
        self.assertNotIn("store_ids", self.make("Plain"))

    def test_delete_keeps_items_and_restore_brings_them_back(self):
        a = self.make("Costco")
        b = self.make("Party")
        self.c.post("/api/list/add", json={"name": "eggs", "list_id": b["id"]})
        out = self.c.post("/api/lists/delete", json={"id": b["id"]}).json()
        self.assertEqual(out["deleted"], b)
        self.assertEqual(out["index"], 1)
        self.assertIn("eggs", rows(self.c))
        self.assertNotIn("list", rows(self.c)["eggs"])
        self.assertEqual([l["id"] for l in self.c.get("/api/home").json()["lists"]], [a["id"]])
        r = self.c.post("/api/lists/restore", json={"list": out["deleted"], "index": out["index"]})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(rows(self.c)["eggs"]["list"], b["id"])
        self.assertEqual([l["id"] for l in self.c.get("/api/home").json()["lists"]], [a["id"], b["id"]])
        # A second restore is a no-op, not a duplicate.
        self.c.post("/api/lists/restore", json={"list": out["deleted"]})
        self.assertEqual(len(self.c.get("/api/home").json()["lists"]), 2)

    def test_limit(self):
        from api import state
        for i in range(state.MAX_LISTS):
            self.make(f"L{i}")
        self.assertEqual(self.c.post("/api/lists", json={"name": "one more"}).status_code, 400)

    def test_plan_rows_carry_the_list(self):
        l = self.make("Costco")
        self.c.post("/api/list/add", json={"name": "eggs", "list_id": l["id"]})
        plan = self.c.get("/api/quest/plan").json()
        self.assertEqual([r["list"] for r in plan["list"] if r["name"] == "eggs"], [l["id"]])

    def test_export_includes_lists(self):
        l = self.make("Costco")
        out = self.c.get("/api/account/export").json()
        self.assertEqual(out["lists"], {"lists": [l]})


class StubChat:
    """Answers /api/chat with whatever actions the test queued and
    keeps the snapshot the model was shown."""
    actions = []
    seen = None

    def __init__(self, ledger=None):
        pass

    def chat(self, messages, mode=None, personal=None, **k):
        import json
        StubChat.seen = messages[1]["content"]
        return json.dumps({"reply": "ok", "actions": StubChat.actions}), {}, 0.01


class TestChatActions(unittest.TestCase):
    def setUp(self):
        self.c = fresh(self)
        from api import main
        from api import deps
        deps.MetaClient = StubChat
        StubChat.actions = []

    def ask(self, actions):
        StubChat.actions = actions
        r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def test_add_to_a_named_list_by_name(self):
        l = self.c.post("/api/lists", json={"name": "Indian Store"}).json()
        out = self.ask([{"type": "add_to_list", "item": "naan", "list": "indian store"}])
        self.assertEqual(out["applied"], ["Added naan to Indian Store."])
        self.assertEqual(out["skipped"], [])
        self.assertEqual(rows(self.c)["naan"]["list"], l["id"])

    def test_unknown_list_still_adds_and_says_so(self):
        out = self.ask([{"type": "add_to_list", "item": "naan", "list": "Nowhere"}])
        self.assertEqual(out["applied"], ["Added naan to your list."])
        self.assertIn("no list called Nowhere", out["skipped"][0])
        self.assertNotIn("list", rows(self.c)["naan"])

    def test_snapshot_names_lists_and_their_items(self):
        import json
        l = self.c.post("/api/lists", json={"name": "Costco"}).json()
        self.c.post("/api/list/add", json={"name": "paper towels", "list_id": l["id"]})
        self.ask([])
        snap = json.loads(StubChat.seen.split("HOUSEHOLD SNAPSHOT:\n", 1)[1])
        self.assertEqual(snap["named_lists"], [{"name": "Costco", "stores": [], "items": ["paper towels"]}])


if __name__ == "__main__":
    unittest.main()
