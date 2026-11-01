"""Ask Arya gaps from Tester run 1 (2026-11-01, ASK-GAPS.md): list
actions by a near list name, receipt-level facts, store-by-month spend,
the cheapest store worked out in code, and the install topic."""
import json, os, shutil, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient

from tests.test_eyes_chat import seed_demo


class AskCase(unittest.TestCase):
    def setUp(self):
        from api import deps
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        seed_demo(base)
        shutil.copytree(os.path.join(base, "users", "demo"), os.path.join(base, "users", "owner"))
        import api.main as main
        self.seen, self.answer = [], {"reply": "ok", "actions": []}
        case = self

        class FakeClient:
            def __init__(self, ledger=None):
                pass

            def chat(self, messages, mode=None, personal=None, **kw):
                case.seen.append(messages)
                return json.dumps(case.answer), {}, 0.01

        deps.MetaClient = FakeClient
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "owner", "password": "pw"})

    def ask(self, text, actions=None, **body):
        self.answer = {"reply": "", "actions": actions or []}
        r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": text}], **body})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def snap(self):
        return json.loads(self.seen[-1][1]["content"].split("\n", 1)[1])

    def rename_list(self, old, new):
        from api import state
        with state.as_user("owner"):
            ls = state._load("lists.json", None)
            for l in (ls or {}).get("lists", []):
                if l["name"] == old:
                    l["name"] = new
            state._save("lists.json", ls)

    def on_list(self, list_name):
        from api import state
        with state.as_user("owner"):
            snap = __import__("api.chat_service", fromlist=["x"]).snapshot()
        return next(l["items"] for l in snap["named_lists"] if l["name"] == list_name)


class TestListActions(AskCase):
    def test_near_list_name_adds_and_says_where(self):
        self.rename_list("Costco", "Costcozy")
        from api import state
        with state.as_user("owner"):
            self.assertEqual([l["name"] for l in state.named_lists()][0], "Costcozy")
        out = self.ask("add oat milk to my Costco list",
                       [{"type": "add_to_list", "item": "oat milk", "list": "Costco"}])
        self.assertEqual(out["skipped"], [])
        self.assertEqual(out["applied"], ["Added oat milk to Costcozy."])
        self.assertIn("oat milk", self.on_list("Costcozy"))

    def test_remove_from_a_list(self):
        self.rename_list("Costco", "Costcozy")
        self.assertIn("Jasmine Rice", self.on_list("Costcozy"))
        out = self.ask("remove rice from the Costco list",
                       [{"type": "remove_from_list", "item": "rice", "list": "Costco list"}])
        self.assertEqual(out["applied"], ["Removed Jasmine Rice from Costcozy."])
        self.assertNotIn("Jasmine Rice", self.on_list("Costcozy"))

    def test_remove_something_not_on_the_list_changes_nothing(self):
        out = self.ask("remove caviar", [{"type": "remove_from_list", "item": "caviar"}])
        self.assertEqual(out["applied"], [])
        self.assertEqual(out["skipped"], ["caviar is not on your lists."])

    def test_list_name_matching(self):
        from api import chat_service, state
        with state.as_user("owner"):
            self.assertEqual(chat_service._list_key("Trader Joe's list"), "trader joe")
            self.assertEqual(chat_service._list_for("trader joes")["name"], "Trader Joe's")
            self.assertEqual(chat_service._list_for("COSTCO")["name"], "Costco")
            self.assertEqual(chat_service._list_for("costko")["name"], "Costco")
            self.assertIsNone(chat_service._list_for("Indian Store"))


