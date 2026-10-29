"""Landing page (owner, 2026-10-28): first screen is punchy. Sign in is
in the header, Try the demo is the one big button, the long copy and the
Meta credit sit behind "How it works"."""
import unittest

from tests.test_hunt_nav import read


class TestLanding(unittest.TestCase):
    def setUp(self):
        html = read("index.html")
        self.login = html.split('id="view-login"')[1].split("</section>")[0]

    def test_sign_in_is_in_the_header(self):
        header = self.login.split('class="landtop"')[1].split("</header>")[0]
        self.assertIn('id="signin-open"', header)
        self.assertIn('id="login-user"', self.login)  # Email or username, #64
        self.assertIn("Email or username", self.login)

    def test_first_screen_is_short(self):
        front = self.login.split('id="signin-sheet"')[0]
        self.assertIn('id="demo-btn"', front)
        self.assertIn(">Try the demo<", front)
        self.assertIn("Arya writes the list. You find it, fast.", front)
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
