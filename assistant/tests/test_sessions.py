"""Session hardening — review 2026-10-28, M5.

Session tokens are stored hashed (a leaked sessions.json is not
a set of live logins); pre-hardening plaintext sessions migrate
on first use; the login limiter keys on the LAST X-Forwarded-For
entry — the one the proxy appended — not the spoofable first one.
"""
import hashlib, os, tempfile, time, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"


class TestSessionHashing(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import auth
        self.auth = auth

    def test_token_stored_hashed_not_raw(self):
        tok = self.auth.new_session("a@example.com")
        stored = self.auth._load("sessions.json", {})
        self.assertNotIn(tok, stored)
        digest = hashlib.sha256(tok.encode()).hexdigest()
        self.assertIn(digest, stored)
        self.assertEqual(self.auth.session_user(tok), "a@example.com")

    def test_legacy_plaintext_session_migrates(self):
        legacy = "legacy-raw-token"
        self.auth._save("sessions.json", {
            legacy: {"user": "old@example.com", "demo": False,
                     "expires": int(time.time()) + 3600}})
        self.assertEqual(self.auth.session_user(legacy), "old@example.com")
        stored = self.auth._load("sessions.json", {})
        self.assertNotIn(legacy, stored)
        self.assertIn(hashlib.sha256(legacy.encode()).hexdigest(), stored)
        # Still authenticates after migration, and logout works.
        self.assertEqual(self.auth.session_user(legacy), "old@example.com")
        self.auth.drop_session(legacy)
        self.assertIsNone(self.auth.session_user(legacy))

    def test_drop_session_removes_hashed_key(self):
        tok = self.auth.new_session("b@example.com")
        self.auth.drop_session(tok)
        self.assertIsNone(self.auth.session_user(tok))
        self.assertEqual(self.auth._load("sessions.json", {}), {})


class TestLoginLimiterKey(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        self.main = main
        main._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "lim@example.com",
                                             "password": "pw-test"})
        assert r.status_code == 200, r.text
        self.c.cookies.clear()

    def _attempt(self, xff):
        return self.c.post(
            "/auth/login",
            json={"username": "lim@example.com", "password": "wrong"},
            headers={"X-Forwarded-For": xff})

    def test_spoofed_first_entry_does_not_reset_the_bucket(self):
        # Eight failures, each with a DIFFERENT spoofed first entry
        # but the same real (last) address: the ninth is throttled.
        for i in range(8):
            r = self._attempt(f"10.0.0.{i}, 203.0.113.7")
            self.assertEqual(r.status_code, 401, r.text)
        r = self._attempt("10.9.9.9, 203.0.113.7")
        self.assertEqual(r.status_code, 429, r.text)

    def test_a_different_real_address_is_a_different_bucket(self):
        for i in range(8):
            self._attempt(f"10.0.0.{i}, 203.0.113.7")
        r = self._attempt("10.0.0.1, 198.51.100.3")
        self.assertEqual(r.status_code, 401, r.text)


if __name__ == "__main__":
    unittest.main()
