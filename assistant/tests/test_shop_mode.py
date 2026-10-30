"""Shopping mode setting (8b): unset by default; a Quest nudge only for
people who chose Just my list."""
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


class TestShopMode(unittest.TestCase):
    def setUp(self):
        fresh(self)

    def post(self, **body):
        r = self.c.post("/api/settings", json=body)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def trips(self, n):
        r = None
        for _ in range(n):
            r = self.post(list_trip=True)
        return r

    def test_default_unset_and_no_nudge(self):
        r = self.c.get("/api/settings").json()
        self.assertIsNone(r["shop_mode"])
        self.assertFalse(r["quest_nudge"])

    def test_bad_values_rejected(self):
        self.assertEqual(self.c.post("/api/settings", json={"shop_mode": "x"}).status_code, 400)
        self.assertEqual(self.c.post("/api/settings", json={"quest_nudge": "x"}).status_code, 400)

    def test_nudge_only_for_list_mode_after_three_trips(self):
        for mode in ("ask", "quest"):
            self.post(shop_mode=mode)
            self.assertFalse(self.trips(5)["quest_nudge"])
        self.post(shop_mode="list")
        self.assertFalse(self.trips(2)["quest_nudge"])
        self.assertTrue(self.trips(1)["quest_nudge"])

    def test_not_now_snoozes_then_stops_and_off_is_permanent(self):
        self.post(shop_mode="list")
        self.trips(3)
        self.assertFalse(self.post(quest_nudge="snooze")["quest_nudge"])
        self.assertFalse(self.trips(4)["quest_nudge"])
        self.assertTrue(self.trips(1)["quest_nudge"])
        self.assertFalse(self.post(quest_nudge="off")["quest_nudge"])
        self.assertFalse(self.trips(20)["quest_nudge"])

    def test_choosing_quest_again_clears_off(self):
        self.post(shop_mode="list")
        self.post(quest_nudge="off")
        self.post(shop_mode="quest")
        self.post(shop_mode="list")
        self.assertTrue(self.trips(3)["quest_nudge"])


if __name__ == "__main__":
    unittest.main()
