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

    def _disk(self):
        out = {}
        for root, _dirs, files in os.walk(os.environ["ARYA_DATA_DIR"]):
            for f in files:
                if f in ("sessions.json", "cost-ledger.jsonl"):
                    continue
                p = os.path.join(root, f)
                with open(p, "rb") as fh:
                    out[p] = fh.read()
        return out

    def test_demo_batch_doors_stay_closed(self):
        self.assertEqual(self.c.post("/decode/pdf", content=b"x").status_code, 403)
        self.assertEqual(self.c.post("/api/judge/run").status_code, 403)
        self.assertEqual(self.c.post("/api/curator/run").status_code, 403)
        self.assertEqual(self.c.get("/api/home").status_code, 200)

    def test_demo_writes_land_in_a_sandbox_not_on_disk(self):
        before = self._disk()
        self.assertEqual(self.c.post("/api/cart/approve").status_code, 200)
        r = self.c.post("/api/list/add", json={"name": "Hummus"})
        self.assertEqual(r.status_code, 200)
        names = [i["name"] for i in self.c.get("/api/home").json()["list"]["items"]]
        self.assertIn("Hummus", names)
        self.assertEqual(self._disk(), before)
        # A second demo visitor starts from the shipped household.
        c2 = TestClient(self.c.app)
        c2.post("/auth/demo")
        names2 = [i["name"] for i in c2.get("/api/home").json()["list"]["items"]]
        self.assertNotIn("Hummus", names2)

    def test_demo_plays_a_hunt_end_to_end(self):
        before = self._disk()
        opt = self.c.post("/api/quest/optimize", json={"items": ["milk", "bread"]})
        self.assertEqual(opt.status_code, 200)
        sess = self.c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest", "driver": "strip",
            "items": ["Whole Milk 1 gal", "Sourdough Loaf"]}).json()
        sid = sess["id"]
        self.assertEqual(self.c.post(f"/api/quest/sessions/{sid}/state",
                                     json={"state": "playing"}).status_code, 200)
        item = sess["items"][0]["id"] if "id" in sess["items"][0] else sess["items"][0]["name"]
        r = self.c.post(f"/api/quest/sessions/{sid}/check", json={"item": item})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.c.post(f"/api/quest/sessions/{sid}/state",
                                     json={"state": "finished"}).status_code, 200)
        listed = [s["id"] for s in self.c.get("/api/quest/sessions").json()["sessions"]]
        self.assertIn(sid, listed)
        self.assertEqual(self._disk(), before)

    def test_demo_sample_receipt_settles_in_the_sandbox(self):
        # Hunt v2 plan item 8: one tap settles the demo hunt through
        # the real attach path, dated now, with nothing on disk.
        before = self._disk()
        sess = self.c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest", "driver": "strip",
            "items": ["Whole Milk 1 gal", "Sourdough Loaf"]}).json()
        sid = sess["id"]
        self.c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        self.c.post(f"/api/quest/sessions/{sid}/check",
                    json={"item": sess["items"][0]["name"]})
        self.c.post(f"/api/quest/sessions/{sid}/state", json={"state": "finished"})
        r = self.c.post(f"/api/quest/sessions/{sid}/sample-receipt")
        self.assertEqual(r.status_code, 200, r.text)
        done = r.json()
        self.assertEqual(done["state"], "done")
        self.assertTrue(done["settled"])
        rec = self.c.get(f"/api/quest/receipts/{done['receipt_id']}").json()
        self.assertEqual(rec["merchant"], "Trader Joe's")
        self.assertEqual([ln["name"] for ln in rec["lines"]],
                         [sess["items"][0]["name"]])
        self.assertGreater(rec["total"], 0)
        # The brain still reads the household after a sample settles.
        self.assertEqual(self.c.get("/api/home").status_code, 200)
        self.assertEqual(self._disk(), before)

    def test_demo_household_lives_in_the_present_week(self):
        from datetime import date, timedelta
        home = self.c.get("/api/home").json()
        self.assertEqual(home["as_of"], (date.today() - timedelta(days=3)).isoformat())

    def test_demo_name_is_reserved(self):
        c2 = TestClient(self.c.app)
        r = c2.post("/auth/setup", json={"username": "demo", "password": "pw"})
        self.assertIn(r.status_code, (400, 403))


if __name__ == "__main__":
    unittest.main()
