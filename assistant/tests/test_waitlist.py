"""Sign-in waitlist: public, email only, no repeats, honeypot, per-IP
cap, and the owner tool can list and remove (owner, 2026-10-30)."""
import os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"


class TestWaitlist(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        from api import deps
        deps._waitlist_hits.clear()
        self.c = TestClient(main.app)

    def join(self, email, **extra):
        return self.c.post("/auth/waitlist", json={"email": email, **extra})

    def test_join_then_already(self):
        self.assertEqual(self.join("Sam@Example.com").json(), {"status": "added"})
        self.assertEqual(self.join(" sam@example.com ").json(), {"status": "already"})
        from api import waitlist
        rows = waitlist.rows()
        self.assertEqual([r["email"] for r in rows], ["sam@example.com"])
        self.assertEqual(sorted(rows[0]), ["at", "email"])

    def test_bad_email_is_400(self):
        for bad in ("", "sam", "sam@example", "a b@c.com", "x" * 300 + "@a.co"):
            self.assertEqual(self.join(bad).status_code, 400, bad)

    def test_honeypot_stores_nothing(self):
        self.assertEqual(self.join("bot@example.com", website="http://spam").status_code, 200)
        from api import waitlist
        self.assertEqual(waitlist.rows(), [])

    def test_ip_cap(self):
        for i in range(5):
            self.assertEqual(self.join(f"u{i}@example.com").status_code, 200)
        self.assertEqual(self.join("u6@example.com").status_code, 429)

    def test_repeat_join_answers_approved_only_for_invited(self):
        from api import waitlist
        self.assertEqual(self.join("a@example.com").json(), {"status": "added"})
        self.assertEqual(self.join("a@example.com").json(), {"status": "already"})
        waitlist.approve(["a@example.com"])
        self.assertEqual(self.join("a@example.com").json(), {"status": "approved"})
        waitlist.reject(["a@example.com"])
        self.assertEqual(self.join("a@example.com").json(), {"status": "already"})
        self.assertEqual(len(waitlist.rows()), 1)

    def test_full_list(self):
        from api import waitlist
        old = waitlist.MAX_ROWS
        waitlist.MAX_ROWS = 1
        try:
            self.assertEqual(self.join("a@example.com").status_code, 200)
            self.assertEqual(self.join("b@example.com").status_code, 429)
        finally:
            waitlist.MAX_ROWS = old

    def test_owner_tool_removes_and_purges(self):
        from api import waitlist
        from harness import waitlist as tool
        self.join("a@example.com"); self.join("b@example.com")
        self.assertEqual(tool.main(["remove", "A@example.com"]), 0)
        self.assertEqual([r["email"] for r in waitlist.rows()], ["b@example.com"])
        self.assertFalse(waitlist.remove("a@example.com"))
        self.assertEqual(waitlist.purge(), 1)
        self.assertEqual(waitlist.rows(), [])

    def test_no_login_needed_and_status_unchanged(self):
        self.assertEqual(self.c.get("/api/home").status_code, 401)
        self.assertEqual(self.join("a@example.com").status_code, 200)


if __name__ == "__main__":
    unittest.main()
