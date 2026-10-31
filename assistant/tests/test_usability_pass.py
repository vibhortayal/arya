"""Usability pass (owner-approved audit v2, 2026-10-29): frustration
points 11-14 and keep-or-cut 7-11. Each test pins one decision."""
import os
import unittest

from tests.frontend import src, src_raw

CSS = os.path.join(os.path.dirname(__file__), "..", "web", "src", "styles", "styles.css")


class TestMapper(unittest.TestCase):
    def test_back_row_clears_the_status_bar(self):
        self.assertIn('<p className="backrow"><a href="#" className="qback"', src_raw("screens/Mapper.tsx"))
        with open(CSS, encoding="utf-8") as f:
            css = f.read()
        self.assertIn(".backrow { padding-top: env(safe-area-inset-top);", css)

    def test_store_first_then_one_start_button(self):
        m = src("screens/Mapper.tsx")
        self.assertLess(m.index('id="mp-stores"'), m.index('id="mp-walkstart"'))
        self.assertLess(m.index('id="mp-walkstart"'), m.index('id="mp-cover"'))
        self.assertIn(">Start mapping {{store}}</button>", m)
        # Illustration and long text wait behind How it works.
        how = m.split('id="mp-how"')[1].split("</details>")[0]
        self.assertIn("How it works", how)
        self.assertIn('className="mapperhero"', how)
        # Add an aisle by hand folds under More.
        more = m.split('id="mp-more"')[1].split("</details>")[0]
        self.assertIn("<summary>More</summary>", more)
        self.assertIn('id="mp-add"', more)


class TestSettingsHelp(unittest.TestCase):
    def test_one_help_row_and_powers(self):
        # Settings has no Help row any more (owner, 2026-10-31): the Help tab
        # holds the guide, the tour and feedback; Powers sits on About Arya.
        p = src("screens/Profile.tsx")
        self.assertNotIn('id="btn-guide"', p)
        self.assertNotIn('id="btn-feedback"', p)
        self.assertNotIn('id="btn-tour"', p)
        self.assertNotIn('id="btn-quest-progress"', p)
        self.assertIn('"btn-powers"', src("screens/About.tsx"))
        self.assertIn('id="help-guide"', src("screens/Help.tsx"))

    def test_tour_replays_from_the_guide(self):
        g = src_raw("ui/Guide.tsx")
        self.assertIn('id="gd-tour"', g)
        self.assertIn("tour.startTour(tourSteps)", g)

    def test_quest_progress_lives_in_quest(self):
        q = src_raw("screens/quest/QuestMode.tsx")
        self.assertIn('id="qm-progress"', q)
        self.assertIn('nav.show("quest-progress")', q)

    def test_one_avatar_edit_control_and_no_floating_avatar(self):
        self.assertNotIn('id="av-edit-btn"', src("screens/Profile.tsx"))
        self.assertNotIn('id="avatar-btn"', src("App.tsx"))


class TestToday(unittest.TestCase):
    def test_no_open_lists_link(self):
        self.assertNotIn('id="today-listline"', src("screens/Today.tsx"))

    def test_quest_nudge_retires_after_first_quest_open(self):
        today = src_raw("screens/Today.tsx")
        self.assertIn("useState(() => questOpened(user))", today)
        self.assertIn("!questSeen && (", today)
        self.assertIn("markQuestOpened(s.user)", src_raw("screens/quest/QuestMode.tsx"))
        lib = src_raw("lib/questSeen.ts")
        self.assertIn("arya-quest-opened:", lib)
        self.assertIn("try {", lib)


class TestLists(unittest.TestCase):
    def test_start_shopping_skips_the_one_option_sheet(self):
        js = src_raw("screens/Lists.tsx")
        self.assertIn('if (town && storeTrouble(town, here ? here.stores || [] : [])) { setShopOpen(true); return; }', js)
        self.assertIn('else if (shopMode === "list") startList();', js)

    def test_tick_hint(self):
        self.assertIn("Tap the circle to tick an item off as you shop. Tap ⋯ to move or remove it.", src("screens/Lists.tsx"))

    def test_qty_only_above_one(self):
        self.assertIn(': one ? "" : "× " + qtyFmt(item.qty)', src_raw("screens/Lists.tsx"))


if __name__ == "__main__":
    unittest.main()
