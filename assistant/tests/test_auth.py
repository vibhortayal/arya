import json, os, tempfile, unittest

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
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        import api.main as main
        main._login_fails.clear()
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
