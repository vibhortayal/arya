"""Clean receipt names (api/dictionary/clean.py): printed text becomes a
list name in the name book; receipts, totals and grouping stay put."""
import json, os, tempfile, unittest

from api import state
from api.dictionary import clean


class FakeClient:
    api_key = "test-key"

    def __init__(self, answers):
        self.answers, self.calls = answers, 0

    def chat(self, messages, **kw):
        self.calls += 1
        listing = messages[-1]["content"].splitlines()
        out = []
        for line in listing:
            n = int(line[1:line.index("]")])
            printed = line[line.index("]") + 1:].split("|")[0].strip()
            if printed in self.answers:
                out.append(dict(self.answers[printed], n=n))
        return json.dumps({"names": out}), {}, 0.0


ANSWERS = {
    "ORG BLACKBRY": {"product": "Blackberries", "details": ["Organic"], "confidence": 0.95},
    "KS ALMD BTR": {"product": "Almond Butter", "details": [], "brand": "Kirkland Signature",
                    "confidence": 0.9},
    "BL SHT 3PC": {"product": "Sheet Set", "details": ["Blue"], "size": "3 Piece",
                   "confidence": 0.5, "alternatives": ["Bath Sheet - 3 Pack"]},
}


def receipt(rid, date, lines):
    return {"receipt_id": rid, "source_type": "grocery", "merchant": "Costco Fremont",
            "purchased_at": date, "subtotal": sum(l[2] for l in lines),
            "total": sum(l[2] for l in lines), "tax": 0, "totals_reconcile": True,
            "lines": [{"raw": raw, "decoded_name": raw, "sku": sku, "qty": 1,
                       "unit_price": amt, "line_total": amt, "line_type": "item",
                       "confidence": 0.9, "status": "auto"} for sku, raw, amt in lines]}


class TestCleanNames(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        state.set_current_user("owner")
        state.add_receipts([
            receipt("r1", "2026-09-01", [("111", "ORG BLACKBRY", 5.99), ("222", "KS ALMD BTR", 9.99),
                                         ("333", "BL SHT 3PC", 39.99), ("444", "Bananas", 1.99)]),
            receipt("r2", "2026-10-01", [("111", "ORG BLACKBRY", 6.49)])])
        # One item the household already named stays theirs.
        state._save("dictionary.json", {"entries": [
            {"item_id": "costco-222", "sku": "222", "canonical_name": "KS ALMD BTR", "kind": "product",
             "aliases": ["KS ALMD BTR"], "resolution": {"status": "auto", "candidates": []}},
            {"item_id": "costco-555", "sku": "555", "canonical_name": "My Oat Milk", "kind": "product",
             "aliases": ["OAT BEV"], "resolution": {"status": "manual", "candidates": []}}]})

    def tearDown(self):
        state.set_current_user(None)

    def test_compose(self):
        self.assertEqual(clean.compose("Blackberries", ["Organic"]), "Blackberries - Organic")
        self.assertEqual(clean.compose("Almond Butter", [], "Kirkland Signature"),
                         "Almond Butter - Kirkland Signature")
        self.assertEqual(clean.compose("Milk", ["Milk"]), "Milk")

    def test_candidates_skip_readable_and_manual(self):
        ids = {c["item_id"] for c in clean.candidates()}
        self.assertEqual(ids, {"costco-111", "costco-222", "costco-333"})

    def test_dry_run_writes_nothing(self):
        before = json.dumps(state.dictionary(), sort_keys=True)
        p = clean.plan(FakeClient(ANSWERS))
        self.assertEqual(json.dumps(state.dictionary(), sort_keys=True), before)
        after = {c["item_id"]: c for c in p["changes"]}
        self.assertEqual(after["costco-111"]["after"], "Blackberries - Organic")
        self.assertTrue(after["costco-333"]["check"])
        self.assertIn("Would rename: 2", clean.summary(p))

    def test_apply_names_everywhere_and_keeps_receipts(self):
        receipts_before = json.dumps(state.receipts(), sort_keys=True)
        res = clean.apply(clean.plan(FakeClient(ANSWERS)))
        self.assertEqual(res, {"renamed": 2, "to_check": 1})
        self.assertEqual(json.dumps(state.receipts(), sort_keys=True), receipts_before)
        nm = state.names()
        self.assertEqual(nm["costco-111"], "Blackberries - Organic")
        self.assertEqual(nm["costco-222"], "Almond Butter - Kirkland Signature")
        self.assertEqual(nm["costco-555"], "My Oat Milk")
        # unsure: asked in To check, with the guess as a one-tap answer
        q = {u["item_id"]: u for u in state.review_queue()["unresolved"]}
        self.assertEqual(q["costco-333"]["candidates"][0], "Sheet Set - Blue, 3 Piece")
        # the printed text still finds the item
        e = next(e for e in state.dictionary()["entries"] if e["item_id"] == "costco-111")
        self.assertIn("ORG BLACKBRY", e["aliases"])
        self.assertTrue(clean.is_on())

    def test_rename_never_merges_items(self):
        two = {"ORG BLACKBRY": ANSWERS["ORG BLACKBRY"],
               "KS ALMD BTR": dict(ANSWERS["ORG BLACKBRY"])}
        clean.apply(clean.plan(FakeClient(two)))
        gm = state.group_map()
        self.assertNotEqual(gm.get("costco-111", "costco-111"), gm.get("costco-222", "costco-222"))

    def test_second_run_asks_nothing_and_new_items_reuse(self):
        clean.apply(clean.plan(FakeClient(ANSWERS)))
        fc = FakeClient(ANSWERS)
        self.assertEqual(clean.clean_new(fc), 0)
        self.assertEqual(fc.calls, 0)
        state.add_receipts([receipt("r3", "2026-10-20", [("111", "ORG BLACKBRY", 6.49),
                                                         ("666", "ORG BLACKBRY", 6.49)])])
        self.assertEqual(clean.clean_new(fc), 1)  # only the new item number is asked
        self.assertEqual(state.names()["costco-666"], "Blackberries - Organic")

    def test_off_until_applied(self):
        fc = FakeClient(ANSWERS)
        self.assertEqual(clean.clean_new(fc), 0)
        self.assertEqual(fc.calls, 0)

    def test_undo_puts_names_back_but_keeps_household_picks(self):
        before = {e["item_id"]: e["canonical_name"] for e in state.dictionary()["entries"]}
        clean.apply(clean.plan(FakeClient(ANSWERS)))
        state.resolve_dictionary("costco-333", "Bath Sheets")
        res = clean.undo()
        self.assertEqual(res, {"restored": 2, "kept_by_you": 1})
        nm = state.names()
        self.assertEqual(nm["costco-222"], before["costco-222"])
        self.assertEqual(nm["costco-111"], "ORG BLACKBRY")  # entry the pass made is gone again
        self.assertNotIn("costco-111", {e["item_id"] for e in state.dictionary()["entries"]})
        self.assertEqual(nm["costco-333"], "Bath Sheets")
        self.assertFalse(clean.is_on())
        self.assertNotIn("group", next(e for e in state.dictionary()["entries"]
                                       if e["item_id"] == "costco-222"))


if __name__ == "__main__":
    unittest.main()
