"""First run opens Today. Connecting Muse lives in Profile only."""
import pathlib
import unittest

PWA = pathlib.Path(__file__).resolve().parent.parent / "pwa"


def read(name):
    return (PWA / name).read_text()


class NoConnectOnFirstRun(unittest.TestCase):
    def test_connect_screen_is_gone(self):
        html = read("index.html")
        self.assertNotIn('id="view-connect"', html)
        self.assertNotIn("connect-skip", html)
        self.assertNotIn("connect-done", html)

    def test_enter_app_opens_shell_without_token_check(self):
        js = read("app.js")
        body = js[js.index("function enterApp("):js.index("function openShell(")]
        self.assertIn("openShell();", body)
        self.assertNotIn("/auth/token", body)
        self.assertNotIn("view-connect", js)
        self.assertNotIn("arya-connect-skipped", js)

    def test_profile_still_connects_muse(self):
        html = read("index.html")
        self.assertIn('id="profile-token-row"', html)
        self.assertIn('data-copy-prompt="1"', html)


if __name__ == "__main__":
    unittest.main()
