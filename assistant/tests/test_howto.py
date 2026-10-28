"""How to play (user feedback, 2026-10-28): a first-time player saw
the hunt and did not know what to do. Three steps — find it, grab
it, snap the receipt — shown once on the first Quest hunt on a
device, reopened from the HUD "?", and closed by Skip, the button,
the backdrop or Esc."""
import os, unittest

from tests.test_hunt_nav import read


class TestHowto(unittest.TestCase):
    def test_three_steps(self):
        html = read("index.html")
        sheet = html.split('id="howto-sheet"')[1].split("</main>")[0]
        for step in ("<b>Find it</b>", "<b>Grab it</b>", "<b>Snap the receipt</b>"):
            self.assertIn(step, sheet)
        self.assertIn("No clock, no way to lose", sheet)
        tools = html.split('class="hunt-tools"')[1].split("</div>")[0]
        self.assertIn('id="btn-howto"', tools)

    def test_first_hunt_only_and_reopenable(self):
        js = read("quest.js")
        self.assertIn("qMaybeHowto(sess);", js.split("function openHunt(")[1].split("\nfunction ")[0])
        body = js.split("function qMaybeHowto(")[1].split("\n}")[0]
        self.assertIn('sess.mode !== "quest"', body)   # Express stays quiet
        self.assertIn("QHOWTO_KEY", body)
        self.assertIn('$("#btn-howto").addEventListener("click", openHowto);', js)
        self.assertIn('if (e.key === "Escape" && shown("#howto-sheet"))', js)


if __name__ == "__main__":
    unittest.main()
