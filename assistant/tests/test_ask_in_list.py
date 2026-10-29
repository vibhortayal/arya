"""Ask Arya from the List and from a hunt (owner, 2026-10-29): adds
apply at once and come back with the added items so the client can
offer Undo; the riskier actions (out, expired, never, snooze) come
back as proposals and change nothing until a yes."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class StubChat:
    actions = []
    seen = []

    def __init__(self, ledger=None):
        pass

    def chat(self, messages, mode=None, personal=None, **k):
        StubChat.seen = messages
        return json.dumps({"reply": "ok", "actions": StubChat.actions}), {}, 0.01


def seed_owner(base):
    """The demo household's data, copied under a real account."""
    import importlib.util, shutil
    spec = importlib.util.spec_from_file_location(
        "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    gen.main(base)
    os.makedirs(os.path.join(base, "users"), exist_ok=True)
    shutil.copytree(os.path.join(base, "users", "demo"), os.path.join(base, "users", "owner"))


class TestAskSurfaces(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        seed_owner(base)
        from api import main
        from api import deps
        deps.MetaClient = StubChat
        deps._login_fails.clear()
        StubChat.actions = []
        self.c = TestClient(main.app)
        assert self.c.post("/auth/setup", json={"username": "owner", "password": "pw"}).status_code == 200

    def ask(self, actions, **extra):
        StubChat.actions = actions
        r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}], **extra})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def rows(self):
        return {i["name"]: i for i in self.c.get("/api/home").json()["list"]["items"]}

    def test_adds_apply_and_come_back_for_undo(self):
        out = self.ask([{"type": "add_to_list", "item": "naan"}, {"type": "add_to_list", "item": "atta"}], surface="list")
        self.assertEqual([a["name"] for a in out["added"]], ["naan", "atta"])
        self.assertEqual(out["proposed"], [])
        for a in out["added"]:
            self.c.post("/api/list/remove", json={"item_id": a["item_id"]})
        self.assertNotIn("naan", self.rows())
        self.assertNotIn("atta", self.rows())

    def test_an_item_already_on_the_list_is_not_offered_for_undo(self):
        self.ask([{"type": "add_to_list", "item": "naan"}], surface="list")
        again = self.ask([{"type": "add_to_list", "item": "naan"}], surface="list")
        self.assertEqual(again["added"], [])

    def test_risky_actions_wait_for_a_yes_on_the_list(self):
        act = {"type": "ran_out", "item": "Greek Yogurt 32 oz"}
        out = self.ask([act], surface="list")
        self.assertEqual(out["applied"], [])
        self.assertEqual(len(out["proposed"]), 1)
        self.assertIn("Mark", out["proposed"][0]["text"])
        flags = self.c.get("/api/account/export").json()["flags"] or {}
        self.assertFalse(any(f.get("out") for f in flags.values()))
        done = self.c.post("/api/chat/apply", json={"actions": [out["proposed"][0]["action"]]}).json()
        self.assertEqual(len(done["applied"]), 1)
        flags = self.c.get("/api/account/export").json()["flags"]
        self.assertTrue(any(f.get("out") for f in flags.values()))

    def test_the_ask_tab_is_unchanged(self):
        out = self.ask([{"type": "ran_out", "item": "Greek Yogurt 32 oz"}])
        self.assertEqual(len(out["applied"]), 1)
        self.assertEqual(out["proposed"], [])

    def test_unknown_risky_item_is_skipped_not_proposed(self):
        out = self.ask([{"type": "ran_out", "item": "Unicorn"}], surface="list")
        self.assertEqual(out["proposed"], [])
        self.assertIn("don't track Unicorn", out["skipped"][0])

    def test_confirm_route_only_applies_risky_types(self):
        r = self.c.post("/api/chat/apply", json={"actions": [{"type": "add_to_list", "item": "x"}]})
        self.assertEqual(r.json()["applied"], [])
        self.assertNotIn("x", self.rows())
        self.assertEqual(self.c.post("/api/chat/apply", json={"actions": []}).status_code, 400)

    def test_an_add_goes_to_the_list_on_screen(self):
        l = self.c.post("/api/lists", json={"name": "Indian Store"}).json()
        out = self.ask([{"type": "add_to_list", "item": "naan"}], surface="list",
                       context={"list": "Indian Store", "list_id": l["id"]})
        self.assertEqual(out["applied"], ["Added naan to Indian Store."])
        self.assertEqual(self.rows()["naan"]["list"], l["id"])
        # The model saw where the user is.
        self.assertTrue(any("CURRENT SCREEN:\n" in m["content"] for m in StubChat.seen))

    def test_context_is_ignored_without_a_surface(self):
        self.ask([], context={"list": "x"})
        self.assertFalse(any("CURRENT SCREEN:\n" in m["content"] for m in StubChat.seen))

    def test_from_text_returns_only_new_items_for_undo(self):
        l = self.c.post("/api/lists", json={"name": "Indian Store"}).json()
        r = self.c.post("/api/list/from-text", json={"text": "naan", "list_id": l["id"]}).json()
        self.assertEqual(r["item_ids"], ["manual-naan"])
        again = self.c.post("/api/list/from-text", json={"text": "naan"}).json()
        self.assertEqual(again["item_ids"], [])


class TestShell(unittest.TestCase):
    def test_one_field_and_mic_go_through_aryaask(self):
        from tests import frontend
        lists, ask = frontend.src("screens/Lists.tsx"), frontend.src("screens/lists/AskCard.tsx")
        self.assertIn("looksLikeAsk(t)", lists)
        self.assertIn("parseAddToList(t, lists)", lists)
        self.assertIn('id="add-mic"', lists)
        mic = lists.split("const mic = async () => {")[1].split("\n  };")[0]
        self.assertIn("ask.run(spoken", mic)
        # The engine is the Ask tab's own endpoint, called with a surface.
        self.assertIn('post<Res>("/api/chat"', ask)
        self.assertIn('surface: "list"', ask)
        self.assertIn('post<{ applied?: string[] }>("/api/chat/apply"', ask)
        self.assertIn('post("/api/list/remove"', ask)  # Undo

    def test_add_to_list_needs_no_model(self):
        from tests import frontend
        ask = frontend.src("screens/lists/AskCard.tsx")
        body = ask.split("const addToList = useCallback(")[1].split("}, [onChange]);")[0]
        self.assertIn("/api/list/from-text", body)
        self.assertNotIn("/api/chat", body)


if __name__ == "__main__":
    unittest.main()
