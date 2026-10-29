"""Today and Ask Arya agree on what is running low — audit 2026-10-29."""
import os, tempfile, unittest
from datetime import date, timedelta

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient  # noqa: E402

from tests.test_list_pass import FakeClient, seed_receipt  # noqa: E402


class TestOneSource(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state
        main.MetaClient = FakeClient
        main._login_fails.clear()
        self.state = state
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
        t = date.today()
        for d in (40, 20):
            seed_receipt(self.c, "Costco", (t - timedelta(days=d)).isoformat(),
                         [("Tahini", "3001", 7.0)], f"t{d}")
        for d in (80, 66, 52, 38):
            seed_receipt(self.c, "Costco", (t - timedelta(days=d)).isoformat(),
                         [("Eggs", "2002", 5.0)], f"e{d}")
        self.as_user(state._save, "dictionary.json", {"entries": [
            {"item_id": "costco-3001", "sku": "3001", "canonical_name": "Tahini", "aliases": []},
            {"item_id": "costco-2002", "sku": "2002", "canonical_name": "Eggs", "aliases": []}]})
        self.as_user(state._save, "judged.json", {k: {"list_ok": True, "class": "STAPLE", "buys": 4}
                                                  for k in ("costco-3001", "costco-2002")})

    def as_user(self, f, *a):
        self.state.set_current_user("t@x.y")
        try:
            return f(*a)
        finally:
            self.state.set_current_user(None)

    def ask_low(self):
        from api import chat_service
        return self.as_user(lambda: chat_service.snapshot()["running_low"])

    def home(self):
        return self.c.get("/api/home").json()

    def test_removing_from_list_does_not_hide_it_from_ask(self):
        self.assertEqual(self.ask_low(), ["Eggs"])
        self.c.post("/api/list/remove", json={"item_id": "costco-2002"})
        h = self.home()
        self.assertEqual([i["name"] for i in h["running_low"]], ["Eggs"])
        self.assertEqual(self.ask_low(), ["Eggs"])

    def test_checked_row_is_not_low_for_ask(self):
        self.c.post("/api/list/check", json={"item_id": "costco-2002", "checked": True})
        self.assertEqual(self.ask_low(), [])

    def test_ran_out_with_short_history_lands_on_list_and_in_low(self):
        from api import chat_service
        msg, _ = self.as_user(chat_service.apply_actions,
                              [{"type": "ran_out", "item": "Tahini"}])
        self.assertIn("on the list", msg[0])
        h = self.home()
        self.assertIn("Tahini", [i["name"] for i in h["list"]["items"]])
        self.assertIn("Tahini", [i["name"] for i in h["running_low"]])
        self.assertIn("Tahini", self.ask_low())
