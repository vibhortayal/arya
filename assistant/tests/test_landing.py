"""Landing (owner, 2026-10-30, one screen): "Your grocery run, smarter.",
Try it now and Sign in side by side before the cards, eight raised-button
cards whose mascots hop until tapped (the first card beats until any card
is tapped) and zoom up with their text on a tap, and Start my own list at
the bottom. The peek rows, the How it works sheet and the Quest line are
gone. Pins web/src/screens/Login.tsx; web/src/screens/login.test.tsx
checks the flip and the register rule; web/e2e/login.e2e.mjs taps it."""
import unittest

from tests import frontend


class TestLanding(unittest.TestCase):
    def setUp(self):
        self.login = frontend.src("screens/Login.tsx").split('<section id="view-login"')[1].split("</section>")[0]
        self.front = self.login.split('id="signin-sheet"')[0]

    def test_sign_in_is_a_button_beside_try_it_now(self):
        cta = self.login.split('className="landcta"')[1].split('className="landcards"')[0]
        self.assertIn('id="demo-btn"', cta)
        self.assertIn('id="signin-open"', cta)
        self.assertIn('className="btn landsign"', cta)
        self.assertLess(cta.index('id="demo-btn"'), cta.index('id="signin-open"'))
        self.assertIn('id="login-user"', self.login)  # Email or username, #64
        self.assertIn("Email or username", self.login)

    def test_get_the_app_pill_in_the_header(self):
        header = self.login.split('className="landtop"')[1].split("</header>")[0]
        self.assertIn("<GetApp />", header)
        login = frontend.src("screens/Login.tsx")
        # Shows only while installing is possible (ui/A2hs.tsx), on a
        # phone; the demo rule does not apply (logged out).
        self.assertIn("useA2hs(false)", login)
        self.assertIn("isPhone() && a.available", login)
        self.assertIn("<A2hsSteps", login)
        self.assertIn(">Get the app<", login)
        self.assertIn('GETAPP_KEY = "arya.landing.getapp"', login)
        self.assertIn('" glow" : " jiggle"', login)
        css = frontend.read("styles.css")
        self.assertIn(".landtop .gethome.jiggle { animation: getjiggle 8s ease-in-out 1.2s infinite; }", css)
        self.assertIn(".landtop .gethome.glow { animation: getglow 8s ease-in-out 1.2s infinite; }", css)
        self.assertNotIn("pwa", frontend.words("landing.getTheApp").lower())

    def test_headline_cards_and_buttons(self):
        self.assertIn("Your grocery run, <em>smarter.</em>", self.front)
        self.assertIn("One app for the list, the store and the trip.", self.front)
        self.assertIn('className="landcards"', self.front)
        self.assertIn('aria-haspopup="dialog"', self.front)
        self.assertIn(">Try it now<", self.front)
        self.assertIn(">Start my own list<", self.front)
        self.assertIn("status.registration_open ? (", self.front)
        self.assertIn("The demo needs no sign-up.", self.front)
        self.assertLess(self.front.index('id="demo-btn"'), self.front.index('className="landcards"'))
        self.assertLess(self.front.index('className="landcards"'), self.front.index('id="register-open"'))

    def test_card_words(self):
        en = frontend.en()["landing"]["cards"]
        # The guide's eight sections, in its order (owner, 2026-10-30).
        keys = ("lists", "share", "maps", "news", "receipts", "prices", "usesoon", "ask")
        self.assertEqual(list(en), list(keys))
        self.assertEqual([en[k]["title"] for k in keys],
                         ["A list for every store", "Share with your household", "Map your store", "Store news",
                          "See where money goes", "Know where it's cheaper", "Reduce food waste", "Just ask Arya"])
        self.assertIn("learns your habits", en["lists"]["back"].lower())  # the text behind the cards stays as it was
        self.assertIn("expires or goes bad", en["usesoon"]["sub"])
        for card in en.values():
            for text in card.values():
                self.assertNotIn("optional", text.lower())
        self.assertIn("Arya shoppers", en["news"]["sub"])
        for card in en.values():
            for text in card.values():
                self.assertNotIn("fellow", text.lower())
        self.assertNotIn("blur", en["maps"]["back"].lower())

    def test_old_landing_is_gone(self):
        for gone in ("peek", "questline", "landmeta", "how-open", "how-sheet", "treasure hunt", "Meta API live"):
            self.assertNotIn(gone, self.login)
        for word in ("clock", "countdown"):
            self.assertNotIn(word, self.login.lower())

    def test_landing_drops_the_tab_bar_padding(self):
        css = frontend.read("styles.css")
        self.assertIn("body.landing { padding-bottom: calc(24px + env(safe-area-inset-bottom)); }", css)
        self.assertIn("100svh", css)
        self.assertIn('document.body.classList.add("landing")', frontend.src("screens/Login.tsx"))


if __name__ == "__main__":
    unittest.main()