class TestAmbiguousListNames(AskCase):
    """Tester on #384: two lists that fit must ask before any change."""

    def setUp(self):
        super().setUp()
        self.rename_list("Costco", "Costcozy")
        from api import state
        with state.as_user("owner"):
            ls = state._load("lists.json", None)
            extra = dict(ls["lists"][0], id="costco-run", name="Costco Run")
            ls["lists"].append(extra)
            state._save("lists.json", ls)

    def flags(self):
        from api import state
        with state.as_user("owner"):
            return state.flags()

    def test_ambiguous_add_asks_first_and_adds_nothing(self):
        before = self.flags()
        out = self.ask("add oat milk to Costco", [{"type": "add_to_list", "item": "oat milk", "list": "Costco"}])
        self.assertEqual(out["applied"], [])
        self.assertEqual(out["added"], [])
        self.assertEqual(out["skipped"], ["More than one list fits Costco: Costcozy or Costco Run. Which one?"])
        self.assertEqual(self.flags(), before)

    def test_ambiguous_remove_asks_which(self):
        out = self.ask("remove rice from Costco", [{"type": "remove_from_list", "item": "rice", "list": "Costco"}])
        self.assertEqual(out["applied"], [])
        self.assertEqual(out["skipped"], ["More than one list fits Costco: Costcozy or Costco Run. Which one?"])
        self.assertIn("Jasmine Rice", self.on_list("Costcozy"))

    def test_a_full_name_still_picks_one(self):
        out = self.ask("add oat milk to Costco Run",
                       [{"type": "add_to_list", "item": "oat milk", "list": "costco run"}])
        self.assertEqual(out["applied"], ["Added oat milk to Costco Run."])

    def test_one_letter_is_not_a_list_name(self):
        from api import chat_service, state
        with state.as_user("owner"):
            self.assertEqual(chat_service._list_matches("c"), [])
            self.assertEqual(chat_service._list_matches("co"), [])
        out = self.ask("add eggs to c", [{"type": "add_to_list", "item": "eggs", "list": "c"}])
        self.assertEqual(out["skipped"], ["You have no list called c, so eggs went to Everything else."])


class TestReceiptFacts(AskCase):
    def test_counts_last_biggest_and_trips_per_store(self):
        self.ask("how many receipts do I have?")
        r = self.snap()["receipts"]
        self.assertEqual(r["count"], 39)
        self.assertEqual({s: v["receipts"] for s, v in r["by_store"].items()},
                         {"Trader Joe's": 18, "Safeway": 9, "Costco": 12})
        self.assertEqual(round(sum(v["spend"] for v in r["by_store"].values()), 2), 1103.12)
        self.assertEqual(r["last"], r["recent"][0])
        self.assertGreaterEqual(r["biggest"]["amount"], max(x["amount"] for x in r["recent"]))
        self.assertTrue(r["last"]["top_lines"])

    def test_store_by_month_matches_spending(self):
        self.ask("Trader Joe's vs Safeway last month")
        s = self.snap()
        sbm = s["spend_by_store_month"]
        for store, total in s["spend_by_store"].items():
            self.assertAlmostEqual(sum(sbm[store].values()), total, places=2)
        month = "2026-10"
        self.assertAlmostEqual(sum(m.get(month, 0) for m in sbm.values()), s["spend_by_month"][month], places=2)


class TestCheapest(unittest.TestCase):
    def test_lowest_of_three_stores(self):
        from api import prices
        c = prices.cheapest_store({"A": {"price": 5.0, "date": "2026-10-01"},
                                   "B": {"price": 4.4, "date": "2026-10-20"},
                                   "C": {"price": 4.1, "date": "2026-09-01"}})
        self.assertEqual((c["store"], c["price"], c["of_stores"]), ("C", 4.1, 3))

    def test_one_store_or_stale_prices_name_no_cheapest(self):
        from api import prices
        self.assertIsNone(prices.cheapest_store({"A": {"price": 5.0, "date": "2026-10-01"}}))
        c = prices.cheapest_store({"A": {"price": 5.0, "date": "2026-10-01"},
                                   "B": {"price": 4.4, "date": "2026-10-20"},
                                   "Old": {"price": 1.0, "date": "2024-01-01"}})
        self.assertEqual(c["store"], "B")


class TestKnowledge(unittest.TestCase):
    def test_install_question_finds_the_install_steps(self):
        from api import chat_service
        for q in ("How do I install Arya on my phone?", "is there an app store app",
                  "add arya to my home screen"):
            self.assertIn("Add to Home Screen", chat_service.feature_sheet({}, question=q), q)

    def test_budget_question_finds_the_trip_budget(self):
        from api import chat_service
        self.assertIn("Budget for this trip", chat_service.feature_sheet({}, question="what is my budget"))

    def test_prompt_allows_cooking_and_list_removal(self):
        from api import chat_service
        p = open(chat_service.PROMPT_PATH).read()
        self.assertIn("remove_from_list", p)
        self.assertIn("cooking", p)
        self.assertNotIn("cooking steps", p)


if __name__ == "__main__":
    unittest.main()
