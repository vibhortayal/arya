"""Friends across real accounts — review 2026-10-28, M10.

The brief's acceptance test, over HTTP with two real accounts:
A requests B by handle, B sees pending_in, B accepts, both sides
show accepted. Only the handle and the status cross accounts —
no badge, hunt, or household data. Unregistered handles are a
400 everywhere, including as a Shop-Off opponent.
"""
import os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"


class TestFriendsAcrossAccounts(unittest.TestCase):
    def setUp(self):
        from api import deps
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        from api import auth
        deps._login_fails.clear()
        self.a = TestClient(main.app)
        r = self.a.post("/auth/setup", json={
            "username": "alice@example.com", "password": "pw-alice"})
        assert r.status_code == 200, r.text
        auth.create_user("bob@example.com", "pw-bob")
        self.b = TestClient(main.app)
        r = self.b.post("/auth/login", json={
            "username": "bob@example.com", "password": "pw-bob"})
        assert r.status_code == 200, r.text

    def _friends(self, client):
        return client.get("/api/quest/friends").json()["friends"]

    def test_request_accept_round_trip(self):
        a, b = self.a, self.b
        r = a.post("/api/quest/friends", json={"handle": "carol"})
        self.assertEqual(r.status_code, 400, r.text)  # unregistered
        r = a.post("/api/quest/friends", json={"handle": "@Bob"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "pending_out")
        bf = self._friends(b)
        self.assertEqual([(f["handle"], f["status"]) for f in bf],
                         [("alice", "pending_in")])
        self.assertIsNone(bf[0]["top_badge"])
        self.assertIsNone(bf[0]["last_hunt"])
        r = b.post("/api/quest/friends/accept", json={"handle": "alice"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "accepted")
        self.assertEqual(
            [(f["handle"], f["status"]) for f in self._friends(a)],
            [("bob", "accepted")])
        self.assertEqual(
            [(f["handle"], f["status"]) for f in self._friends(b)],
            [("alice", "accepted")])
        # Re-requesting is idempotent: one accepted entry per side.
        r = a.post("/api/quest/friends", json={"handle": "bob"})
        self.assertEqual(r.json()["status"], "accepted")
        self.assertEqual(len(self._friends(a)), 1)
        self.assertEqual(len(self._friends(b)), 1)

    def test_mutual_request_accepts_both_sides(self):
        a, b = self.a, self.b
        r = b.post("/api/quest/friends", json={"handle": "alice"})
        self.assertEqual(r.json()["status"], "pending_out")
        r = a.post("/api/quest/friends", json={"handle": "bob"})
        self.assertEqual(r.json()["status"], "accepted")
        self.assertEqual(self._friends(b)[0]["status"], "accepted")
        self.assertEqual(self._friends(a)[0]["status"], "accepted")

    def test_shopoff_requires_a_real_opponent(self):
        r = self.a.post("/api/quest/shopoff", json={
            "store": "Corner Shop", "items": ["Milk"],
            "opponent_handle": "carol"})
        self.assertEqual(r.status_code, 400, r.text)
        r = self.a.post("/api/quest/shopoff", json={
            "store": "Corner Shop", "items": ["Milk"],
            "opponent_handle": "@bob"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["players"][1]["handle"], "bob")


if __name__ == "__main__":
    unittest.main()

    def test_unfriend_clears_both_sides(self):
        a, b = self.a, self.b
        a.post("/api/quest/friends", json={"handle": "bob"})
        b.post("/api/quest/friends/accept", json={"handle": "alice"})
        self.assertEqual(len(self._friends(a)), 1)
        r = a.post("/api/quest/friends/remove", json={"handle": "bob"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._friends(a), [])
        self.assertEqual(self._friends(b), [])
        r = a.post("/api/quest/friends/remove", json={"handle": "bob"})
        self.assertEqual(r.status_code, 404, r.text)

    def test_cancel_and_decline_clear_both_sides(self):
        a, b = self.a, self.b
        a.post("/api/quest/friends", json={"handle": "bob"})
        r = a.post("/api/quest/friends/remove", json={"handle": "@Bob"})
        self.assertEqual(r.status_code, 200, r.text)  # cancel sent
        self.assertEqual(self._friends(a), [])
        self.assertEqual(self._friends(b), [])
        a.post("/api/quest/friends", json={"handle": "bob"})
        r = b.post("/api/quest/friends/remove", json={"handle": "alice"})
        self.assertEqual(r.status_code, 200, r.text)  # decline received
        self.assertEqual(self._friends(a), [])
        self.assertEqual(self._friends(b), [])
