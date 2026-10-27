import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
from fastapi.testclient import TestClient


class FakeClient:
    api_key = "test"

    def __init__(self):
        self.calls = 0

    def chat(self, messages, mode="standard", personal=False, reasoning_effort=None):
        self.calls += 1
        listing = messages[-1]["content"]
        verdicts = []
        for line in listing.splitlines():
            iid = line.split("]")[0].strip("[ ")
            name = line.split("|")[0].split("] ")[-1].strip()
            if "Uber" in name:
                verdicts.append({"item_id": iid, "class": "NOT_CONSUMABLE", "reason": "gift card promo"})
            elif "Yogurt" in name:
                verdicts.append({"item_id": iid, "class": "OCCASIONAL", "reason": "a few times a year"})
            else:
                verdicts.append({"item_id": iid, "class": "STAPLE", "reason": "regular staple"})
        return json.dumps({"verdicts": verdicts}), {}, 0.01


def seed(c):
    import importlib.util, shutil
    base = os.environ["ARYA_DATA_DIR"]
    spec = importlib.util.spec_from_file_location(
        "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    gen.main(base)
    os.makedirs(os.path.join(base, "users"), exist_ok=True)
    shutil.copytree(os.path.join(base, "users", "demo"), os.path.join(base, "users", "owner"))
    c.post("/auth/setup", json={"username": "owner", "password": "pw"})


class TestJudgeAdmission(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api.main import app
        self.c = TestClient(app)
        seed(self.c)

    def test_demo_verdicts_admit_staples_only(self):
        home = self.c.get("/api/home").json()
        names = {i["name"] for i in home["list"]["items"]}
        self.assertIn("Whole Milk 1 gal", names)
        self.assertNotIn("Greek Yogurt 32 oz", names)

    def test_unjudged_item_stays_off(self):
        # wipe the milk verdict: conservative default keeps it off
        import os as _os
        p = _os.path.join(_os.environ["ARYA_DATA_DIR"], "users", "owner", "judged.json")
        d = json.load(open(p))
        del d["demo-milk"]
        json.dump(d, open(p, "w"))
        home = self.c.get("/api/home").json()
        self.assertNotIn("Whole Milk 1 gal", {i["name"] for i in home["list"]["items"]})

    def test_judge_pending_and_cache(self):
        from api import state
        token = state._current_user.set("owner")
        try:
            fake = FakeClient()
            n = state.judge_pending(fake)
            self.assertGreaterEqual(fake.calls, 1)
            judged = state.judgments()
            self.assertIn("demo-yogurt", judged)
            self.assertFalse(judged["demo-yogurt"]["list_ok"])
            calls = fake.calls
            state.judge_pending(fake)  # nothing new to judge
            self.assertEqual(fake.calls, calls)
        finally:
            state._current_user.reset(token)


if __name__ == "__main__":
    unittest.main()
