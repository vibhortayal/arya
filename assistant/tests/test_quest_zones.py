"""Quest zones (2026-10-29, Fable review): list items the game's words
do not know are filed into the store's own zones by one Spark call,
cached per account by graph and item name. A failed or odd answer
never blocks a trip, and no key means cache only."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"

ZONES = [{"id": "produce", "label": "Produce", "categories": ["banana"]},
         {"id": "aisle4", "label": "Aisle 4 · Household", "categories": ["soap"]},
         {"id": "aisle2", "label": "Aisle 2 · Pasta & Oils", "categories": ["pasta"]}]


class Fake:
    api_key = "k"

    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def chat(self, messages, mode="standard", personal=False, **k):
        self.calls.append((messages, mode, personal, k))
        return self.answer if isinstance(self.answer, str) else json.dumps(self.answer), {}, 0.0


class TestClassify(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state
        state.set_current_user("ana")
        state.set_overlay(None)
        from api import questmap
        self.q = questmap

    def test_model_files_unknown_items_and_caches_them(self):
        f = Fake({"items": [{"name": "Dish brush", "zone": "aisle4"}, {"name": "Tahini", "zone": "aisle2"}]})
        out, src = self.q.classify(f, "template", ["Dish brush", "Tahini"], ZONES)
        self.assertEqual(out, {"Dish brush": "aisle4", "Tahini": "aisle2"})
        self.assertEqual(set(src.values()), {"model"})
        msg, mode, personal, k = f.calls[0]
        self.assertEqual(mode, "standard")
        self.assertTrue(personal)
        self.assertIn("aisle4: Aisle 4 · Household (soap)", msg[0]["content"])
        self.assertEqual(k["schema"][0], "quest_zones")
        # Second time: from the cache, no call; spelling and case do not matter.
        f2 = Fake({"items": []})
        out2, src2 = self.q.classify(f2, "template", ["dish  BRUSH"], ZONES)
        self.assertEqual(out2, {"dish  BRUSH": "aisle4"})
        self.assertEqual(src2, {"dish  BRUSH": "cache"})
        self.assertEqual(f2.calls, [])

    def test_cache_is_per_graph(self):
        self.q.classify(Fake({"items": [{"name": "Tahini", "zone": "aisle2"}]}), "template", ["Tahini"], ZONES)
        f = Fake({"items": [{"name": "Tahini", "zone": "produce"}]})
        out, _ = self.q.classify(f, "dream:abc", ["Tahini"], ZONES)
        self.assertEqual(out, {"Tahini": "produce"})
        self.assertEqual(len(f.calls), 1)

    def test_unknown_zone_ids_and_bad_answers_are_dropped(self):
        out, _ = self.q.classify(Fake({"items": [{"name": "Tahini", "zone": "aisle99"}, "junk"]}), "t", ["Tahini"], ZONES)
        self.assertEqual(out, {})
        out, _ = self.q.classify(Fake("not json at all"), "t", ["Tahini"], ZONES)
        self.assertEqual(out, {})

    def test_failed_call_and_no_key_never_raise(self):
        class Boom(Fake):
            def chat(self, *a, **k):
                raise RuntimeError("Meta API HTTP 503")
        self.assertEqual(self.q.classify(Boom({}), "t", ["Tahini"], ZONES), ({}, {}))
        nokey = Fake({"items": [{"name": "Tahini", "zone": "aisle2"}]})
        nokey.api_key = ""
        self.assertEqual(self.q.classify(nokey, "t", ["Tahini"], ZONES), ({}, {}))
        self.assertEqual(nokey.calls, [])
        self.assertEqual(self.q.classify(None, "t", ["Tahini"], ZONES), ({}, {}))

    def test_limits(self):
        names, zs = self.q.clean_request(["x"] * 3 + [f"i{n}" for n in range(100)] + [7, ""],
                                         ZONES + [{"id": "Bad Id", "label": "x"}, "junk"])
        self.assertEqual(len(names), self.q.MAX_ITEMS)
        self.assertEqual(names[0], "x")
        self.assertEqual([z["id"] for z in zs], ["produce", "aisle4", "aisle2"])


class TestRoute(unittest.TestCase):
    def test_route_is_registered_and_signed_in_only(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        self.addCleanup(os.environ.__setitem__, "MODEL_API_KEY", os.environ.get("MODEL_API_KEY", ""))
        os.environ["MODEL_API_KEY"] = ""  # never a live call from a test
        from fastapi.testclient import TestClient
        from api.main import app
        c = TestClient(app)
        r = c.post("/api/quest/zones", json={"items": ["Tahini"], "zones": ZONES})
        self.assertIn(r.status_code, (401, 403))
        c.post("/auth/demo")
        r = c.post("/api/quest/zones", json={"graph": "template", "items": ["Tahini"], "zones": ZONES})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(r.json()), {"zones", "source"})




class TestSubstitute(unittest.TestCase):
    """Quest "Substitute" (Fable review): the trip keeps what was taken instead."""

    def test_check_keeps_and_clears_the_substitute(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import quest, state
        state.set_current_user("ana")
        state.set_overlay(None)
        sess = quest.create_session("Corner Store", raw_items=["Eggs", "Milk"])
        s = quest.check_item(sess["id"], "Milk", True, "Oat milk")
        milk = next(i for i in s["items"] if i["name"] == "Milk")
        self.assertEqual(milk["instead"], "Oat milk")
        s = quest.check_item(sess["id"], "Milk", False, "Oat milk")
        self.assertNotIn("instead", next(i for i in s["items"] if i["name"] == "Milk"))
        s = quest.check_item(sess["id"], "Eggs", True)
        self.assertNotIn("instead", next(i for i in s["items"] if i["name"] == "Eggs"))


if __name__ == "__main__":
    unittest.main()
