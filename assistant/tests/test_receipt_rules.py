"""Settle integrity (issues #14, #15) and the demo-only sample
receipt door. Deterministic code only - no model calls."""
import os, tempfile, unittest
from datetime import date, timedelta

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

TODAY = date.today().isoformat()
LAST_WEEK = (date.today() - timedelta(days=7)).isoformat()


def _receipt(rid, when):
    return {"receipt_id": rid, "merchant": "Trader Joe's",
            "purchased_at": when, "lines": [], "subtotal": 0,
            "tax": 0, "total": 0, "totals_reconcile": True}


class TestReceiptRules(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state, auth
        main._login_fails.clear()
        state._save("receipts.json", [
            _receipt("r-today", TODAY + "T18:00:00"),
            _receipt("r-today-2", TODAY + "T19:00:00"),
            _receipt("r-old", LAST_WEEK)])
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text
        auth.create_user("rival@example.com", "long-password")

    def hunt(self):
        sid = self.c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": ["milk"]}).json()["id"]
        self.c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        self.c.post(f"/api/quest/sessions/{sid}/state", json={"state": "finished"})
        return sid

    def attach(self, sid, rid):
        return self.c.post(f"/api/quest/sessions/{sid}/receipt",
                           json={"receipt_id": rid})

    def test_a_receipt_settles_one_hunt(self):
        first, second = self.hunt(), self.hunt()
        self.assertEqual(self.attach(first, "r-today").status_code, 200)
        r = self.attach(second, "r-today")
        self.assertEqual(r.status_code, 400)
        self.assertIn("already settled", r.text)
        self.assertEqual(self.attach(second, "r-today-2").status_code, 200)
        stats = self.c.get("/api/quest/profile").json()["stats"]
        self.assertEqual(stats["hunts"], 2)

    def test_a_receipt_from_before_the_hunt_is_refused(self):
        sid = self.hunt()
        r = self.attach(sid, "r-old")
        self.assertEqual(r.status_code, 400)
        self.assertIn("before the hunt began", r.text)
        self.assertEqual(self.attach(sid, "r-today").status_code, 200)

    def test_shopoff_placeholder_is_not_my_hunt(self):
        race = self.c.post("/api/quest/shopoff", json={
            "store": "Trader Joe's", "items": ["milk"],
            "opponent_handle": "rival"}).json()
        mine, ghost = (p["session_id"] for p in race["players"])
        listed = [s["id"] for s in
                  self.c.get("/api/quest/sessions").json()["sessions"]]
        self.assertIn(mine, listed)
        self.assertNotIn(ghost, listed)
        # the race itself still reads the placeholder's progress
        got = self.c.get(f"/api/quest/shopoff/{race['id']}").json()
        self.assertEqual(len(got["players"]), 2)

    def test_sample_receipt_is_demo_only(self):
        sid = self.hunt()
        r = self.c.post(f"/api/quest/sessions/{sid}/sample-receipt")
        self.assertEqual(r.status_code, 403)


if __name__ == "__main__":
    unittest.main()
