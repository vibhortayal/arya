"""List first, Quest second (owner, 2026-10-29: "Think of our app as Waze
for grocery shopping. Quest is the pokemon go part of our app. we should
not make quest as the hero"). Today is the shopping dashboard; the game
lives on its own Quest tab.

Pins over the React screens (web/src). The Store alerts rows that the
old node harness ran (app.js storeAlertRows) run under vitest in
web/src/screens/today.test.ts against Today.tsx storeAlerts."""
import unittest

from tests.frontend import src


def today():
    return src("screens/Today.tsx")


def markup(js):
    """A screen's JSX: its last `return (` on."""
    return js[js.rindex("\n  return (\n"):]


class TestTodayIsTheShoppingDashboard(unittest.TestCase):
    def test_today_sections_in_order(self):
        home = today()
        home = home[home.index("export function Today() {"):]
        home = markup(home[:home.index("\n}\n")])
        # Design pass (2026-10-29): Your lists moved up under Running low;
        # the tip folded to one line at the foot. Customizable Today
        # (2026-10-30): this is the default order of the cards, which
        # the person can change (screens/todayCards.ts).
        body = today()
        body = body[body.index("export function Today() {"):]
        order = ["today-low", "today-lists", "today-alerts", "today-cheaper", "today-expiry",
                 "today-checks", "today-patterns", "today-tip", "today-quest"]
        at = [body.index(f'id="{el}"') if el not in ("today-alerts", "today-cheaper")
              else body.index(f'"{el}"') for el in order]
        self.assertEqual(at, sorted(at))
        self.assertIn('"low", "lists", "report", "price", "expiry", "checks", "patterns", "quest"',
                      src("screens/todayCards.ts"))
        self.assertIn("on.map(id =>", home)

    def test_today_extras_fold_to_one_line(self):
        js = today()
        checks = js.split('<div id="today-checks">')[1].split('<div id="today-eye">')[0]
        self.assertIn("data-checks-fold", checks)
        self.assertIn("to check", checks)
        self.assertIn('<div className="tipline">', js)
        self.assertNotIn("tipcard", js)

    def test_still_good_checks_left_the_list(self):
        self.assertIn("data-check-ok", today())
        # The List overhaul removed the List's notes block altogether.
        self.assertNotIn("data-check-ok", src("screens/Lists.tsx"))

    def test_still_good_has_i_finished_it(self):
        # Owner, 2026-11-01: a third answer, "I finished it": used up,
        # not waste. It is Arya's "I'm out" flag (back on the list) with
        # Undo, and the three answers share one row (.checkchips).
        js = today()
        self.assertIn("data-check-finished", js)
        self.assertIn("{ out: isoToday() }", js)
        self.assertIn("{ out: null }", js)
        self.assertIn("checkchips", js)
        self.assertNotIn('check("finished", c.item_id)}>{t("today.itExpired")', js)

    def test_patterns_back_returns_to_today(self):
        self.assertIn('nav.show("analysis", { from: "home" })', today())
        # Back is the nav stack: it pops to whoever opened Patterns.
        self.assertIn('id="an-back" onClick={ev => { ev.preventDefault(); nav.back(', src("screens/Analysis.tsx"))


class TestStoreAlerts(unittest.TestCase):
    def test_rows_come_from_one_pure_function(self):
        js = today()
        self.assertIn("export function storeAlerts(", js)
        self.assertIn("const alertRows = h && news ? storeAlerts(h, news, currency) : [];", js)
        self.assertIn('if (hi[1].median - lo[1].median < 0.25) continue;', js)
        t = src("screens/today.test.ts")
        for name in ("a report marks an item on your list", "a price row needs two stores and a real gap",
                     "three reports at most, four rows at most"):
            self.assertIn(name, t)

    def test_empty_alerts_hide_the_section(self):
        js = today()
        self.assertNotIn("samplepill", js)
        self.assertNotIn("Example only", js)
        # Reports and price tips have their own headings (labels audit).
        self.assertIn('alertSection("report", "today-alerts", "Store alerts")', js)
        self.assertIn('alertSection("price", "today-cheaper", "Cheaper elsewhere")', js)
        self.assertIn('{rows.length > 0 && <><h3 className="sect">{t(head)}</h3>', js)


