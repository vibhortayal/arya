"""Landing page (owner, 2026-10-28): first screen is punchy. Sign in is
in the header, Try the demo is the one big button, the long copy and the
Meta credit sit behind "How it works". Pins web/src/screens/Login.tsx;
web/e2e/login.e2e.mjs taps it."""
import unittest

from tests import frontend


class TestLanding(unittest.TestCase):
    def setUp(self):
        self.login = frontend.src("screens/Login.tsx").split('<section id="view-login"')[1].split("</section>")[0]

    def test_sign_in_is_in_the_header(self):
        header = self.login.split('className="landtop"')[1].split("</header>")[0]
        self.assertIn('id="signin-open"', header)
        self.assertIn('id="login-user"', self.login)  # Email or username, #64
        self.assertIn("Email or username", self.login)

    def test_first_screen_is_short(self):
        front = self.login.split('id="signin-sheet"')[0]
        self.assertIn('id="demo-btn"', front)
        self.assertIn(">Try the demo<", front)
        # List first, Quest second (owner, 2026-10-29).
        self.assertIn("Groceries, <em>sorted.</em>", front)
        self.assertNotIn("treasure hunt.</em>", front)
        self.assertLess(front.index('id="demo-btn"'), front.index('className="questline"'))
        for long_copy in ("Quest turns the list", "Meta API live", "Meta AI Developer Hackathon"):
            self.assertNotIn(long_copy, front)

    def test_details_behind_how_it_works(self):
        how = self.login.split('id="how-sheet"')[1]
        for text in ("Quest turns the list", "Meta API live", "Meta AI Developer Hackathon"):
            self.assertIn(text, how)
        for word in ("clock", "timer", "countdown"):
            self.assertNotIn(word, self.login.lower())


if __name__ == "__main__":
    unittest.main()
