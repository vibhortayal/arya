"""List first, Quest second (owner, 2026-10-29: "Think of our app as Waze
for grocery shopping. Quest is the pokemon go part of our app. we should
not make quest as the hero"). Today is the shopping dashboard; the game
lives on its own Quest tab."""
import json
import subprocess
import unittest
from pathlib import Path

PWA = Path(__file__).resolve().parent.parent / "pwa"


def read(name):
    return (PWA / name).read_text(encoding="utf-8")


def fn(src, name):
    body = src.split(f"function {name}(")[1]
    return f"function {name}(" + body[:body.index("\n}\n") + 2]


class TestTodayIsTheShoppingDashboard(unittest.TestCase):
    def test_today_sections_in_order(self):
        home = read("index.html").split('id="view-home"')[1].split("</section>")[0]
        order = ["today-low", "today-alerts", "today-expiry", "today-checks",
                 "today-lists", "today-patterns", "today-quest"]
        at = [home.index(f'id="{el}"') for el in order]
        self.assertEqual(at, sorted(at))

    def test_still_good_checks_left_the_list(self):
        js = read("app.js")
        self.assertIn("data-check-ok", fn(js, "paintTodayChecks"))
        # The List overhaul removed the List's notes block altogether.
        self.assertNotIn("function paintListNotes", js)

    def test_patterns_back_returns_to_today(self):
        js = read("app.js")
        self.assertIn('analysisFrom = "view-home"', js)
        self.assertIn("const to = analysisFrom;", js)


class TestStoreAlerts(unittest.TestCase):
    def run_rows(self, h, news):
        js = read("app.js")
        src = ("function esc(s){return String(s)}function fmtShort(s){return s}"
               "function money(n){return '$'+n.toFixed(2)}" + fn(js, "storeAlertRows") +
               f";console.log(JSON.stringify(storeAlertRows({json.dumps(h)},{json.dumps(news)})))")
        out = subprocess.run(["node", "-e", src], capture_output=True, text=True, check=True)
        return json.loads(out.stdout)

    def test_report_marks_an_item_on_your_list(self):
        h = {"list": {"items": [{"item_id": "e", "name": "Eggs", "checked": False, "on_list": True}]}, "price_by_store": {}}
        rows = self.run_rows(h, [{"store": "Costco", "item": "eggs", "count": 2, "reported_at": "2026-10-28T10:00"}])
        self.assertEqual(len(rows), 1)
        self.assertIn("Costco: eggs not there", rows[0])
        self.assertIn("2 reports", rows[0])
        self.assertIn("on your list", rows[0])

    def test_price_row_needs_two_stores_and_a_real_gap(self):
        items = [{"item_id": "m", "name": "Milk"}, {"item_id": "b", "name": "Bread"}]
        h = {"list": {"items": items}, "price_by_store": {
            "m": {"Costco": {"median": 4.29}, "Trader Joe's": {"median": 4.79}},
            "b": {"Costco": {"median": 3.0}}}}
        rows = self.run_rows(h, [])
        self.assertEqual(len(rows), 1)
        self.assertIn("Milk: $4.29 at Costco", rows[0])
        self.assertIn("$4.79 at Trader Joe's", rows[0])
        h["price_by_store"]["m"]["Trader Joe's"]["median"] = 4.39  # 10 cents: not news
        self.assertEqual(self.run_rows(h, []), [])

    def test_empty_alerts_show_a_labelled_sample(self):
        body = read("app.js").split("async function paintStoreAlerts")[1].split("\n}\n")[0]
        self.assertIn("samplepill", body)
        self.assertIn("Example only", body)


class TestQuestTab(unittest.TestCase):
    def test_quest_tab_holds_the_game(self):
        quest = read("index.html").split('id="view-community"')[1].split("</section>")[0]
        for el in ("today-level", "today-hero", "btn-new-hunt", "quest-sessions",
                   "btn-map-store", "crew-summary", "comm-board", "comm-badges"):
            self.assertIn(f'id="{el}"', quest)
        self.assertNotIn('id="comm-news"', quest)  # store news is on Today now

    def test_back_from_a_hunt_lands_on_quest(self):
        q = read("quest.js")
        self.assertIn('const to = prev || "view-community";', q)
        self.assertIn('Q.stack = ["view-community"];', q)

    def test_landing_leads_with_the_list(self):
        login = read("index.html").split('id="view-login"')[1].split('id="signin-sheet"')[0]
        for tag in ("Running low", "Store alert", "Use soon"):
            self.assertIn(tag, login)
        self.assertLess(login.index("Groceries"), login.index("treasure hunt"))


if __name__ == "__main__":
    unittest.main()
