"""Scale simulator (harness/scalesim): deterministic, labelled, never near live data."""
import os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()

from harness.scalesim import agents, model, world  # noqa: E402


class TestScaleSim(unittest.TestCase):
    def test_same_seed_same_result(self):
        a, b = agents.run(120, weeks=4), agents.run(120, weeks=4)
        self.assertEqual(a["trips"], b["trips"])
        self.assertEqual(a["map"]["lapse"], b["map"]["lapse"])

    def test_more_users_fill_more_of_the_map(self):
        def mapped(n):
            r = agents.run(n, weeks=6)
            return sum(r["map"]["final"][s]["mapped"] for s in r["stores"])
        self.assertGreater(mapped(1000), mapped(100))

    def test_community_price_needs_five_households(self):
        buys = [(0, d, h, "Aldi", "milk", 3.0) for d, h in zip(range(4), range(4))]
        opt = {h: True for h in range(10)}
        self.assertEqual(agents._community(buys, opt, 1), {})
        buys.append((0, 4, 4, "Aldi", "milk", 3.0))
        self.assertEqual(agents._community(buys, opt, 1), {("Aldi", "milk"): 3.0})

    def test_system_model_gets_tighter_with_users(self):
        cal = model.load_cal()
        k = agents.run(1000, weeks=12)
        a = {x: k[x] for x in ("users", "households", "trips", "receipt_lines", "photos", "weeks")}
        small, big = (model.system(n, "typical", cal, a) for n in (200, 1000000))
        self.assertLess(small["peak_rps"], big["peak_rps"])
        self.assertTrue(any(l["status"] == "breaks" for l in big["limits"]))

    def test_label_and_no_live_data(self):
        self.assertEqual(__import__("harness.scalesim", fromlist=["LABEL"]).LABEL, "Simulated")
        html = open(os.path.join(os.path.dirname(__file__), "..", "docs", "scale-sim", "index.html")).read()
        self.assertIn("Simulated", html)


if __name__ == "__main__":
    unittest.main()
