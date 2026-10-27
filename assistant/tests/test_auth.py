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
