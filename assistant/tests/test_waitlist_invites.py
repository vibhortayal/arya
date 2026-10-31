"""Waitlist invites (owner, 2026-10-30): the owner approves addresses, only
approved (or existing) emails get a sign-in code, a row goes when the person
signs in, and only the owner can manage the list. Supabase is mocked: no
real mail or Google call is made here."""
import os, tempfile, unittest
from unittest import mock

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"

ENV = {"ARYA_SUPABASE_AUTH": "1", "SUPABASE_URL": "https://x.supabase.co",
       "SUPABASE_ANON_KEY": "anon", "ARYA_OWNER_USERNAME": "boss", "ARYA_WAITLIST_ADMINS": "boss, Admin@Example.com"}


def resp(code, body):
    r = mock.Mock(status_code=code)
    r.json.return_value = body
    return r


class TestInvites(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        from api import auth, deps
        deps._waitlist_hits.clear(); deps._code_hits.clear(); deps._verify_hits.clear()
        self.env = mock.patch.dict(os.environ, ENV); self.env.start()
        os.environ.pop("ARYA_REGISTRATION_OPEN", None)
        auth.create_user("boss", "pw-123456")
        self.c = TestClient(main.app)
        self.guest = TestClient(main.app)
        self.c.post("/auth/login", json={"username": "boss", "password": "pw-123456"})
        for e in ("maya@example.com", "devon@example.com"):
            self.guest.post("/auth/waitlist", json={"email": e})

    def tearDown(self):
        self.env.stop()

    def test_owner_lists_and_approves(self):
        rows = self.c.get("/auth/waitlist/list").json()["rows"]
        self.assertEqual([r["email"] for r in rows], ["maya@example.com", "devon@example.com"])
        self.assertFalse(any(r["approved"] for r in rows))
        r = self.c.post("/auth/waitlist/approve", json={"emails": ["Maya@example.com", "nobody@example.com"]})
        self.assertEqual(r.json(), {"approved": 1, "emailed": 0})
        rows = {r["email"]: r["approved"] for r in self.c.get("/auth/waitlist/list").json()["rows"]}
        self.assertEqual(rows, {"maya@example.com": True, "devon@example.com": False})

    def test_only_owner_can_manage(self):
        self.assertEqual(self.guest.get("/auth/waitlist/list").status_code, 401)
        from api import auth
        auth.create_user("other", "pw-123456")
        self.guest.post("/auth/login", json={"username": "other", "password": "pw-123456"})
        for call in (lambda: self.guest.get("/auth/waitlist/list"),
                     lambda: self.guest.post("/auth/waitlist/approve", json={"emails": ["maya@example.com"]}),
                     lambda: self.guest.post("/auth/waitlist/remove", json={"emails": ["maya@example.com"]})):
            self.assertEqual(call().status_code, 403)

    def test_admin_is_its_own_setting_and_fails_closed(self):
        from api import auth
        auth.create_user("admin@example.com", "pw-123456")   # an email-named (e.g. Google) account
        a = self.guest
        a.post("/auth/login", json={"username": "admin@example.com", "password": "pw-123456"})
        self.assertEqual(a.get("/auth/waitlist/list").status_code, 200)
        with mock.patch.dict(os.environ, {"ARYA_WAITLIST_ADMINS": ""}):
            self.assertEqual(self.c.get("/auth/waitlist/list").status_code, 403)   # even the owner: default deny
        with mock.patch.dict(os.environ, {"ARYA_WAITLIST_ADMINS": "someone-else", "ARYA_OWNER_USERNAME": "boss"}):
            self.assertEqual(self.c.get("/auth/waitlist/list").status_code, 403)   # owner setting is not reused

    def test_bad_lists_are_400(self):
        for bad in ({}, {"emails": []}, {"emails": "a@b.co"}, {"emails": [1]}, {"emails": ["a@b.co"] * 51}):
            self.assertEqual(self.c.post("/auth/waitlist/approve", json=bad).status_code, 400)

    def test_code_goes_only_to_approved_or_existing_and_answer_is_the_same(self):
        with mock.patch("api.supabase_auth.httpx.post", return_value=resp(200, {})) as post:
            a = self.guest.post("/auth/email/start", json={"email": "stranger@example.com"})
            self.assertEqual((a.status_code, a.json()), (200, {"ok": True}))
            post.assert_not_called()
            self.c.post("/auth/waitlist/approve", json={"emails": ["maya@example.com"]})
            b = self.guest.post("/auth/email/start", json={"email": "maya@example.com"})
            self.assertEqual(b.json(), a.json())
            self.assertEqual(post.call_count, 1)
            self.guest.post("/auth/email/start", json={"email": "boss"})  # not an email: 400, no mail
            self.assertEqual(post.call_count, 1)

    def test_approve_can_send_the_code_mail(self):
        with mock.patch("api.supabase_auth.httpx.post", return_value=resp(200, {})) as post:
            r = self.c.post("/auth/waitlist/approve",
                            json={"emails": ["maya@example.com", "devon@example.com"], "send_email": True})
        self.assertEqual(r.json(), {"approved": 2, "emailed": 2})
        self.assertEqual(post.call_count, 2)

    def test_unapproved_cannot_sign_in_even_with_a_valid_code(self):
        user = {"email": "devon@example.com", "email_confirmed_at": "t"}
        with mock.patch("api.supabase_auth.httpx.post", return_value=resp(200, {"user": user})):
            r = self.guest.post("/auth/email/verify", json={"email": "devon@example.com", "code": "1"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.guest.get("/auth/me").json()["user"], None)

    def test_first_sign_in_creates_account_and_deletes_the_row(self):
        self.c.post("/auth/waitlist/approve", json={"emails": ["maya@example.com"]})
        user = {"email": "maya@example.com", "email_confirmed_at": "t"}
        with mock.patch("api.supabase_auth.httpx.post", return_value=resp(200, {"user": user})):
            r = self.guest.post("/auth/email/verify", json={"email": "maya@example.com", "code": "1"})
        self.assertEqual(r.json(), {"user": "maya@example.com", "created": True})
        left = [x["email"] for x in self.c.get("/auth/waitlist/list").json()["rows"]]
        self.assertEqual(left, ["devon@example.com"])

    def test_registration_switch_open_lets_anyone_in_and_signup_0_overrides(self):
        user = {"email": "free@example.com", "email_confirmed_at": "t"}
        self.c.post("/auth/registration", json={"open": True})
        with mock.patch("api.supabase_auth.httpx.post", return_value=resp(200, {"user": user})):
            with mock.patch.dict(os.environ, {"ARYA_SUPABASE_SIGNUP": "0"}):
                self.assertEqual(self.guest.post("/auth/email/verify", json={"email": "free@example.com", "code": "1"}).status_code, 403)
            self.assertEqual(self.guest.post("/auth/email/verify", json={"email": "free@example.com", "code": "1"}).status_code, 200)

    def test_remove_and_password_login_unchanged(self):
        self.assertEqual(self.c.post("/auth/waitlist/remove", json={"emails": ["maya@example.com", "x@y.co"]}).json(), {"removed": 1})
        self.assertEqual(self.guest.post("/auth/login", json={"username": "boss", "password": "pw-123456"}).status_code, 200)

    def test_reject_keeps_the_row_blocks_sign_in_and_can_be_undone(self):
        self.c.post("/auth/waitlist/approve", json={"emails": ["maya@example.com"]})
        r = self.c.post("/auth/waitlist/reject", json={"emails": ["maya@example.com", "x@y.co"]})
        self.assertEqual(r.json(), {"rejected": 1})
        rows = {x["email"]: x for x in self.c.get("/auth/waitlist/list").json()["rows"]}
        self.assertEqual((rows["maya@example.com"]["approved"], rows["maya@example.com"]["rejected"]), (False, True))
        self.assertEqual(self.guest.post("/auth/waitlist", json={"email": "maya@example.com"}).json(), {"status": "already"})
        user = {"email": "maya@example.com", "email_confirmed_at": "t"}
        with mock.patch("api.supabase_auth.httpx.post", return_value=resp(200, {"user": user})):
            self.assertEqual(self.guest.post("/auth/email/verify", json={"email": "maya@example.com", "code": "1"}).status_code, 403)
        self.assertEqual(self.c.post("/auth/waitlist/restore", json={"emails": ["maya@example.com"]}).json(), {"restored": 1})
        rows = {x["email"]: x for x in self.c.get("/auth/waitlist/list").json()["rows"]}
        self.assertEqual((rows["maya@example.com"]["approved"], rows["maya@example.com"]["rejected"]), (False, False))
        self.c.post("/auth/waitlist/reject", json={"emails": ["maya@example.com"]})
        self.c.post("/auth/waitlist/approve", json={"emails": ["maya@example.com"]})   # approve undoes a reject
        rows = {x["email"]: x for x in self.c.get("/auth/waitlist/list").json()["rows"]}
        self.assertEqual((rows["maya@example.com"]["approved"], rows["maya@example.com"]["rejected"]), (True, False))

    def test_reject_and_restore_are_owner_only(self):
        for path in ("reject", "restore"):
            self.assertEqual(self.guest.post("/auth/waitlist/" + path, json={"emails": ["maya@example.com"]}).status_code, 401)

    def test_cli_approve_and_list(self):
        import io, contextlib
        from harness import waitlist as cli
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            cli.main(["approve", "maya@example.com"]); cli.main(["list"])
        text = out.getvalue()
        self.assertIn("approved 1", text)
        self.assertIn("maya@example.com  approved", text)
        self.assertIn("devon@example.com\n", text)


if __name__ == "__main__":
    unittest.main()
