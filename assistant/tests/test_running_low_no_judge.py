"""Running low without judge verdicts; intake warns on lines with no sku.

No model key, or a failed judge call, used to leave Today, List and Ask
empty. An unjudged item with an unmistakable rhythm now counts; a
verdict, once it exists, wins. A structured receipt line with no sku is
saved but never counted, and the response says so.
"""
import os, tempfile, unittest
from datetime import date, timedelta

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = ""
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient  # noqa: E402

from tests.test_list_pass import FakeClient, seed_receipt  # noqa: E402


class TestNoJudge(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.state = state
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
        self.today = date.today()

    def buy(self, name, sku, days_ago, tag):
        seed_receipt(self.c, "Costco", (self.today - timedelta(days=days_ago)).isoformat(),
                     [(name, sku, 5.0)], f"{tag}-{days_ago}")

    def as_user(self, f, *a):
        self.state.set_current_user("t@x.y")
        try:
            return f(*a)
        finally:
            self.state.set_current_user(None)

    def low(self):
        return [i["name"] for i in self.c.get("/api/home").json()["running_low"]]

    def ask_low(self):
        from api import chat_service
        return self.as_user(lambda: chat_service.snapshot()["running_low"])

    def name(self, sku, nm):
        self.as_user(self.state._save, "dictionary.json", {"entries": [
            {"item_id": f"costco-{k}", "sku": k, "canonical_name": v, "aliases": []}
            for k, v in nm.items()]})

    def test_steady_rhythm_counts_without_a_verdict(self):
        # Days are counted from today (QA 2026-10-28), and an item silent
        # for far longer than its rhythm is "lapsed", not due. So the last
        # buy is one rhythm (14 days) ago: due now.
        for d in (56, 42, 28, 14):
            self.buy("Eggs", "2002", d, "e")
        self.name("2002", {"2002": "Eggs"})
        self.assertEqual(self.low(), ["Eggs"])
        self.assertEqual(self.ask_low(), ["Eggs"])
        self.assertIn("costco-2002", [i["item_id"] for i in
                      self.c.get("/api/home").json()["list"]["items"]])

    def test_three_buys_or_a_ragged_rhythm_stay_off(self):
        for d in (60, 46, 32):
            self.buy("Tahini", "3001", d, "t")
        for d in (90, 83, 53, 20):  # gaps 7, 30, 33: spread > 2
            self.buy("Cookies", "4001", d, "c")
        self.name("x", {"3001": "Tahini", "4001": "Cookies"})
        self.assertEqual(self.low(), [])

    def test_a_no_verdict_overrides_the_fallback(self):
        for d in (80, 66, 52, 38):
            self.buy("Eggs", "2002", d, "e")
        self.name("2002", {"2002": "Eggs"})
        self.as_user(self.state._save, "judged.json",
                     {"costco-2002": {"list_ok": False, "class": "NOT_STAPLE", "buys": 4}})
        self.assertEqual(self.low(), [])
        self.assertEqual(self.ask_low(), [])

    def test_intake_warns_about_lines_with_no_sku(self):
        body = {"merchant": "Corner Shop", "purchased_at": self.today.isoformat(),
                "receipt_id": "ns1", "subtotal": 9.0, "tax": 0, "total": 9.0,
                "lines": [{"decoded_name": "Bread", "sku": "9001", "line_total": 4.0, "qty": 1, "confidence": 0.95},
                          {"decoded_name": "Loose Apples", "line_total": 5.0, "qty": 1, "confidence": 0.95}]}
        r = self.c.post("/api/intake/structured", json=body)
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual(d["no_sku"], ["Loose Apples"])
        self.assertIn("1 line(s) have no sku", d["warning"])

    def test_intake_with_every_sku_has_no_warning(self):
        body = {"merchant": "Costco", "purchased_at": self.today.isoformat(),
                "receipt_id": "ok1", "subtotal": 4.0, "tax": 0, "total": 4.0,
                "lines": [{"decoded_name": "Bread", "sku": "9001", "line_total": 4.0, "qty": 1, "confidence": 0.95}]}
        d = self.c.post("/api/intake/structured", json=body).json()
        self.assertNotIn("warning", d)
        self.assertNotIn("no_sku", d)
