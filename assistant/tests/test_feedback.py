"""Feature request / Contact us: login required, a kind and a bounded
note, a daily cap per account, no identical repeats, closed to the
demo household, and readable only by the owner (the first account)."""
import os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"


class TestFeedback(unittest.TestCase):
    def setUp(self):
        from api import deps
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        from api import auth
        deps._login_fails.clear()
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


class TestDemoFeedbackDoor(unittest.TestCase):
    """The demo's one write that reaches disk: email required and capped
    per email, demo sessions only, no username."""
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        from api import deps, demo_guard
        deps._login_fails.clear()
        demo_guard._demo_auth_hits.clear()
        demo_guard._demo_feedback_hits.clear()
        self.anon = TestClient(main.app)
        self.owner = TestClient(main.app)
        r = self.owner.post("/auth/setup", json={
            "username": "owner@example.com", "password": "pw-owner"})
        assert r.status_code == 200, r.text
        self.demo = TestClient(main.app)
        assert self.demo.post("/auth/demo").status_code == 200

    def send(self, c, text="loved the tour", email="Judge@Example.com", **extra):
        return c.post("/api/demo/feedback", json={"text": text, "email": email, **extra})

    def test_demo_sends_and_owner_reads_it_with_normalised_email(self):
        r = self.send(self.demo)
        self.assertEqual(r.status_code, 200, r.text)
        notes = self.owner.get("/api/feedback").json()["notes"]
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["user"], "demo-visitor")
        self.assertEqual(notes[0]["kind"], "beta")
        self.assertEqual(notes[0]["contact"], "judge@example.com")

    def test_email_is_required_and_checked(self):
        for bad in ("", "   ", "not-an-email", "a@b", "x" * 201 + "@e.com"):
            self.assertEqual(self.send(self.demo, email=bad).status_code, 400, bad)

    def test_real_account_and_anonymous_are_refused(self):
        self.assertEqual(self.send(self.owner).status_code, 403)
        self.assertEqual(self.send(self.anon).status_code, 401)

    def test_per_email_cap_ignores_case_and_other_emails_are_free(self):
        for i, e in enumerate(("a@x.com", "A@X.com", " a@x.com ")):
            self.assertEqual(self.send(self.demo, f"note {i}", e).status_code, 200)
        self.assertEqual(self.send(self.demo, "again", "a@x.com").status_code, 429)
        self.assertEqual(self.send(self.demo, "other person", "b@x.com").status_code, 200)

    def test_bounds_and_empty(self):
        self.assertEqual(self.send(self.demo, "   ").status_code, 400)
        self.assertEqual(self.send(self.demo, "x" * 1001).status_code, 400)

    def test_honeypot_stores_nothing(self):
        self.assertEqual(self.send(self.demo, "spam", website="http://x").status_code, 200)
        self.assertEqual(self.owner.get("/api/feedback").json()["notes"], [])

    def test_day_wide_cap(self):
        from api import feedback
        old = feedback.DEMO_DAILY_CAP
        feedback.DEMO_DAILY_CAP = 1
        try:
            self.assertEqual(self.send(self.demo, "a", "a@x.com").status_code, 200)
            self.assertEqual(self.send(self.demo, "b", "b@x.com").status_code, 429)
        finally:
            feedback.DEMO_DAILY_CAP = old

    def test_ip_backstop_after_ten(self):
        for i in range(10):
            self.assertEqual(self.send(self.demo, f"n{i}", f"p{i}@x.com").status_code, 200)
        self.assertEqual(self.send(self.demo, "eleven", "p11@x.com").status_code, 429)

    def test_old_door_stays_closed_to_demo(self):
        r = self.demo.post("/api/feedback", json={"kind": "idea", "text": "hi"})
        self.assertEqual(r.status_code, 403)
