"""First run opens Today. Connecting Muse lives in Profile only.

Pins over the React app (web/src): App.tsx, app/views.ts, Muse.tsx."""
import unittest

from tests.frontend import app, src


class NoConnectOnFirstRun(unittest.TestCase):
    def test_connect_screen_is_gone(self):
        everything = app()
        self.assertNotIn('"connect"', src("app/views.ts"))
        self.assertNotIn('id="view-connect"', everything)
        self.assertNotIn("connect-skip", everything)
        self.assertNotIn("connect-done", everything)

    def test_enter_app_opens_shell_without_token_check(self):
        js = src("App.tsx")
        self.assertIn("if (!s.user) return <Login />;", js)
        self.assertIn('<NavProvider initial="home">', js)
        self.assertNotIn("/auth/token", js)
        self.assertNotIn("/auth/token", src("app/session.tsx"))
        self.assertNotIn("arya-connect-skipped", app())

    def test_profile_still_connects_muse(self):
        muse = src("screens/Muse.tsx")
        self.assertIn('id="profile-token-row"', muse)
        self.assertIn('data-copy-prompt="1"', muse)
        self.assertIn('view="muse"', src("screens/Profile.tsx"))


if __name__ == "__main__":
    unittest.main()
