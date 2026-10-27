import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient


class TestDemoHousehold(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/demo")

    def test_home_shows_due_staples(self):
        home = self.c.get("/api/home").json()
        names = [p["name"] for p in home["running_low"]]
        self.assertIn("Whole Milk 1 gal", names)
        self.assertIn("Sourdough Loaf", names)
        list_names = [i["name"] for i in home["list"]["items"]]
        self.assertIn("Whole Milk 1 gal", list_names)

    def test_dashboard_nets_the_return(self):
        d = self.c.get("/api/dashboard").json()
        self.assertEqual(d["returns_total"], 12.30)
        self.assertEqual(d["for_others_total"], 25.0)
        self.assertEqual(d["trip_count"], 27)

    def test_demo_is_read_only(self):
        self.assertEqual(self.c.post("/decode/pdf", content=b"x").status_code, 403)
        self.assertEqual(self.c.post("/api/cart/approve").status_code, 403)
        self.assertEqual(self.c.get("/api/home").status_code, 200)

    def test_demo_name_is_reserved(self):
        c2 = TestClient(self.c.app)
        r = c2.post("/auth/setup", json={"username": "demo", "password": "pw"})
        self.assertIn(r.status_code, (400, 403))


if __name__ == "__main__":
    unittest.main()
