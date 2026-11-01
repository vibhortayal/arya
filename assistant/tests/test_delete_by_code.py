"""Deleting an account with no password (email code or Google sign-in)
by a 6-digit code emailed to it (owner, 2026-11-01), and the Postgres
copy going with the account (security review 2026-11-01, M1)."""
import os, tempfile, unittest
from unittest import mock

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"

MAYA = "maya@example.com"
ALICE = "alice@example.com"


class TestDeleteByCode(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ["RESEND_API_KEY"] = "test"
        from fastapi.testclient import TestClient
        import api.main as main
        from api import auth, deps
        deps._code_hits.clear()
        auth._delete_codes.clear()
        auth.create_user(ALICE, "pw-alice")
        auth.ensure_federated_user(MAYA)
        self.c = TestClient(main.app)
        self.c.cookies.set(auth.COOKIE, auth.new_session(MAYA))
        self.sent = []
        p = mock.patch("api.mailer.account_delete_code",
                       side_effect=lambda to, code, m: self.sent.append((to, code)) or True)
        p.start()
        self.addCleanup(p.stop)

    def tearDown(self):
        os.environ.pop("RESEND_API_KEY", None)

    def _user_dir(self):
        from api import state
        return state.user_dir(MAYA)

    def test_me_says_no_password(self):
        me = self.c.get("/auth/me").json()
        self.assertFalse(me["has_password"])

    def test_code_deletes_the_account(self):
        r = self.c.post("/auth/account/delete/code", json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["to"], MAYA)
        to, code = self.sent[-1]
        self.assertEqual(to, MAYA)
        self.assertEqual(len(code), 6)
        r = self.c.post("/auth/account/delete", json={"code": code})
        self.assertEqual(r.status_code, 200, r.text)
        from api import auth
        self.assertNotIn(MAYA, auth.users())

    def test_wrong_code_refused_and_used_up_after_five(self):
        self.c.post("/auth/account/delete/code", json={})
        _, code = self.sent[-1]
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(5):
            r = self.c.post("/auth/account/delete", json={"code": wrong})
            self.assertEqual(r.status_code, 401)
        r = self.c.post("/auth/account/delete", json={"code": code})
        self.assertEqual(r.status_code, 401)   # five misses burn the code
        from api import auth
        self.assertIn(MAYA, auth.users())

    def test_no_code_no_delete(self):
        r = self.c.post("/auth/account/delete", json={})
        self.assertEqual(r.status_code, 401)
        r = self.c.post("/auth/account/delete", json={"password": ""})
        self.assertEqual(r.status_code, 401)

    def test_expired_code_refused(self):
        from api import auth
        self.c.post("/auth/account/delete/code", json={})
        _, code = self.sent[-1]
        auth._delete_codes[MAYA]["expires"] = 0
        r = self.c.post("/auth/account/delete", json={"code": code})
        self.assertEqual(r.status_code, 401)

    def test_second_send_within_a_minute_waits(self):
        self.assertEqual(self.c.post("/auth/account/delete/code", json={}).status_code, 200)
        self.assertEqual(self.c.post("/auth/account/delete/code", json={}).status_code, 429)

    def test_mail_failure_says_so(self):
        with mock.patch("api.mailer.account_delete_code", return_value=False):
            r = self.c.post("/auth/account/delete/code", json={})
        self.assertEqual(r.status_code, 502)
        # and asking again works at once
        self.assertEqual(self.c.post("/auth/account/delete/code", json={}).status_code, 200)

    def test_no_mailer_points_to_support(self):
        os.environ.pop("RESEND_API_KEY")
        r = self.c.post("/auth/account/delete/code", json={})
        self.assertEqual(r.status_code, 503)
        self.assertIn("support@", r.json()["detail"])

    def test_password_account_keeps_password(self):
        from api import auth
        c = self.c
        c.cookies.set(auth.COOKIE, auth.new_session(ALICE))
        self.assertTrue(c.get("/auth/me").json()["has_password"])
        self.assertEqual(c.post("/auth/account/delete/code", json={}).status_code, 400)
        # a code is never a way round the password
        self.assertEqual(c.post("/auth/account/delete", json={"code": "123456"}).status_code, 401)
        r = c.post("/auth/account/delete", json={"password": "pw-alice"})
        self.assertEqual(r.status_code, 200, r.text)

    def test_demo_cannot_ask(self):
        from api import auth
        self.c.cookies.set(auth.COOKIE, auth.new_session("demo", demo=True))
        self.assertEqual(self.c.post("/auth/account/delete/code", json={}).status_code, 403)

    def test_postgres_copy_goes_too(self):
        from api import auth, pgstore
        with mock.patch.object(pgstore, "mode", return_value="dual"), \
                mock.patch.object(pgstore, "delete_owner") as drop, \
                mock.patch.object(pgstore, "uses_pg", return_value=False):
            self.assertTrue(auth.delete_user(MAYA))
        drop.assert_called_once_with(MAYA)

    def test_postgres_failure_in_dual_mode_still_deletes(self):
        from api import auth, pgstore
        with mock.patch.object(pgstore, "mode", return_value="dual"), \
                mock.patch.object(pgstore, "delete_owner", side_effect=RuntimeError("down")), \
                mock.patch.object(pgstore, "uses_pg", return_value=False):
            self.assertTrue(auth.delete_user(MAYA))
        self.assertNotIn(MAYA, auth.users())


if __name__ == "__main__":
    unittest.main()
