import json, os, tempfile, unittest
from unittest import mock

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient


class TestAuth(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api.main import app
        self.c = TestClient(app)

    def test_full_flow(self):
        c = self.c
        self.assertEqual(c.get("/api/home").status_code, 401)
        self.assertFalse(c.get("/auth/status").json()["has_users"])
        r = c.post("/auth/setup", json={"username": "Vibhor", "password": "correct horse"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(c.get("/api/home").status_code, 200)
        self.assertEqual(c.get("/auth/me").json()["user"], "vibhor")
        # setup closes after the first account
        self.assertEqual(c.post("/auth/setup", json={"username": "x", "password": "y"}).status_code, 403)
        c.post("/auth/logout")
        self.assertEqual(c.get("/api/home").status_code, 401)
        self.assertEqual(c.post("/auth/login", json={"username": "vibhor", "password": "wrong"}).status_code, 401)
        self.assertEqual(c.post("/auth/login", json={"username": "vibhor", "password": "correct horse"}).status_code, 200)
        self.assertEqual(c.get("/api/home").status_code, 200)

    def test_short_name_matches_email_account(self):
        from api import auth
        auth.create_user("tester-a@test.arya", "pw-123456")
        auth.create_user("tester-b@test.arya", "pw-123456")
        self.assertEqual(auth.resolve_login_name(" Tester-A "), "tester-a@test.arya")
        self.assertTrue(auth.verify("tester-a", "pw-123456"))
        self.assertFalse(auth.verify("tester-a", "nope"))
        self.assertEqual(auth.resolve_login_name("nobody"), "nobody")
        auth.create_user("tester-a@other.arya", "pw-123456")
        self.assertEqual(auth.resolve_login_name("tester-a"), "tester-a")  # ambiguous: no guess
        r = self.c.post("/auth/login", json={"username": "tester-b", "password": "pw-123456"})
        self.assertEqual(r.json()["user"], "tester-b@test.arya")

    def test_register_locked_by_default(self):
        c = self.c
        c.post("/auth/setup", json={"username": "owner", "password": "correct horse"})
        c.post("/auth/logout")
        # locked (owner, 2026-10-28): register refuses and creates nothing
        self.assertFalse(c.get("/auth/status").json()["registration_open"])
        r = c.post("/auth/register", json={"username": "New@Example.com", "password": "long enough"})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(c.post("/auth/login", json={"username": "new@example.com", "password": "long enough"}).status_code, 401)
        # existing accounts are unaffected
        self.assertEqual(c.post("/auth/login", json={"username": "owner", "password": "correct horse"}).status_code, 200)

    @mock.patch.dict(os.environ, {"ARYA_REGISTRATION_OPEN": "1"})
    def test_register_opens_public_signup(self):
        c = self.c
        c.post("/auth/setup", json={"username": "owner", "password": "correct horse"})
        c.post("/auth/logout")
        # setup stays closed, but anyone may register
        self.assertEqual(c.post("/auth/setup", json={"username": "x", "password": "y12345678"}).status_code, 403)
        r = c.post("/auth/register", json={"username": "New@Example.com", "password": "long enough"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["user"], "new@example.com")
        self.assertEqual(c.get("/api/home").status_code, 200)  # signed in at once
        c.post("/auth/logout")
        # the registered account signs in through the normal door
        self.assertEqual(c.post("/auth/login", json={"username": "new@example.com", "password": "long enough"}).status_code, 200)
        c.post("/auth/logout")
        # duplicates, reserved names, and short passwords are refused
        self.assertEqual(c.post("/auth/register", json={"username": "new@example.com", "password": "long enough"}).status_code, 400)
        self.assertEqual(c.post("/auth/register", json={"username": "demo", "password": "long enough"}).status_code, 400)
        self.assertEqual(c.post("/auth/register", json={"username": "shorty@example.com", "password": "short"}).status_code, 400)

    @mock.patch.dict(os.environ, {"ARYA_OWNER_USERNAME": "owner"})
    def test_owner_toggle_opens_and_closes_registration(self):
        c = self.c
        c.post("/auth/setup", json={"username": "owner", "password": "correct horse"})
        # signed in as the owner: the toggle is manageable and starts closed
        st = c.get("/auth/registration").json()
        self.assertEqual(st, {"registration_open": False, "can_manage": True})
        # flipping it opens public signup with no environment flag set
        r = c.post("/auth/registration", json={"open": True})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["registration_open"])
        self.assertTrue(c.get("/auth/status").json()["registration_open"])
        c.post("/auth/logout")
        r = c.post("/auth/register", json={"username": "new@example.com", "password": "long enough"})
        self.assertEqual(r.status_code, 200)
        # a non-owner can read the state but never flip it
        st = c.get("/auth/registration").json()
        self.assertEqual(st, {"registration_open": True, "can_manage": False})
        self.assertEqual(c.post("/auth/registration", json={"open": False}).status_code, 403)
        # the owner closes it again; signup refuses once more
        c.post("/auth/logout")
        c.post("/auth/login", json={"username": "owner", "password": "correct horse"})
        self.assertFalse(c.post("/auth/registration", json={"open": False}).json()["registration_open"])
        c.post("/auth/logout")
        r = c.post("/auth/register", json={"username": "two@example.com", "password": "long enough"})
        self.assertEqual(r.status_code, 403)

    @mock.patch.dict(os.environ, {"ARYA_OWNER_USERNAME": "owner",
                                  "ARYA_REGISTRATION_OPEN": "1"})
    def test_owner_toggle_overrides_environment(self):
        c = self.c
        c.post("/auth/setup", json={"username": "owner", "password": "correct horse"})
        self.assertTrue(c.get("/auth/status").json()["registration_open"])  # env says open
        c.post("/auth/registration", json={"open": False})
        self.assertFalse(c.get("/auth/status").json()["registration_open"])  # toggle wins

    def test_registration_toggle_needs_login_and_owner(self):
        c = self.c
        # logged out: the state endpoint refuses outright
        self.assertEqual(c.get("/auth/registration").status_code, 401)
        self.assertEqual(c.post("/auth/registration", json={"open": True}).status_code, 401)
        # with no ARYA_OWNER_USERNAME configured, nobody can manage it
        c.post("/auth/setup", json={"username": "owner", "password": "correct horse"})
        self.assertFalse(c.get("/auth/registration").json()["can_manage"])
        self.assertEqual(c.post("/auth/registration", json={"open": True}).status_code, 403)
        # a malformed body is a 400 for the owner, never a silent flip
        with mock.patch.dict(os.environ, {"ARYA_OWNER_USERNAME": "owner"}):
            self.assertEqual(c.post("/auth/registration", json={"open": "yes"}).status_code, 400)

    def test_first_user_adopts_household_data(self):
        from api import state
        from api.decode.service import normalize_costco_json
        golden = os.path.join(os.path.dirname(__file__), "..", "golden", "synthetic-costco-receipt.json")
        state.add_receipts([normalize_costco_json(json.load(open(golden)))])
        self.c.post("/auth/setup", json={"username": "owner", "password": "pw"})
        dash = self.c.get("/api/dashboard").json()
        self.assertEqual(dash["trip_count"], 1)


if __name__ == "__main__":
    unittest.main()


class TestHardening(unittest.TestCase):
    def setUp(self):
        from api import deps
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        import api.main as main
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "owner", "password": "right"})

    def test_login_throttle(self):
        for _ in range(8):
            self.assertEqual(self.c.post("/auth/login", json={"username": "owner", "password": "nope"}).status_code, 401)
        self.assertEqual(self.c.post("/auth/login", json={"username": "owner", "password": "nope"}).status_code, 429)

    def test_budget_guard(self):
        os.environ["ARYA_DAILY_BUDGET_USD"] = "0"
        os.environ["MODEL_API_KEY"] = "k"
        try:
            r = self.c.post("/decode/text", json={"text": "x"})
            self.assertEqual(r.status_code, 503)
            self.assertIn("budget", r.json()["detail"])
        finally:
            os.environ.pop("ARYA_DAILY_BUDGET_USD", None)


class TestSupabaseSignin(unittest.TestCase):
    ENV = {"ARYA_SUPABASE_AUTH": "1", "SUPABASE_URL": "https://x.supabase.co",
           "SUPABASE_ANON_KEY": "anon"}

    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api.main import app
        self.c = TestClient(app)

    def _resp(self, code, body):
        r = mock.Mock(status_code=code)
        r.json.return_value = body
        return r

    def test_off_when_unconfigured(self):
        self.assertFalse(self.c.get("/auth/status").json()["email_signin"])
        self.assertEqual(self.c.post("/auth/email/start", json={"email": "a@b.co"}).status_code, 404)

    def test_flag_off_by_default_even_with_keys(self):
        keys = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_ANON_KEY": "anon"}
        with mock.patch.dict(os.environ, keys):
            os.environ.pop("ARYA_SUPABASE_AUTH", None)
            self.assertFalse(self.c.get("/auth/status").json()["email_signin"])
            self.assertEqual(self.c.get("/auth/google", follow_redirects=False).status_code, 404)
        with mock.patch.dict(os.environ, {**keys, "ARYA_SUPABASE_AUTH": "1"}):
            self.assertTrue(self.c.get("/auth/status").json()["email_signin"])

    def test_code_flow_creates_passwordless_account(self):
        user = {"email": "New@Example.com", "email_confirmed_at": "2026-10-29"}
        with mock.patch.dict(os.environ, self.ENV), \
                mock.patch("api.supabase_auth.httpx.post") as post:
            post.return_value = self._resp(200, {})
            self.assertTrue(self.c.get("/auth/status").json()["email_signin"])
            self.assertEqual(self.c.post("/auth/email/start", json={"email": "New@Example.com"}).status_code, 200)
            post.return_value = self._resp(200, {"user": user})
            r = self.c.post("/auth/email/verify", json={"email": "new@example.com", "code": "123456"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"user": "new@example.com", "created": True})
        self.assertEqual(self.c.get("/auth/me").json()["user"], "new@example.com")
        self.c.post("/auth/logout")
        # a passwordless account cannot be opened with an empty or guessed password
        from api import auth
        for pw in ("", "None", "x"):
            self.assertFalse(auth.verify("new@example.com", pw))

    def test_bad_code_and_unverified_email_refused(self):
        with mock.patch.dict(os.environ, self.ENV), \
                mock.patch("api.supabase_auth.httpx.post") as post:
            post.return_value = self._resp(400, {})
            self.assertEqual(self.c.post("/auth/email/verify", json={"email": "a@b.co", "code": "0"}).status_code, 401)
            post.return_value = self._resp(200, {"user": {"email": "a@b.co"}})
            self.assertEqual(self.c.post("/auth/email/verify", json={"email": "a@b.co", "code": "1"}).status_code, 401)
        self.assertEqual(self.c.get("/auth/me").json()["user"], None)

    def test_existing_account_is_reused_and_signup_can_be_closed(self):
        from api import auth
        auth.create_user("old@example.com", "pw-123456")
        with mock.patch.dict(os.environ, {**self.ENV, "ARYA_SUPABASE_SIGNUP": "0"}), \
                mock.patch("api.supabase_auth.httpx.get") as get:
            get.return_value = self._resp(200, {"email": "old@example.com", "email_confirmed_at": "t"})
            r = self.c.post("/auth/supabase", json={"access_token": "tok"})
            self.assertEqual(r.json(), {"user": "old@example.com", "created": False})
            self.c.post("/auth/logout")
            get.return_value = self._resp(200, {"email": "stranger@example.com", "email_confirmed_at": "t"})
            self.assertEqual(self.c.post("/auth/supabase", json={"access_token": "tok"}).status_code, 403)

    def test_google_redirect(self):
        with mock.patch.dict(os.environ, self.ENV):
            r = self.c.get("/auth/google", follow_redirects=False)
        self.assertEqual(r.status_code, 307)
        self.assertIn("provider=google", r.headers["location"])
        self.assertIn("auth%2Fcallback", r.headers["location"])
