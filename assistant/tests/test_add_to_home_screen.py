"""Add to Home Screen prompt (owner, 2026-10-29): a Today card, a Profile
row, iPhone steps with the Open as Web App step, native install elsewhere."""
import unittest
from pathlib import Path

PWA = Path(__file__).resolve().parent.parent / "pwa"


def read(name):
    return (PWA / name).read_text(encoding="utf-8")


class TestAddToHomeScreen(unittest.TestCase):
    def test_wired_into_the_shell(self):
        html, sw = read("index.html"), read("sw.js")
        self.assertIn('<script src="a2hs.js"></script>', html)
        self.assertIn('"/a2hs.js"', sw)
        for el in ("today-a2hs", "btn-a2hs", "a2hs-sheet", "a2hs-close"):
            self.assertIn(f'id="{el}"', html)
        self.assertLess(html.index('id="today-a2hs"'), html.index('id="today-low"'))
        self.assertIn("A2HS.paintToday(h)", read("app.js"))

    def test_ios_steps_say_to_keep_open_as_web_app_on(self):
        sheet = read("index.html").split('id="a2hs-sheet"')[1].split("</ol>")[0]
        self.assertIn("Add to Home Screen", sheet)
        self.assertIn("Open as Web App", sheet)
        self.assertIn("plain Safari tab", sheet)

    def test_when_it_shows(self):
        js = read("a2hs.js")
        # Not once installed, not in the demo, not before the second visit,
        # not without a list item, not for 30 days after the x.
        self.assertIn('(display-mode: standalone)', js)
        self.assertIn("navigator.standalone", js)
        self.assertIn("!demo()", js)
        self.assertIn("st.visits < 2", js)
        self.assertIn("!items.length", js)
        self.assertIn("DISMISS_DAYS = 30", js)

    def test_android_runs_the_native_prompt_iphone_opens_steps(self):
        js = read("a2hs.js")
        self.assertIn("beforeinstallprompt", js)
        self.assertIn("ev.prompt()", js)
        self.assertIn("openSteps();", js)
        self.assertIn('deferred ? "Install" : "Show how"', js)


if __name__ == "__main__":
    unittest.main()
