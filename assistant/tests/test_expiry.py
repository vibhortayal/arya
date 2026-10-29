"""Expiry dates — owner 2026-10-29. A photo of the printed date is read
once by Spark; confirming saves it on the item's flag record; the
use-soon list is plain code. Nothing is saved by a read."""
import json, os, tempfile, unittest
from datetime import date, timedelta

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient  # noqa: E402

from api import expiry  # noqa: E402
from tests.test_list_pass import seed_receipt  # noqa: E402

TODAY = date(2026, 10, 29)
ENTRIES = [{"item_id": "tj-milk", "canonical_name": "Whole Milk"},
           {"item_id": "tj-almond", "canonical_name": "Almond Milk"}]


class TestNormalize(unittest.TestCase):
    def read(self, **k):
        dec = {"product": "Whole Milk 1 gal", "date": "2026-11-03", "kind": "use_by",
               "confidence": 0.9, "raw": "USE BY NOV 03"}
        dec.update(k)
        return expiry.normalize_read(dec, TODAY)

    def test_good_read(self):
        r = self.read()
        self.assertTrue(r["readable"])
        self.assertEqual((r["date"], r["kind"], r["name"]), ("2026-11-03", "use_by", "Whole Milk 1 gal"))

    def test_unreadable_cases_ask_the_user(self):
        for bad in (dict(date=None), dict(confidence=0.3), dict(kind="packed"),
                    dict(date="2019-01-01"), dict(date="2099-01-01"), dict(date="not a date"),
                    dict(confidence="high")):
            self.assertFalse(self.read(**bad)["readable"], bad)

    def test_odd_kind_is_unknown(self):
        self.assertEqual(self.read(kind="whenever")["kind"], "unknown")


class TestMatch(unittest.TestCase):
    def test_size_words_do_not_block_a_match(self):
        self.assertEqual(expiry.match_item("Whole Milk 1 gal", ENTRIES, {}), "tj-milk")

    def test_milk_is_not_almond_milk(self):
        self.assertIsNone(expiry.match_item("Milk", ENTRIES, {}))
        self.assertEqual(expiry.match_item("almond milk 64 oz", ENTRIES, {}), "tj-almond")

    def test_typed_items_and_blank(self):
        fl = {"manual-bagels": {"manual": True, "name": "Everything Bagels"}}
        self.assertEqual(expiry.match_item("everything bagels 6 ct", [], fl), "manual-bagels")
        self.assertIsNone(expiry.match_item(None, ENTRIES, {}))


class TestUseSoon(unittest.TestCase):
    def flags(self, **over):
        f = {"use_by": "2026-11-03", "use_by_set": "2026-10-29"}
        f.update(over)
        return {"a": f}

    def run_(self, flags, last_bought=None):
        return expiry.use_soon(flags, {"a": "Milk"}, last_bought or {}, TODAY)

    def test_window(self):
        self.assertEqual([r["days"] for r in self.run_(self.flags())], [5])
        self.assertEqual(self.run_(self.flags(use_by="2026-11-20")), [])      # too far
        self.assertEqual(len(self.run_(self.flags(use_by="2026-10-27"))), 1)  # past, neutral
        self.assertEqual(self.run_(self.flags(use_by="2026-10-01")), [])      # faded

    def test_sorted_soonest_first(self):
        fl = {"a": {"use_by": "2026-11-03"}, "b": {"use_by": "2026-10-30", "name": "Spinach"}}
        out = expiry.use_soon(fl, {"a": "Milk"}, {}, TODAY)
        self.assertEqual([r["name"] for r in out], ["Spinach", "Milk"])

    def test_snooze_waits_then_returns(self):
        self.assertEqual(self.run_(self.flags(use_by_snooze="2026-10-31")), [])
        self.assertEqual(len(self.run_(self.flags(use_by_snooze="2026-10-28"))), 1)

    def test_new_receipt_means_new_package(self):
        self.assertEqual(self.run_(self.flags(), {"a": "2026-10-30"}), [])
        self.assertEqual(len(self.run_(self.flags(), {"a": "2026-10-29"})), 1)


class FakeVision:
    reply = {"product": "Whole Milk 1 gal", "date": None, "kind": "use_by",
             "confidence": 0.9, "raw": ""}

    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        assert personal and mode == "standard"
        assert any(isinstance(m.get("content"), list) for m in messages)
        return json.dumps(self.reply), {}, 0.001


