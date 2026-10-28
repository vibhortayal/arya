"""Feature request / Contact us: login required, a kind and a bounded
note, a daily cap per account, no identical repeats, closed to the
demo household, and readable only by the owner (the first account)."""
import os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"


class TestFeedback(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        from api import auth
        main._login_fails.clear()
        self.anon = TestClient(main.app)
        self.a = TestClient(main.app)
        r = self.a.post("/auth/setup", json={
            "username": "alice@example.com", "password": "pw-alice"})
        assert r.status_code == 200, r.text
        auth.create_user("bob@example.com", "pw-bob")
        self.b = TestClient(main.app)
        r = self.b.post("/auth/login", json={
            "username": "bob@example.com", "password": "pw-bob"})
        assert r.status_code == 200, r.text

    def send(self, c, text="add dark mode", kind="idea"):
        return c.post("/api/feedback", json={"kind": kind, "text": text})

    def test_login_required(self):
        self.assertEqual(self.send(self.anon).status_code, 401)

    def test_send_and_owner_reads(self):
        self.assertEqual(self.send(self.b, "love it", "question").status_code, 200)
        notes = self.a.get("/api/feedback").json()["notes"]
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["user"], "bob@example.com")
        self.assertEqual(notes[0]["kind"], "question")
        self.assertEqual(set(notes[0]), {"at", "user", "kind", "text"})

    def test_only_owner_reads(self):
        self.assertEqual(self.b.get("/api/feedback").status_code, 403)

    def test_validation(self):
        self.assertEqual(self.send(self.b, "").status_code, 400)
        self.assertEqual(self.send(self.b, "x", "rant").status_code, 400)
        self.assertEqual(self.send(self.b, "x" * 1001).status_code, 400)

    def test_duplicate_refused(self):
        self.assertEqual(self.send(self.b).status_code, 200)
        self.assertEqual(self.send(self.b).status_code, 400)

    def test_daily_cap(self):
        for i in range(5):
            self.assertEqual(self.send(self.b, f"note {i}").status_code, 200)
        self.assertEqual(self.send(self.b, "one more").status_code, 429)
        # the cap is per account
        self.assertEqual(self.send(self.a, "mine").status_code, 200)

    def test_demo_closed(self):
        from fastapi.testclient import TestClient
        import api.main as main
        d = TestClient(main.app)
        r = d.post("/auth/demo")
        if r.status_code != 200:
            self.skipTest("demo login unavailable here")
        self.assertEqual(self.send(d).status_code, 403)
        self.assertEqual(d.get("/api/feedback").status_code, 403)


if __name__ == "__main__":
    unittest.main()
