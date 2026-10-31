"""The waitlist confirmation email (owner, 2026-10-30): sent once when
someone is added, never for a repeat, never blocks joining, and replies go
to the support address. Also: /team serves the app shell, and a verified
but uninvited address comes back with the 403 so the page can offer the
waitlist."""
import os, tempfile, unittest
from unittest import mock

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"


class TestWaitlistMail(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["RESEND_API_KEY"] = "re_test"
        os.environ.pop("ARYA_MAIL_REPLY_TO", None)
        from fastapi.testclient import TestClient
        import api.main as main
        from api import deps
        deps._waitlist_hits.clear()
        self.c = TestClient(main.app)

    def tearDown(self):
        os.environ.pop("RESEND_API_KEY", None)

    def join(self, email):
        return self.c.post("/auth/waitlist", json={"email": email})

    def test_added_sends_one_email_and_repeat_sends_none(self):
        with mock.patch("api.mailer.send", return_value=True) as send:
            self.assertEqual(self.join("Sam@Example.com").json(), {"status": "added"})
            self.assertEqual(self.join("sam@example.com").json(), {"status": "already"})
        self.assertEqual(send.call_count, 1)
        to, subject, text, html = send.call_args[0]
        self.assertEqual(to, "sam@example.com")
        self.assertEqual(subject, "You're on the Arya waitlist")
        self.assertIn("support@teamnightshift.org", text)
        self.assertIn("not monitored", text)
        self.assertIn("not monitored", html)
        self.assertIn("sam@example.com", html)

    def test_no_key_means_no_email_and_joining_still_works(self):
        os.environ.pop("RESEND_API_KEY")
        with mock.patch("api.mailer.send") as send:
            self.assertEqual(self.join("a@example.com").json(), {"status": "added"})
        send.assert_not_called()

    def test_a_failed_send_does_not_block_joining(self):
        with mock.patch("urllib.request.urlopen", side_effect=OSError("down")):
            self.assertEqual(self.join("b@example.com").json(), {"status": "added"})

    def test_resend_request_has_reply_to_and_from(self):
        import json
        from api import mailer
        seen = {}

        class R:
            def __enter__(s): return s
            def __exit__(s, *a): return False

        def fake(req, timeout=0):
            seen["body"] = json.loads(req.data); seen["auth"] = req.get_header("Authorization")
            return R()
        with mock.patch("urllib.request.urlopen", fake):
            self.assertTrue(mailer.send("x@example.com", "S", "t", "<p>h</p>"))
        self.assertEqual(seen["auth"], "Bearer re_test")
        self.assertEqual(seen["body"]["from"], "Arya <arya@mail.teamnightshift.org>")
        self.assertEqual(seen["body"]["reply_to"], "support@teamnightshift.org")
        self.assertEqual(seen["body"]["to"], ["x@example.com"])

    def test_html_escapes_the_address(self):
        from api import mailer
        with mock.patch("api.mailer.send", return_value=True) as send:
            mailer.waitlist_joined("<b>x</b>@example.com", "http://x")
        self.assertNotIn("<b>x</b>@", send.call_args[0][3])

    def test_uninvited_verified_address_gets_403_with_the_address(self):
        from api.routes import auth as routes
        resp = routes._federated_login("nobody@example.com")
        self.assertEqual(resp.status_code, 403)
        import json
        self.assertEqual(json.loads(resp.body)["email"], "nobody@example.com")

    def test_team_path_serves_the_shell(self):
        r = self.c.get("/team")
        self.assertIn(r.status_code, (200, 404))   # 404 only when the web build is absent
        if r.status_code == 404:
            self.assertEqual(r.json(), {"detail": "the app is not built"})


if __name__ == "__main__":
    unittest.main()
