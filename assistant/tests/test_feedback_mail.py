"""Feedback emails to the owner: each new note is mailed to ARYA_OPS_EMAIL,
off without it, capped per day, never blocks the sender; the backlog
command mails everything saved so far."""
import os, tempfile, unittest
from unittest import mock

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"


class TestFeedbackMail(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["RESEND_API_KEY"] = "re_test"
        os.environ["ARYA_OPS_EMAIL"] = "owner@example.com"
        from api import mailer
        mailer._mail_day.update(day="", n=0)

    def tearDown(self):
        for k in ("RESEND_API_KEY", "ARYA_OPS_EMAIL", "ARYA_FEEDBACK_MAIL_CAP"):
            os.environ.pop(k, None)

    def note(self, **kw):
        return {"at": 1761900000, "user": "demo-visitor", "kind": "beta",
                "text": "love <it>", "contact": "a@x.com", **kw}

    def test_note_mailed_to_owner(self):
        from api import mailer
        with mock.patch("api.mailer.send", return_value=True) as send:
            self.assertTrue(mailer.feedback_note(self.note()))
        to, subject, text, html = send.call_args[0]
        self.assertEqual(to, "owner@example.com")
        self.assertIn("a@x.com", text)
        self.assertIn("&lt;it&gt;", html)

    def test_off_without_ops_email(self):
        from api import mailer
        os.environ.pop("ARYA_OPS_EMAIL")
        with mock.patch("api.mailer.send") as send:
            self.assertFalse(mailer.feedback_note(self.note()))
        send.assert_not_called()

    def test_daily_cap(self):
        from api import mailer
        os.environ["ARYA_FEEDBACK_MAIL_CAP"] = "2"
        with mock.patch("api.mailer.send", return_value=True) as send:
            for _ in range(4):
                mailer.feedback_note(self.note())
        self.assertEqual(send.call_count, 2)

    def test_backlog_one_email(self):
        from api import feedback, mailer
        feedback.submit("sam", "idea", "dark mode")
        feedback.submit_demo("nice", "b@x.com")
        with mock.patch("api.mailer.send", return_value=True) as send:
            from harness import feedback_mail
            self.assertEqual(feedback_mail.main([]), 0)
        self.assertEqual(send.call_count, 1)
        text = send.call_args[0][2]
        self.assertIn("dark mode", text)
        self.assertIn("b@x.com", text)

    def test_route_still_succeeds_when_mail_fails(self):
        from fastapi.testclient import TestClient
        import api.main as main
        c = TestClient(main.app)
        c.post("/auth/setup", json={"username": "alice@example.com", "password": "pw-alice"})
        with mock.patch("api.mailer.send", side_effect=OSError("down")):
            r = c.post("/api/feedback", json={"kind": "idea", "text": "hi"})
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
