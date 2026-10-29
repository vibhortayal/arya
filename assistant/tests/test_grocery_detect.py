import json
import os
import tempfile
import unittest

from api.list import grocery
from api.list.intake import skipped_pieces, split_list_items


class ClassifyTest(unittest.TestCase):
    def kind(self, name, verdicts=None):
        return grocery.classify(name, verdicts)["kind"]

    def test_groceries_pass(self):
        for n in ["milk", "tortillas", "oat milk", "eggs", "paper towels",
                  "apple", "frozen tv dinner"]:
            self.assertEqual(self.kind(n), "grocery", n)

    def test_non_grocery_rules(self):
        cases = {"gift card": "gift cards", "Gift Cards": "gift cards",
                 "golf": "sports & hobbies", "iPhone charger": "electronics",
                 "apple iphone": "electronics", "gas": "fuel",
                 "prescription": "pharmacy", "socks": "clothing"}
        for name, sub in cases.items():
            g = grocery.classify(name)
            self.assertEqual((g["kind"], g["sub"]), ("other", sub), name)

    def test_weak_word_loses_to_aisle_hit(self):
        # "tv dinner" is frozen food; a bare "tv" is electronics.
        self.assertEqual(self.kind("tv"), "other")
        self.assertNotEqual(self.kind("frozen tv dinner"), "other")

    def test_unknown_is_not_blocked_or_flagged(self):
        for n in ["asdf", "paneer", "leche", "दूध", "zzz"]:
            self.assertEqual(self.kind(n), "unknown", n)

    def test_saved_verdict_fills_unknown_and_user_beats_rules(self):
        key = grocery._key("paneer")
        self.assertEqual(self.kind("paneer", {key: {"kind": "grocery",
                                                    "src": "model"}}),
                         "grocery")
        gk = grocery._key("gift card")
        self.assertEqual(self.kind("gift card", {gk: {"kind": "grocery",
                                                      "src": "user"}}),
                         "grocery")
        # A model verdict never overrides a rule.
        self.assertEqual(self.kind("gift card", {gk: {"kind": "grocery",
                                                      "src": "model"}}),
                         "other")

    def test_empty_is_unknown(self):
        self.assertEqual(self.kind(""), "unknown")


class AddBoxTest(unittest.TestCase):
    def test_non_latin_is_an_item_not_skipped(self):
        self.assertEqual(split_list_items("दूध, leche"),
                         [("दूध", 1), ("leche", 1)])
        self.assertEqual(skipped_pieces("दूध"), [])

    def test_numbers_and_punctuation_still_skipped(self):
        self.assertEqual(skipped_pieces("12345, ???, milk"), ["12345", "???"])


class FakeClient:
    def __init__(self, reply):
        self.reply, self.calls = reply, 0

    def chat(self, messages, **kw):
        self.calls += 1
        self.kw = kw
        return self.reply, {}, 0.0


class JudgeTest(unittest.TestCase):
    def test_confident_verdicts_cached_low_confidence_remembered_unsure(self):
        reply = json.dumps({"verdicts": [
            {"name": "Titleist Pro V1", "kind": "other",
             "sub": "sports & hobbies", "confidence": 0.9},
            {"name": "paneer", "kind": "grocery", "sub": None,
             "confidence": 0.95},
            {"name": "widget", "kind": "other", "sub": "clothing",
             "confidence": 0.3},
            {"name": "not asked", "kind": "other", "confidence": 0.99}]})
        c = FakeClient(reply)
        out = grocery.judge_unknown(
            ["Titleist Pro V1", "paneer", "widget"], c)
        self.assertEqual(c.calls, 1)
        self.assertTrue(c.kw["personal"])
        self.assertEqual(out[grocery._key("Titleist Pro V1")]["kind"], "other")
        self.assertEqual(out[grocery._key("paneer")]["kind"], "grocery")
        self.assertEqual(out[grocery._key("widget")]["kind"], "unknown")
        self.assertNotIn(grocery._key("not asked"), out)

    def test_failure_yields_nothing(self):
        self.assertEqual(grocery.judge_unknown(["x1"], FakeClient("oops")), {})

        class Boom:
            def chat(self, *a, **k):
                raise RuntimeError("down")
        self.assertEqual(grocery.judge_unknown(["x1"], Boom()), {})


