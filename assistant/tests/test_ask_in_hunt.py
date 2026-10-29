"""Ask Arya during a hunt (owner, 2026-10-29): a pinned bar opens a
sheet with quick questions, a field and a mic; it reuses the List's
engine with surface "hunt" and a context naming the store and stop."""
import os, unittest

import test_ask_in_list as base
from test_ask_in_list import StubChat  # noqa: E402


def read(name):
    return open(os.path.join(os.path.dirname(__file__), "..", "pwa", name)).read()


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
        html, js = read("index.html"), read("huntask.js")
        hunt = html[html.index('id="view-hunt"'):]
        hunt = hunt[:hunt.index("</section>")]
        self.assertIn('id="hunt-askbar"', hunt)
        self.assertIn('id="ask-sheet"', html)
        self.assertIn("huntask.js", html)
        self.assertIn("/huntask.js", read("sw.js"))
        self.assertIn('surface: "hunt"', js)
        self.assertIn("wireRecordButton", js)
        for q in ("Is there a cheaper one?", "I can't find it"):
            self.assertIn(q, js)

    def test_bar_shows_only_on_the_hunt(self):
        css = read("styles.css")
        self.assertIn(".askbar { display: none; }", css)
        self.assertIn("body.hunting #view-hunt.full .askbar", css)

    def test_nothing_in_the_bar_tells_the_crew(self):
        js = read("huntask.js")
        self.assertNotIn("/api/quest/stores", js)
        self.assertNotIn("report", js.lower().replace("never mind", ""))


if __name__ == "__main__":
    unittest.main()
