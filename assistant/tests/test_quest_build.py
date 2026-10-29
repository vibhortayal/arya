"""Quest Build (2026-10-29, Fable review): three answers make a whole
store in the game; one Spark call adapts it, one more applies a change
said in a sentence. Model output is checked against the game's rules
and a bad answer leaves the base store standing. Saved maps (My map,
dream stores) are per account."""
import copy, json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"

BASE = {"id": "build", "source": "dream", "size": "m", "look": "neon", "name": "Spice Bazaar", "zones": [
    {"id": "produce", "kind": "produce", "band": "left", "index": 0, "label": "Vegetables", "categories": ["okra"]},
    {"id": "spices", "kind": "aisle", "band": "left", "index": 1, "label": "Turkish pantry", "categories": ["cumin"]},
    {"id": "dairy", "kind": "dairy", "band": "back", "index": 0, "label": "Dairy", "size": "l"},
    {"id": "rice", "kind": "aisle", "band": "centre", "index": 0, "label": "Aisle 1 · Rice", "short": "Aisle 1"},
    {"id": "frozen", "kind": "frozen", "band": "right", "index": 0, "label": "Frozen", "size": "l"},
]}


class Fake:
    api_key = "k"

    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def chat(self, messages, mode="standard", personal=False, **k):
        self.calls.append((messages, mode, personal, k))
        return self.answer if isinstance(self.answer, str) else json.dumps(self.answer), {}, 0.0


def zones_with(**changes):
    zs = copy.deepcopy(BASE["zones"])
    zs[1].update(changes)
    return zs


class TestRules(unittest.TestCase):
    def setUp(self):
        from api import questbuild
        self.b = questbuild

    def test_base_is_clean(self):
        self.assertEqual(self.b.problems(BASE), [])
        self.assertEqual(self.b.clean_graph(BASE)["zones"][3]["short"], "Aisle 1")

    def test_breaking_the_rules_is_caught(self):
        bad = [
            {**BASE, "zones": []},
            {**BASE, "look": "gold"},
            {**BASE, "zones": zones_with(id="Bad Id")},
            {**BASE, "zones": zones_with(id="produce")},
            {**BASE, "zones": zones_with(kind="garden")},
            {**BASE, "zones": zones_with(band="roof")},
            {**BASE, "zones": zones_with(label="x" * 49)},
            {**BASE, "zones": zones_with(index="1")},
            {**BASE, "zones": [dict(BASE["zones"][0], id=f"l{i}", index=i) for i in range(5)]},
        ]
        for g in bad:
            self.assertTrue(self.b.problems(g), g)

    def test_clean_graph_drops_extra_fields(self):
        g = self.b.clean_graph({**BASE, "extra": 1, "zones": zones_with(secret="x")})
        self.assertNotIn("extra", g)
        self.assertNotIn("secret", g["zones"][1])