if __name__ == "__main__":
    unittest.main()


# --- routes ---------------------------------------------------------------
os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from datetime import date, timedelta  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from tests.test_list_pass import seed_receipt  # noqa: E402


class JudgeFake:
    """The staple judge gets {"verdicts": []}; the grocery judge gets
    a verdict for whatever names it was sent."""
    calls = 0

    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        JudgeFake.calls += 1
        names = messages[-1]["content"].split("\n")
        if k.get("cache_key") != "arya-grocery-judge-v1":
            return json.dumps({"verdicts": []}), {}, 0.0
        return json.dumps({"verdicts": [
            {"name": n, "kind": "other" if "putter" in n else "grocery",
             "sub": "sports & hobbies", "confidence": 0.9}
            for n in names]}), {}, 0.0


class RouteTest(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main
        main.MetaClient = JudgeFake
        main._login_fails.clear()
        JudgeFake.calls = 0
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "t@x.y",
                                         "password": "long-password"})

    def items(self):
        return {i["name"]: i for i in
                self.c.get("/api/home").json()["list"]["items"]}

    def test_nothing_is_dropped_and_rules_flag_for_free(self):
        self.c.post("/api/list/from-text",
                    json={"text": "milk, gift card, golf, iPhone charger"})
        it = self.items()
        self.assertEqual(set(it), {"milk", "gift card", "golf",
                                   "iPhone charger"})
        self.assertNotIn("not_grocery", it["milk"])
        self.assertEqual(it["gift card"]["not_grocery"], "gift cards")
        self.assertEqual(it["iPhone charger"]["not_grocery"], "electronics")

    def test_judge_runs_once_for_unknown_names_then_is_cached(self):
        self.c.post("/api/list/from-text", json={"text": "milk, putter grip, paneer"})
        r = self.c.post("/api/list/judge", json={}).json()
        self.assertEqual(r["judged"], 2)
        self.assertEqual(JudgeFake.calls, 1)
        it = self.items()
        self.assertEqual(it["putter grip"]["not_grocery"], "sports & hobbies")
        self.assertNotIn("not_grocery", it["paneer"])
        again = self.c.post("/api/list/judge", json={}).json()
        self.assertEqual(again["judged"], 0)
        self.assertEqual(JudgeFake.calls, 1)

    def test_keep_beats_the_rule_and_survives(self):
        self.c.post("/api/list/from-text", json={"text": "gift card"})
        iid = self.items()["gift card"]["item_id"]
        self.c.post("/api/list/grocery-verdict", json={"item_id": iid, "kind": "grocery"})
        self.assertNotIn("not_grocery", self.items()["gift card"])
        bad = self.c.post("/api/list/grocery-verdict", json={"item_id": iid, "kind": "x"})
        self.assertEqual(bad.status_code, 400)

    def test_analysis_splits_other_instead_of_dropping(self):
        d = (date.today() - timedelta(days=3)).isoformat()
        seed_receipt(self.c, "Costco", d,
                     [("Eggs", "2002", 5.0), ("Gift Card $25", "9001", 25.0),
                      ("Golf Balls", "9002", 30.0)], "r1")
        s = self.c.get("/api/dashboard").json()
        self.assertEqual(s["spend_total"], 60.0)
        self.assertEqual(s["spend_groceries"], 5.0)
        self.assertEqual(s["spend_other"], 55.0)
        self.assertEqual(s["other_by_kind"],
                         {"gift cards": 25.0, "sports & hobbies": 30.0})
        self.assertEqual([i["name"] for i in s["top_items"]], ["Eggs"])
