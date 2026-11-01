"""To check smart pass (clean.suggest_review): Arya proposes a clean name
for each unsure receipt line before asking; proposals never change a
line until the household taps them."""
import json, os, tempfile, unittest

from api import state
from api.dictionary import clean
from tests.test_clean_names import FakeClient

ANSWERS = {
    "ORG YELLOW": {"product": "Yellow Onions", "details": ["Organic"], "section": "produce",
                   "confidence": 0.7},
    "DFMBLLRNFLAT": {"product": "Flat Sheet", "details": [], "section": "household",
                     "confidence": 0.4},
}


def receipt(rid, lines):
    return {"receipt_id": rid, "source_type": "grocery", "merchant": "Costco Newark",
            "purchased_at": "2026-10-01", "subtotal": 0, "total": 0, "tax": 0,
            "totals_reconcile": True,
            "lines": [{"raw": raw, "decoded_name": raw, "sku": sku, "qty": 1, "unit_price": amt,
                       "line_total": amt, "line_type": "item", "confidence": 0.5,
                       "status": "unverified"} for sku, raw, amt in lines]}


class TestSmartPass(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        state.set_current_user("owner")
        state.add_receipts([
            receipt("r1", [("983220", "ORG YELLOW", 8.99), ("1776945", "DFMBLLRNFLAT", 35.98),
                           ("41400", "U/S QTRS", 53.96), ("777", "ZZQX", 3.00)]),
            receipt("r2", [("983220", "ORG YELLOW", 8.99)])])
        state._save("dictionary.json", {"entries": [
            {"item_id": "costco-41400", "sku": "41400", "canonical_name": "Butter - Unsalted",
             "kind": "product", "aliases": [], "section_guess": "dairy & eggs",
             "resolution": {"status": "manual", "candidates": []}}]})

    def tearDown(self):
        state.set_current_user(None)

    def lines(self):
        return {(l["receipt_id"], l["sku"]): l for l in state.review_queue()["lines"]}

    def test_suggests_every_line_of_an_item_and_keeps_it_unverified(self):
        totals = json.dumps([[ln["line_total"] for ln in r["lines"]] for r in state.receipts()])
        fc = FakeClient(ANSWERS)
        self.assertEqual(clean.suggest_review(fc), 3)
        q = self.lines()
        for rid in ("r1", "r2"):
            s = q[(rid, "983220")]["suggested"]
            self.assertEqual(s, {"name": "Yellow Onions - Organic", "section": "produce",
                                 "confidence": 0.7, "by": "arya"})
        self.assertEqual(q[("r1", "1776945")]["suggested"]["name"], "Flat Sheet")
        # nothing settled on its own; prices untouched
        self.assertEqual(len(q), 5)
        self.assertEqual(json.dumps([[ln["line_total"] for ln in r["lines"]] for r in state.receipts()]), totals)

    def test_learned_name_needs_no_call(self):
        fc = FakeClient({})
        clean.suggest_review(fc)
        s = self.lines()[("r1", "41400")]["suggested"]
        self.assertEqual((s["name"], s["confidence"], s["section"]), ("Butter - Unsalted", 1.0, "dairy & eggs"))

    def test_unreadable_is_not_asked_twice(self):
        fc = FakeClient(ANSWERS)
        clean.suggest_review(fc)
        first = fc.calls
        self.assertTrue(self.lines()[("r1", "777")]["suggest_tried"])
        self.assertIsNone(self.lines()[("r1", "777")]["suggested"])
        self.assertEqual(clean.suggest_review(fc), 0)
        self.assertEqual(fc.calls, first)

    def test_no_key_still_offers_learned_names(self):
        self.assertEqual(clean.suggest_review(None), 1)
        self.assertNotIn("suggest_tried", json.dumps(state.receipts()))

    def test_accept_keeps_section(self):
        clean.save_section("983220", "costco-983220", "produce")  # no entry yet: nothing to do
        state.teach_name("983220", "Yellow Onions - Organic")
        clean.save_section("983220", "costco-983220", "produce")
        clean.save_section("983220", "costco-983220", "not a section")
        e = next(e for e in state.dictionary()["entries"] if e["sku"] == "983220")
        self.assertEqual(e["section_guess"], "produce")


class TestSmartPassRoutes(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ.pop("MODEL_API_KEY", None)
        from fastapi.testclient import TestClient
        from api.main import app
        from tests.test_list_review import seed_owner
        self.c = TestClient(app)
        seed_owner(self.c)
        state.set_current_user("owner")
        state.add_receipts([receipt("r9", [("41400", "U/S QTRS", 53.96)])])
        state.learn_item_name("costco-41400", "Butter - Unsalted", sku="41400")
        state.set_current_user(None)

    def test_smart_pass_then_one_tap_accept(self):
        self.assertEqual(self.c.post("/api/review/smart-pass", json={}).json(), {"suggested": 1})
        line = next(l for l in self.c.get("/api/review").json()["lines"] if l["sku"] == "41400")
        self.assertEqual(line["suggested"]["by"], "arya")
        r = self.c.post("/api/review/line", json={"receipt_id": line["receipt_id"], "idx": line["idx"],
                                                  "action": "rename", "name": line["suggested"]["name"],
                                                  "section": "dairy & eggs"}).json()
        self.assertTrue(r["ok"])
        self.assertFalse([l for l in self.c.get("/api/review").json()["lines"] if l["sku"] == "41400"])
        state.set_current_user("owner")
        e = next(e for e in state.dictionary()["entries"] if e.get("sku") == "41400")
        state.set_current_user(None)
        self.assertEqual(e["section_guess"], "dairy & eggs")


if __name__ == "__main__":
    unittest.main()
