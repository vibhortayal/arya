"""Demo Town (owner, 2026-10-29): the demo household reads as if hundreds
of shoppers live around it. Simulated data, demo account only, flag
off by default."""
import importlib.util, json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient


def _gen(base):
    spec = importlib.util.spec_from_file_location(
        "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    gen.main(base)


class TownCase(unittest.TestCase):
    flag = "1"

    def setUp(self):
        self.base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = self.base
        os.environ["ARYA_DEMO_TOWN"] = self.flag
        _gen(self.base)
        from api.main import app
        self.c = TestClient(app)
        self.c.post("/auth/demo")

    def tearDown(self):
        os.environ.pop("ARYA_DEMO_TOWN", None)

    def hints(self):
        return self.c.get("/api/town/hints").json()


class TestTownOn(TownCase):
    def setUp(self):
        super().setUp()
        # Shop hours follow the clock; these tests are about the director,
        # not the time of day, so the stores are always open.
        from unittest import mock
        p = mock.patch("api.town._open_now", return_value=True)
        p.start()
        self.addCleanup(p.stop)

    def test_household_shops_at_invented_stores(self):
        rs = json.load(open(os.path.join(self.base, "users", "demo", "receipts.json")))
        merchants = {r["merchant"] for r in rs}
        self.assertEqual(merchants, {"Trader Jill's", "Safeday", "Costcozy"})
        lists = json.load(open(os.path.join(self.base, "users", "demo", "lists.json")))["lists"]
        self.assertEqual({l["name"] for l in lists}, {"Costcozy", "Trader Jill's"})
        flags = json.load(open(os.path.join(self.base, "users", "demo", "flags.json")))
        self.assertEqual(flags["demo-eggs"]["list"], "l-demo-costco")

    def test_baseline_is_calm_but_not_empty(self):
        h = self.hints()
        self.assertEqual(h["label"], "Simulated")
        self.assertTrue(all(s["status"] in ("open", "shut") for s in h["stores"].values()))
        eggs = h["items"]["demo-eggs"]["stores"]["Costcozy"]
        self.assertEqual(eggs["state"], "in")
        self.assertTrue(h["feed"])

    def test_director_eggs_out_needs_four_households_and_points_to_another_store(self):
        self.c.post("/api/town/director", json={"scenario": "eggs_out"})
        it = self.hints()["items"]["demo-eggs"]
        self.assertEqual(it["stores"]["Costcozy"]["state"], "out")
        self.assertEqual(it["stores"]["Costcozy"]["households"], 4)
        self.assertIsNotNone(it["alt"])
        self.assertNotEqual(it["alt"]["store"], "Costcozy")

    def test_closed_store_gets_an_open_alternative(self):
        out = self.c.post("/api/town/director", json={"scenario": "closes"}).json()
        st = out["stores"]["Trader Jill's"]
        self.assertEqual(st["status"], "closed")
        self.assertEqual(st["why"], "Water main break")
        alt = out["alternatives"]["Trader Jill's"]
        self.assertEqual(out["stores"][alt]["status"], "open")

    def test_reset_clears_the_staged_moments(self):
        self.c.post("/api/town/director", json={"scenario": "closes"})
        out = self.c.post("/api/town/director", json={"scenario": "reset"}).json()
        self.assertEqual(out["stores"]["Trader Jill's"]["status"], "open")

    def test_a_visitor_report_is_one_household_and_the_rule_needs_three(self):
        def eggs():
            return self.hints()["items"]["demo-eggs"]["stores"]["Safeday"]
        for n in (1, 2):
            self.c.post("/api/town/report", json={"kind": "out", "store": "Safeday", "item": "eggs"})
            self.assertEqual(eggs()["state"], "in")
            self.assertEqual(eggs()["pending"], n)
        self.c.post("/api/town/report", json={"kind": "out", "store": "Safeday", "item": "eggs"})
        self.assertEqual(eggs()["state"], "out")

    def test_i_see_them_here_cancels_one_report(self):
        self.c.post("/api/town/director", json={"scenario": "eggs_out"})   # 4 households
        self.c.post("/api/town/report", json={"kind": "in", "store": "Costcozy", "item": "eggs"})
        eggs = self.hints()["items"]["demo-eggs"]["stores"]["Costcozy"]
        self.assertEqual((eggs["state"], eggs["households"]), ("out", 3))
        self.c.post("/api/town/report", json={"kind": "in", "store": "Costcozy", "item": "eggs"})
        self.assertEqual(self.hints()["items"]["demo-eggs"]["stores"]["Costcozy"]["state"], "in")

    def test_bad_input_is_refused(self):
        self.assertEqual(self.c.post("/api/town/director", json={"scenario": "nope"}).status_code, 400)
        self.assertEqual(self.c.post("/api/town/report", json={"kind": "out", "store": "Nowhere"}).status_code, 400)

    def test_events_stay_in_the_sandbox_not_on_disk(self):
        self.c.post("/api/town/director", json={"scenario": "closes"})
        self.assertFalse(os.path.exists(os.path.join(self.base, "users", "demo", "town.json")))

    def test_a_real_account_gets_nothing(self):
        from api import auth
        auth.create_user("realuser", "pw-12345678")
        c2 = TestClient(self.c.app)
        c2.post("/auth/login", json={"username": "realuser", "password": "pw-12345678"})
        self.assertEqual(c2.get("/api/town/hints").status_code, 404)
        self.assertEqual(c2.post("/api/town/director", json={"scenario": "closes"}).status_code, 404)


class TestTownOff(TownCase):
    flag = "0"

    def test_flag_off_means_no_routes_and_real_style_names(self):
        self.assertEqual(self.c.get("/api/town/hints").status_code, 404)
        rs = json.load(open(os.path.join(self.base, "users", "demo", "receipts.json")))
        self.assertIn("Costco", {r["merchant"] for r in rs})


class TestTownPack(unittest.TestCase):
    def test_pack_is_deterministic_and_invented(self):
        from harness.scalesim import make_town
        a, b = make_town.build(300), make_town.build(300)
        self.assertEqual(json.dumps(a, sort_keys=True), json.dumps(b, sort_keys=True))
        names = {s["name"] for s in a["stores"]}
        self.assertFalse(names & {"Costco", "Trader Joe's", "Safeway", "Target", "Aldi"})
        self.assertEqual(a["label"], "Simulated")


if __name__ == "__main__":
    unittest.main()
