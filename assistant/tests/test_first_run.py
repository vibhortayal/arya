"""First run (#153, #163): the onboarded flag in settings.json, the
rule that an account with data counts as onboarded, the Get started
steps, and the demo household that never sees either."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class TestFirstRun(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "new@x.y", "password": "long-password"})

    def s(self):
        return self.c.get("/api/settings").json()

    def test_new_account_is_not_onboarded_until_it_answers(self):
        none_done = {"list": False, "expiry": False, "receipt": False}
        self.assertEqual((self.s()["onboarded"], self.s()["get_started"]), (False, none_done))
        r = self.c.post("/api/settings", json={"onboarded": True})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["onboarded"])
        self.assertEqual(r.json()["get_started"], {"list": False, "expiry": False, "receipt": False})
        # A later answer does not reset the card.
        self.c.post("/api/lists", json={"name": "Costco"})
        self.c.post("/api/settings", json={"onboarded": True})
        self.assertEqual(self.s()["get_started"], {"list": True, "expiry": False, "receipt": False})

    def test_flag_is_stored_server_side_per_account(self):
        self.c.post("/api/settings", json={"onboarded": True})
        from api import state
        with open(os.path.join(state.user_dir("new@x.y"), "settings.json")) as fh:
            self.assertTrue(json.load(fh)["onboarded"])
        # A second device (a fresh session) reads the same flag.
        c2 = TestClient(self.c.app)
        c2.post("/auth/login", json={"username": "new@x.y", "password": "long-password"})
        self.assertTrue(c2.get("/api/settings").json()["onboarded"])

    def test_existing_account_with_data_counts_as_onboarded(self):
        self.c.post("/api/list/add", json={"name": "milk"})
        self.assertTrue(self.s()["onboarded"])
        # Answering the welcome from an account with data gives no card.
        self.c.post("/api/settings", json={"onboarded": True})
        self.assertIsNone(self.s()["get_started"])

    def test_each_kind_of_data_counts(self):
        from api import state
        for save in (lambda: state.save_named_lists([{"id": "l1", "name": "TJ", "stores": []}]),
                     lambda: state._save("receipts.json", [{"receipt_id": "r1", "lines": []}]),
                     lambda: state._save("quest.json", {"sessions": [{"id": "s1"}]})):
            with state.as_user("new@x.y"):
                for name in ("lists.json", "receipts.json", "quest.json", "flags.json"):
                    state._save(name, {} if name != "receipts.json" else [])
            self.assertFalse(self.s()["onboarded"])
            with state.as_user("new@x.y"):
                save()
            self.assertTrue(self.s()["onboarded"])

    def test_get_started_dismissed_hides_the_card(self):
        self.c.post("/api/settings", json={"onboarded": True})
        self.c.post("/api/settings", json={"get_started_dismissed": True})
        self.assertIsNone(self.s()["get_started"])
        self.assertTrue(self.s()["onboarded"])

    def test_all_three_done_ends_the_card_for_good(self):
        self.c.post("/api/settings", json={"onboarded": True})
        from api import state
        with state.as_user("new@x.y"):
            state.save_named_lists([{"id": "l1", "name": "TJ", "stores": []}])
            state.set_flag("milk", {"use_by": "2026-11-02"})
            state._save("receipts.json", [{"receipt_id": "r1", "lines": []}])
        self.assertIsNone(self.s()["get_started"])
        with state.as_user("new@x.y"):
            state._save("receipts.json", [])
        self.assertIsNone(self.s()["get_started"])

    def test_bad_body_is_still_rejected(self):
        self.assertEqual(self.c.post("/api/settings", json={"onboarded": "yes"}).status_code, 400)
        self.assertEqual(self.c.post("/api/settings", json={}).status_code, 400)


class TestDemoNeverOnboards(unittest.TestCase):
    def test_demo_is_onboarded_with_no_card(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        from api.main import app
        c = TestClient(app)
        c.post("/auth/demo")
        s = c.get("/api/settings").json()
        self.assertEqual((s["onboarded"], s["get_started"]), (True, None))
        self.assertEqual(c.post("/api/settings", json={"onboarded": True}).json()["onboarded"], True)


if __name__ == "__main__":
    unittest.main()
