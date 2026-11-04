"""A finished Quest's ticks survive its receipt (owner bug, 2026-11-04).

Got it ticks the list row (routes/quest.py _tick_list_row), keyed on the
cycle, which is the date of the newest receipt. Filing the trip's
receipt started a new cycle, so every tick from the trip expired and the
bought items showed as not bought. A row the household put on the list
now keeps its tick until they clear it, untick it or add it again.
"""
from tests.conftest import one_list
import os, tempfile, unittest
from datetime import date, timedelta

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient  # noqa: E402

from tests.test_list_pass import FakeClient, seed_receipt  # noqa: E402


class TestTicksStay(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
        self.lid = one_list(self.c, "Trader Jill's")["id"]
        seed_receipt(self.c, "Costco", (date.today() - timedelta(days=9)).isoformat(), [("Eggs", "2002", 5.0)], "old")
        for n in ("Milk", "Bananas", "Apple"):
            assert self.c.post("/api/list/add", json={"name": n, "list_id": self.lid}).status_code == 200

    def rows(self):
        return {i["name"]: bool(i.get("checked")) for i in self.c.get("/api/home").json()["list"]["items"] if i.get("on_list")}

    def test_quest_ticks_survive_the_trips_receipt(self):
        s = self.c.post("/api/quest/sessions", json={"store": "Trader Jill's", "mode": "quest",
                                                     "items": [{"name": n} for n in ("Milk", "Bananas", "Apple")]}).json()
        for n in ("Milk", "Bananas"):
            assert self.c.post(f"/api/quest/sessions/{s['id']}/check", json={"item": n, "checked": True}).status_code == 200
        self.assertEqual(self.rows(), {"Milk": True, "Bananas": True, "Apple": False})
        # The trip's receipt lands today: a new cycle.
        seed_receipt(self.c, "Trader Jill's", date.today().isoformat(), [("Milk", "1", 3.0), ("Bananas", "2", 1.0)], "trip")
        self.assertEqual(self.rows(), {"Milk": True, "Bananas": True, "Apple": False})
        # Untick still works, and a re-add puts it back unticked.
        self.c.post(f"/api/quest/sessions/{s['id']}/check", json={"item": "Milk", "checked": False})
        self.assertFalse(self.rows()["Milk"])
        self.c.post(f"/api/quest/sessions/{s['id']}/check", json={"item": "Bananas", "checked": True})
        self.c.post("/api/list/add", json={"name": "Bananas", "list_id": self.lid})
        self.assertFalse(self.rows()["Bananas"])


if __name__ == "__main__":
    unittest.main()
