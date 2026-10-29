"""How to play (user feedback, 2026-10-28): a first-time player saw
the hunt and did not know what to do. Three steps — find it, grab
it, snap the receipt — shown once on the first Quest hunt on a
device, reopened from the HUD "?", and closed by Skip, the button,
the backdrop or Esc. The open/close behaviour runs under vitest in
web/src/screens/hunt/hunt.test.tsx ("How to play")."""
import unittest

from tests import frontend


def hunt():
    return frontend.src("screens/Hunt.tsx")


class TestHowto(unittest.TestCase):
    def test_three_steps(self):
        h = hunt()
        sheet = h.split('id="howto-sheet"')[1].split("</Sheet>")[0]
        for step in ("<b>Find it</b>", "<b>Grab it</b>", "<b>Snap the receipt</b>"):
            self.assertIn(step, sheet)
        self.assertIn("No clock, no way to lose", sheet)
        tools = h.split('className="hunt-tools"')[1].split('<div id="wild-form"')[0]
        self.assertIn('id="btn-howto"', tools)

    def test_first_hunt_only_and_reopenable(self):
        h = hunt()
        self.assertIn('const QHOWTO_KEY = "arya-howto-seen";', h)
        auto = h.split('if (sess.mode === "quest") {')[1].split("\n    }")[0]   # Express stays quiet
        self.assertIn("localStorage.getItem(QHOWTO_KEY)", auto)
        self.assertIn("if (!seen) setHowto(true);", auto)
        self.assertIn('id="btn-howto" className="hudbtn" type="button" aria-label="How to play" onClick={() => setHowto(true)}', h)
        # Skip, the button and the backdrop all close and remember it.
        self.assertIn("<Sheet open={howto} onClose={closeHowto}", h)
        self.assertIn('id="howto-skip" className="btn" type="button" onClick={closeHowto}', h)
        self.assertIn("localStorage.setItem(QHOWTO_KEY, \"1\")", h)
        # Esc: every Sheet closes on Escape.
        self.assertIn('if (ev.key === "Escape") { close.current(); return; }', frontend.src("ui/Sheet.tsx"))
        t = frontend.src("screens/hunt/hunt.test.tsx")
        self.assertIn("opens on the first Quest hunt only, and Skip remembers it", t)
        self.assertIn("Express stays quiet", t)


if __name__ == "__main__":
    unittest.main()
