"""QA signed-in pass 2026-10-28: Receipts Back, lapsed staples,
sentence-as-item, archive display, badge copy."""
import os, unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name)) as f:
        return f.read()


class TestSignedIn(unittest.TestCase):
    def test_receipts_back_works_from_profile(self):
        js = read("app.js")
        body = js.split('$("#rc-back")')[1].split("\n\n")[0]
        self.assertIn("if (tab) tab.click(); else", body)

    def test_archive_dates_carry_the_year(self):
        body = read("app.js").split("function fmtShort(")[1].split("\n}")[0]
        self.assertIn("getFullYear()", body)

    def test_analysis_months_fill_gaps(self):
        self.assertIn("Months with no receipts still get a row", read("app.js"))

    def test_sentence_is_split_into_quest_items(self):
        from api import quest
        items = quest.make_items(["I need some eggs, eggs, bananas, cookies, oranges."])
        self.assertEqual([i["name"].lower() for i in items],
                         ["eggs", "bananas", "cookies", "oranges"])

    def test_single_item_with_no_comma_is_untouched(self):
        from api import quest
        items = quest.make_items([{"name": "mac and cheese", "qty": 2}])
        self.assertEqual([(i["name"], i["qty"]) for i in items],
                         [("mac and cheese", 2)])

    def test_lapsed_staple_is_not_admitted(self):
        from api import state
        p = {"item_id": "x", "history_state": "lapsed"}
        judged = {"x": {"list_ok": True, "class": "STAPLE"}}
        self.assertFalse(state._admitted(p, judged, {}))
        self.assertTrue(state._admitted(p, judged, {"x": {"manual": True}}))
        p["history_state"] = "pattern"
        self.assertTrue(state._admitted(p, judged, {}))

    def test_badges_say_a_receipt_is_needed(self):
        from api import social
        crit = {b["id"]: b["criteria"] for b in social.BADGES}
        self.assertIn("receipt attached", crit["clean_sweep"])
        self.assertIn("receipt attached", crit["speed_demon"])