class TestNewUserSeesNoEmptyNoise(unittest.TestCase):
    """New-user sweep (owner approved 2026-10-29): empty cards stay hidden."""
    def test_today_hides_empty_cards(self):
        js = today()
        self.assertNotIn("Nothing is running low", js)
        self.assertIn("{low.length > 0 && (", js)
        self.assertIn('id="today-lists-row" hidden={!h || noLists}', js)
        # Tiles only for lists with items; empty ones fold into one row
        # (relevant cards, owner 2026-10-30).
        self.assertIn("{h && !noLists && cards.length > 0 && (", js)
        self.assertIn('id="today-emptylists"', js)

    def test_quest_tab_hides_empty_blocks(self):
        q = src("screens/Quest.tsx")
        self.assertNotIn("No hunts yet today", q)
        self.assertIn('id="games-head" hidden={!openS.length && !done.length}', q)
        self.assertNotIn("Hunting is better with company", q)

    def test_quest_progress_hides_zero_tiles_and_has_one_shelf(self):
        prog = src("screens/QuestProgress.tsx")
        self.assertEqual(prog.count('id="pf-badges"'), 1)
        self.assertEqual(prog.count('id="pf-stores"'), 1)
        self.assertIn('id="pf-stats" className="stattiles" hidden={!active}', prog)
        self.assertIn('id="pf-spots" className="group" hidden={!showSpots}', prog)

    def test_analysis_is_one_line_until_a_receipt(self):
        an = src("screens/Analysis.tsx")
        self.assertIn('id="an-none" hidden={show}', an)
        # ...and that line comes with the button that does it.
        self.assertIn('id="an-add"', an)
        self.assertIn('id="an-data" hidden={!show}', an)

    def test_info_and_lock_are_icons(self):
        self.assertIn('<svg className="infoic"', src("ui/Info.tsx"))
        pw = src("screens/Powers.tsx")
        self.assertIn('<svg className="pwlock"', pw)
        self.assertIn("You need to opt in first", pw)
        self.assertNotIn("Tap i to", today())
        self.assertNotIn("Tap i to", pw)


class TestReceiptsEyeHidesWhenEmpty(unittest.TestCase):
    def test_needs_your_eye_shows_only_when_something_needs_it(self):
        # The review queue moved to its own screen, To check (Receipts
        # keeps one summary row): the groups show only when there is
        # something to check, and an all-clear line otherwise.
        js = src("screens/ToCheck.tsx")
        self.assertIn('loaded && !hasReview && !hasCur', js)
        self.assertIn('id="review" className="group eyegroup" hidden={!hasReview}', js)
        self.assertIn('id="curator" hidden={!hasCur}', js)
        self.assertNotIn("Every line is verified", js)
        self.assertNotIn("Every line is verified", src("screens/Receipts.tsx"))


class TestQuestTab(unittest.TestCase):
    def test_quest_tab_holds_the_game(self):
        quest = src("screens/Quest.tsx")
        # History only (usability audit, owner-approved 2026-10-29).
        for el in ("today-hero", "quest-sessions"):
            self.assertIn(f'id="{el}"', quest)
        for el in ("today-level", "btn-new-hunt", "btn-map-store", "crew-summary", "comm-board", "comm-fastest"):
            self.assertNotIn(f'id="{el}"', quest)
        self.assertNotIn('id="comm-badges"', quest)  # badges live in Quest progress
        self.assertNotIn('id="comm-news"', quest)  # store news is on Today now

    def test_back_from_a_hunt_lands_on_quest(self):
        self.assertIn('nav.reset(sess.mode === "express" ? "express" : "hunt", { session: sess }, "community");',
                      src("screens/Mode.tsx"))
        self.assertIn('nav.back("community")', src("screens/Hunt.tsx"))
        self.assertIn("reset drops the set-up screens: Back from a new hunt lands on the Quest tab",
                      src("app/nav.test.tsx"))

    def test_landing_leads_with_the_list(self):
        # B1 flip cards (owner, 2026-10-29): the list card comes first,
        # the eight guide sections follow (#219), no Quest card.
        login = src("screens/Login.tsx")
        self.assertLess(login.index('id: "lists"'), login.index('id: "share"'))
        self.assertNotIn('id: "quest"', login)
        self.assertIn("Your grocery run, <em>smarter.</em>", login)


if __name__ == "__main__":
    unittest.main()
