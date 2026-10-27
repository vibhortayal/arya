import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient


def seed_demo(base):
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    gen.main(base)


class TestEyes(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        seed_demo(base)
        import api.main as main
        reads = [
            {"sightings": [{"name": "Whole Milk", "confidence": 0.95},
                           {"name": "Baby Spinach", "confidence": 0.9}]},
            {"sightings": [{"name": "Whole Milk", "confidence": 0.92},
                           {"name": "Eggs", "confidence": 0.6}]},
        ]

        class FakeClient:
            def __init__(self, ledger=None):
                self.calls = 0

            def chat(self, messages, mode=None, personal=None):
                payload = reads[min(self.calls, 1)]
                self.calls += 1
                return json.dumps(payload), {}, 0.02

        main.MetaClient = FakeClient
        self.c = TestClient(main.app)
        self.c.post("/auth/demo")  # demo data dir is users/demo; auth as owner instead below

    def test_dual_judge_and_confirm_flow(self):
        # Use a real account whose dir we seed: simpler to test via demo user data
        # by logging in as demo is read-only, so create the owner and move data.
        c = self.c
        r = c.post("/eyes/photo?kind=fridge", content=b"\xff\xd8img",
                   headers={"Content-Type": "image/jpeg"})
        # demo session is read-only -> 403 proves the gate; use owner flow in next test
        self.assertEqual(r.status_code, 403)


class TestEyesOwner(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        # seed the demo dataset into the future owner's dir by generating at root
        # then letting setup adopt only root files; instead: create user, then
        # generate into users/<name> via data_dir swap is complex — generate at
        # base and copy users/demo -> users/owner.
        seed_demo(base)
        import shutil
        os.makedirs(os.path.join(base, "users"), exist_ok=True)
        shutil.copytree(os.path.join(base, "users", "demo"), os.path.join(base, "users", "owner"))
        import api.main as main
        reads = [
            {"sightings": [{"name": "Whole Milk", "confidence": 0.95},
                           {"name": "Baby Spinach", "confidence": 0.9}]},
            {"sightings": [{"name": "Whole Milk", "confidence": 0.92},
                           {"name": "Eggs", "confidence": 0.6}]},
        ]

        class FakeClient:
            def __init__(self, ledger=None):
                self.calls = 0

            def chat(self, messages, mode=None, personal=None):
                payload = reads[min(self.calls, 1)]
                self.calls += 1
                return json.dumps(payload), {}, 0.02

        main.MetaClient = FakeClient
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "owner", "password": "pw"})

    def test_sighting_confirm_removes_from_list(self):
        c = self.c
        home0 = c.get("/api/home").json()
        self.assertIn("Whole Milk 1 gal", [i["name"] for i in home0["list"]["items"]])
        r = c.post("/eyes/photo?kind=fridge", content=b"\xff\xd8img",
                   headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 200)
        rec = r.json()
        by_name = {s["name"]: s for s in rec["sightings"]}
        self.assertTrue(by_name["Whole Milk"]["judge_agree"])       # both reads saw it
        self.assertFalse(by_name["Baby Spinach"]["judge_agree"])    # one read only
        self.assertEqual(by_name["Whole Milk"]["item_id"], "demo-milk")
        idx = [i for i, s in enumerate(rec["sightings"]) if s["name"] == "Whole Milk"][0]
        c.post(f"/api/eyes/{rec['id']}/sightings/{idx}", json={"state": "confirmed"})
        home = c.get("/api/home").json()
        self.assertNotIn("Whole Milk 1 gal", [i["name"] for i in home["list"]["items"]])
        self.assertIn("Whole Milk 1 gal", [s["name"] for s in home["seen"]])
        # the photo itself is served to the signed-in user only
        self.assertEqual(c.get(f"/eyes/photos/{rec['id']}").status_code, 200)


class TestChat(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        seed_demo(base)
        import shutil
        os.makedirs(os.path.join(base, "users"), exist_ok=True)
        shutil.copytree(os.path.join(base, "users", "demo"), os.path.join(base, "users", "owner"))
        import api.main as main

        class FakeClient:
            def __init__(self, ledger=None):
                pass

            def chat(self, messages, mode=None, personal=None):
                snap = messages[1]["content"]
                assert "Whole Milk 1 gal" in snap  # snapshot carries the model
                return json.dumps({"reply": "Yogurt is on the list. Milk is due too.",
                                   "actions": [{"type": "ran_out", "item": "Greek Yogurt 32 oz"},
                                               {"type": "add_to_list", "item": "Untracked Thing"}]}), {}, 0.01

        main.MetaClient = FakeClient
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "owner", "password": "pw"})

    def test_chat_answers_and_applies(self):
        r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "we finished the yogurt"}]})
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertIn("Greek Yogurt 32 oz", " ".join(d["applied"]))
        self.assertTrue(any("don't track" in s for s in d["skipped"]))
        home = self.c.get("/api/home").json()
        self.assertIn("Greek Yogurt 32 oz", [i["name"] for i in home["list"]["items"]])


if __name__ == "__main__":
    unittest.main()
