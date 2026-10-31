"""Add to Home Screen prompt (owner, 2026-10-29): a Today card, a Profile
row, iPhone steps with the Open as Web App step, native install elsewhere."""
import unittest

from tests import frontend


class TestAddToHomeScreen(unittest.TestCase):
    def test_wired_into_the_shell(self):
        a2hs, today = frontend.src("ui/A2hs.tsx"), frontend.src("screens/Today.tsx")
        # The card on Today, above the cards (Running low first by
        # default, customizable Today); the row in Settings.
        self.assertIn("<A2hsCard", today)
        self.assertIn("<A2hsRow", frontend.src("screens/About.tsx"))  # Settings > About Arya (2026-10-31)
        self.assertIn('id="btn-a2hs"', a2hs)
        self.assertIn('id="a2hs-sheet"', a2hs)
        self.assertIn("data-a2hs-x", a2hs)  # the card's close
        self.assertLess(today.index('id="today-a2hs"'), today.index("{on.map(id =>"))

    def test_install_and_close_meet_the_44px_touch_floor(self):
        # Pilot 2026-10-29: Install was 38 px and the x 36 px.
        css = frontend.src("styles/styles.css")
        self.assertIn(".a2hs .chip { white-space: nowrap; min-height: 44px; }", css)
        self.assertIn(".a2hs-x { flex: none; width: 44px; height: 44px;", css)

    def test_ios_steps_say_to_keep_open_as_web_app_on(self):
        sheet = frontend.src("ui/A2hs.tsx").split('id="a2hs-sheet"')[1].split("</ol>")[0]
        self.assertIn("Add to Home Screen", sheet)
        self.assertIn("Open as Web App", sheet)
        self.assertIn("plain browser tab", sheet)

    def test_when_it_shows(self):
        js = frontend.src("ui/A2hs.tsx")
        # Not once installed, not in the demo, not without a list item,
        # not for 30 days after the x. From the first visit (owner,
        # 2026-10-29, "Get the app").
        self.assertIn('(display-mode: standalone)', js)
        self.assertIn("navigator as any).standalone", js)
        self.assertIn("!demo", js)
        self.assertNotIn("visits", js)
        self.assertIn("&& hasList", js)
        self.assertIn("DISMISS_DAYS = 30", js)

    def test_sheet_is_get_the_arya_app_with_intro_and_tip(self):
        sheet = frontend.src("ui/A2hs.tsx").split('id="a2hs-sheet"')[1].split("</Sheet>")[0]
        self.assertIn("Get the Arya app", sheet)
        self.assertIn("Free, no app store.", sheet)
        self.assertIn("Tip: sign in from the Home Screen app. iPhone keeps it separate from your browser.", sheet)
        self.assertNotIn("pwa", frontend.en()["a2hs"].__repr__().lower())

    def test_android_runs_the_native_prompt_iphone_opens_steps(self):
        self.assertIn("beforeinstallprompt", frontend.src("app/a2hs.ts"))
        js = frontend.src("ui/A2hs.tsx")
        self.assertIn("ev.prompt()", js)
        self.assertIn("setSteps(true);", js)
        self.assertIn('deferred ? "Install" : "Show how"', js)


if __name__ == "__main__":
    unittest.main()
