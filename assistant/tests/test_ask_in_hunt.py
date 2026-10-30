"""Ask Arya during a hunt (owner, 2026-10-29): a pinned bar opens a
sheet with quick questions, a field and a mic; it reuses the List's
engine with surface "hunt" and a context naming the store and stop."""
import unittest

from tests import test_ask_in_list as base
from tests.test_ask_in_list import StubChat  # noqa: E402
from tests import frontend


class TestHuntContext(base.TestAskSurfaces):
    def test_hunt_context_reaches_the_model(self):
        self.ask([], surface="hunt", context={"hunt": "Costco", "next_item": "olive oil", "aisle": "Aisle 4"})
        sent = "\n".join(str(m["content"]) for m in StubChat.seen)
        self.assertIn("CURRENT SCREEN", sent)
        self.assertIn("olive oil", sent)

    def test_a_hunt_add_applies_with_undo_and_risky_waits(self):
        out = self.ask([{"type": "add_to_list", "item": "tortillas"}], surface="hunt", context={"hunt": "Costco"})
        self.assertEqual(len(out["added"]), 1)
        self.assertEqual(out["proposed"], [])


class TestShell(unittest.TestCase):
    def test_bar_sheet_and_script_are_wired(self):
        hunt, js = frontend.src("screens/Hunt.tsx"), frontend.src("screens/hunt/AskSheet.tsx")
        self.assertIn('id="hunt-askbar"', hunt)
        self.assertIn("<AskSheet", hunt)
        self.assertIn('id="ask-sheet"', js)
        self.assertIn('surface: "hunt"', js)
        self.assertIn("useRecord(", js)  # the shared mic (app.js wireRecordButton)
        for q in ("Is there a cheaper one?", "I can't find it"):
            self.assertIn(q, js)

    def test_bar_shows_only_on_the_hunt(self):
        css = frontend.read("styles.css")
        self.assertIn(".askbar { display: none; }", css)
        self.assertIn("body.hunting #view-hunt.full .askbar", css)

    def test_nothing_in_the_bar_tells_the_crew(self):
        js = frontend.src("screens/hunt/AskSheet.tsx")
        self.assertNotIn("/api/quest/stores", js)
        self.assertNotIn("report", js.lower().replace("never mind", ""))


if __name__ == "__main__":
    unittest.main()