class TestBuild(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state, questbuild
        state.set_current_user("ana")
        state.set_overlay(None)
        self.b = questbuild

    def test_model_adapts_the_base(self):
        zs = zones_with(label="Turkish spices", categories=["sumac", "pul biber"])
        f = Fake({"zones": zs, "say": "Your bazaar is ready."})
        g, say = self.b.build(f, {"type": "cuisine", "cuisine": "Turkish", "focus": ["snacks"], "extra": "olive bar"}, BASE)
        self.assertEqual(g["zones"][1]["label"], "Turkish spices")
        self.assertEqual((g["look"], g["name"], g["id"]), ("neon", "Spice Bazaar", "build"))
        self.assertEqual(say, "Your bazaar is ready.")
        msg, mode, personal, k = f.calls[0]
        self.assertEqual((mode, personal, k["schema"][0]), ("standard", True, "quest_store"))
        self.assertIn("(Turkish)", msg[0]["content"])
        self.assertIn("olive bar", msg[0]["content"])

    def test_bad_model_answers_leave_the_base(self):
        for answer in ({"zones": zones_with(kind="garden")}, {"zones": []}, "not json", {"say": "hi"}):
            g, say = self.b.build(Fake(answer), {"type": "supermarket"}, BASE)
            self.assertEqual(g, self.b.clean_graph(BASE), answer)

    def test_no_key_and_failures_never_raise(self):
        class Boom(Fake):
            def chat(self, *a, **k):
                raise RuntimeError("Meta API HTTP 503")
        self.assertEqual(self.b.build(Boom({}), {}, BASE)[0], self.b.clean_graph(BASE))
        self.assertEqual(self.b.build(None, {}, BASE)[0], self.b.clean_graph(BASE))
        self.assertEqual(self.b.build(None, {}, {"zones": []}), (None, ""))

    def test_change(self):
        moved = zones_with(band="back", index=1)
        g, say = self.b.change(Fake({"zones": moved, "say": "Moved the pantry to the back."}), BASE, "move the pantry to the back")
        self.assertEqual(g["zones"][1]["band"], "back")
        self.assertEqual(say, "Moved the pantry to the back.")
        g, say = self.b.change(Fake({"zones": zones_with(band="roof")}), BASE, "put it on the roof")
        self.assertEqual(g, self.b.clean_graph(BASE))
        self.assertIn("couldn't", say)
        f = Fake({})
        g, say = self.b.change(f, BASE, "  ")
        self.assertEqual(f.calls, [])
        self.assertEqual(self.b.change(None, BASE, "move it")[0], self.b.clean_graph(BASE))

    def test_saved_maps(self):
        self.assertEqual(self.b.list_maps(), [])
        a = self.b.save_map({"kind": "dream", "name": "Spice Bazaar", "graph": BASE})
        self.assertEqual(a["key"], "dream:spice-bazaar")
        self.b.save_map({"kind": "store", "storeId": "tj-1", "name": "Trader Joe's", "graph": {**BASE, "source": "mine"}})
        self.b.save_map({"kind": "dream", "name": "Spice  bazaar!", "graph": {**BASE, "look": "farm"}})
        maps = self.b.list_maps()
        self.assertEqual([m["key"] for m in maps], ["dream:spice-bazaar", "store:tj-1"])
        self.assertEqual(maps[0]["graph"]["look"], "farm")
        self.assertIsNone(self.b.save_map({"kind": "store", "name": "x", "graph": BASE}))
        self.assertIsNone(self.b.save_map({"kind": "dream", "name": "x", "graph": {"zones": []}}))
        self.assertIsNone(self.b.save_map({"kind": "public", "name": "x", "graph": BASE}))
        for i in range(30):
            self.b.save_map({"kind": "dream", "name": f"Store {i}", "graph": BASE})
        self.assertEqual(len(self.b.list_maps()), self.b.MAX_MAPS)


class TestRoutes(unittest.TestCase):
    def test_routes(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        self.addCleanup(os.environ.__setitem__, "MODEL_API_KEY", os.environ.get("MODEL_API_KEY", ""))
        os.environ["MODEL_API_KEY"] = ""  # never a live call from a test
        from fastapi.testclient import TestClient
        from api.main import app
        c = TestClient(app)
        self.assertIn(c.post("/api/quest/build", json={"base": BASE}).status_code, (401, 403))
        self.assertIn(c.get("/api/quest/maps").status_code, (401, 403))
        c.post("/auth/demo")
        r = c.post("/api/quest/build", json={"answers": {"type": "supermarket"}, "base": BASE})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["graph"]["name"], "Spice Bazaar")
        self.assertEqual(c.post("/api/quest/build", json={"base": {"zones": []}}).status_code, 400)
        r = c.post("/api/quest/build/change", json={"graph": BASE, "say": "move frozen"})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["say"])
        r = c.put("/api/quest/maps", json={"kind": "dream", "name": "Spice Bazaar", "graph": BASE})
        self.assertEqual(r.status_code, 200)
        self.assertEqual([m["key"] for m in c.get("/api/quest/maps").json()["maps"]], ["dream:spice-bazaar"])
        self.assertEqual(c.put("/api/quest/maps", json={"kind": "dream"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
