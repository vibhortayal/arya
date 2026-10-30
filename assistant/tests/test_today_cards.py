"""Customizable Today (owner, 2026-10-30): the cards shown and their
order are a per-account setting; absent means the default."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class TestTodayCards(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
        self.assertEqual(r.status_code, 200, r.text)

    def post(self, code=200, **body):
        r = self.c.post("/api/settings", json=body)
        self.assertEqual(r.status_code, code, r.text)
        return r.json()

    def test_default_is_none_and_not_asked(self):
        r = self.c.get("/api/settings").json()
        self.assertIsNone(r["today_cards"])
        self.assertFalse(r["today_asked"])

    def test_order_saved_and_deduped(self):
        r = self.post(today_cards=["price", "low", "price"])
        self.assertEqual(r["today_cards"], ["price", "low"])
        self.assertEqual(self.c.get("/api/settings").json()["today_cards"], ["price", "low"])

    def test_empty_list_hides_everything_and_null_resets(self):
        self.assertEqual(self.post(today_cards=[])["today_cards"], [])
        self.assertIsNone(self.post(today_cards=None)["today_cards"])

    def test_unknown_card_rejected(self):
        self.post(400, today_cards=["low", "nope"])
        self.post(400, today_cards="low")

    def test_asked_sticks(self):
        self.assertTrue(self.post(today_asked=True)["today_asked"])