class TestRoutes(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state
        from api import deps
        deps.MetaClient = FakeVision
        deps._login_fails.clear()
        self.state = state
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
        seed_receipt(self.c, "Trader Joe's", (date.today() - timedelta(days=3)).isoformat(),
                     [("Whole Milk 1 gal", "3001", 4.0)], "r1")
        state.set_current_user("t@x.y")
        state._save("dictionary.json", {"entries": [
            {"item_id": "tj-3001", "canonical_name": "Whole Milk 1 gal"}]})
        state.set_current_user(None)
        self.due = (date.today() + timedelta(days=4)).isoformat()
        FakeVision.reply = dict(FakeVision.reply, date=self.due)

    def photo(self):
        return self.c.post("/api/expiry/read", content=b"\xff\xd8\xff fake",
                           headers={"content-type": "image/jpeg"})

    def use_soon(self):
        return self.c.get("/api/home").json()["use_soon"]

    def test_read_matches_but_saves_nothing(self):
        r = self.photo().json()
        self.assertTrue(r["readable"])
        self.assertEqual(r["date"], self.due)
        self.assertEqual(r["match"]["name"], "Whole Milk 1 gal")
        self.assertEqual(self.use_soon(), [])

    def test_unreadable_photo(self):
        FakeVision.reply = dict(FakeVision.reply, date=None, confidence=0)
        r = self.photo().json()
        self.assertFalse(r["readable"])
        self.assertIsNone(r["date"])

    def test_rejects_non_image_and_empty(self):
        r = self.c.post("/api/expiry/read", content=b"x", headers={"content-type": "text/plain"})
        self.assertEqual(r.status_code, 415)
        r = self.c.post("/api/expiry/read", content=b"", headers={"content-type": "image/jpeg"})
        self.assertEqual(r.status_code, 400)

    def test_sample_is_demo_only(self):
        self.assertEqual(self.c.post("/api/expiry/read?sample=1").status_code, 400)

    def test_save_then_done_snooze_stop(self):
        item = self.photo().json()["match"]["item_id"]
        r = self.c.post("/api/expiry/save", json={"item_id": item, "date": self.due, "kind": "use_by"})
        self.assertEqual(r.status_code, 200, r.text)
        soon = self.use_soon()
        self.assertEqual([(s["item_id"], s["days"]) for s in soon], [(item, 4)])
        self.assertEqual(self.c.post(f"/api/expiry/{item}/snooze").status_code, 200)
        self.assertEqual(self.use_soon(), [])
        self.c.post("/api/expiry/save", json={"item_id": item, "date": self.due})  # fix the date
        self.assertEqual(len(self.use_soon()), 1)
        self.assertEqual(self.c.post(f"/api/expiry/{item}/done").status_code, 200)
        self.assertEqual(self.use_soon(), [])
        self.assertEqual(self.c.post(f"/api/expiry/{item}/stop").status_code, 404)

    def test_save_rejects_bad_dates(self):
        for d in ("soon", "1999-01-01", None):
            r = self.c.post("/api/expiry/save", json={"name": "Milk", "date": d})
            self.assertEqual(r.status_code, 400, d)
        r = self.c.post("/api/expiry/save", json={"date": self.due})
        self.assertEqual(r.status_code, 400)

    def test_unknown_item_is_tracked_but_not_listed(self):
        r = self.c.post("/api/expiry/save", json={"name": "Oat Creamer", "date": self.due}).json()
        self.assertTrue(r["item_id"].startswith("manual-"))
        self.assertEqual([s["name"] for s in self.use_soon()], ["Oat Creamer"])
        listed = [i["name"] for i in self.c.get("/api/home").json()["list"]["items"]]
        self.assertNotIn("Oat Creamer", listed)

    def test_flag_route_accepts_the_new_keys(self):
        r = self.c.post("/api/items/tj/flag", json={"use_by": self.due})
        self.assertEqual(r.status_code, 200)


class TestDemo(unittest.TestCase):
    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        from api import main
        from api import deps
        self.c = TestClient(main.app)
        self.c.post("/auth/demo")

    def test_sample_read_needs_no_model_and_matches_demo_milk(self):
        r = self.c.post("/api/expiry/read?sample=1").json()
        self.assertTrue(r["readable"])
        self.assertEqual(r["match"]["name"], "Whole Milk 1 gal")
        self.assertTrue(r["demo"])

    def test_demo_save_lands_in_the_visitors_sandbox(self):
        r = self.c.post("/api/expiry/read?sample=1").json()
        s = self.c.post("/api/expiry/save", json={"item_id": r["match"]["item_id"], "date": r["date"]})
        self.assertEqual(s.status_code, 200, s.text)
        soon = self.c.get("/api/home").json()["use_soon"]
        self.assertEqual([x["name"] for x in soon], ["Whole Milk 1 gal"])
        other = TestClient(__import__("api.main", fromlist=["app"]).app)
        other.post("/auth/demo")
        self.assertEqual(other.get("/api/home").json()["use_soon"], [])

    def test_real_date_replaces_the_shelf_life_guess(self):
        before = [c["item_id"] for c in self.c.get("/api/home").json()["checks"]]
        if not before:
            self.skipTest("demo has no shelf-life guesses today")
        iid = before[0]
        self.c.post("/api/expiry/save", json={"item_id": iid,
                    "date": (date.today() + timedelta(days=3)).isoformat()})
        after = [c["item_id"] for c in self.c.get("/api/home").json()["checks"]]
        self.assertNotIn(iid, after)


class TestClientWiring(unittest.TestCase):
    def test_shell_loads_the_expiry_script_and_hooks(self):
        from tests import frontend
        today = frontend.src("screens/Today.tsx")
        self.assertIn('id="today-expiry"', today)
        self.assertIn("h?.use_soon", today)
        # Expiry lives on Today only (owner, 2026-10-29): not on the List.
        lists = frontend.src("screens/Lists.tsx") + frontend.src("screens/lists/ListSheets.tsx")
        for gone in ('id="list-use"', 'id="btn-expiry"', 'data-ls="expiry"', "use_soon"):
            self.assertNotIn(gone, lists)

    def test_copy_follows_the_wireframe(self):
        from tests import frontend
        js = frontend.src("screens/Today.tsx")  # expiry.js was ported into Today
        for phrase in ("Arya tracks use-by dates", "Add a use-by date", "Add a date",
                       "Nothing is saved until you tap", "Past the date. Still good, or toss it?",
                       "Add it to your list?", "Try a sample date"):
            self.assertIn(phrase, js)
        self.assertNotIn("danger", js)   # a date is information, never an alarm


if __name__ == "__main__":
    unittest.main()
