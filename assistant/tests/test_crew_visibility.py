"""Crew visibility (owner, 2026-10-28): Profile opens from the top-right
avatar. Since the list-first pass (owner, 2026-10-29) Crew lives inside
the Quest tab, and Today carries no game or Crew card."""
import re
import unittest

from tests import frontend


class CrewVisibility(unittest.TestCase):
    def test_settings_tab_and_avatar_both_open_profile(self):
        # Owner 2026-10-29: a Settings tab next to Quest opens the same
        # Profile page; the avatar still does too.
        app = frontend.src("App.tsx")
        self.assertIn('profile: "Settings"', app)
        self.assertIn('"profile"]', frontend.src("app/views.ts").split("TABS")[1])
        self.assertNotIn("<header>", frontend.app())
        self.assertIn('id="avatar-btn"', app)
        self.assertIn('nav.show("profile"', app.split('id="avatar-btn"')[1].split("</button>")[0])
        self.assertNotIn('id="userbar"', frontend.app())
        profile = frontend.src("screens/Profile.tsx")
        self.assertIn('id="btn-signout2"', profile)
        self.assertIn('id="profile-account"', profile)

    def test_crew_view_leads_with_friends_and_race(self):
        # The Quest tab is the game (#158); Trips, opened from the game's
        # home with Back to it, is history only (usability audit,
        # owner-approved 2026-10-29): Crew, Race and Fastest Hands wait
        # for real cross-account play; their screens keep their routes.
        crew = frontend.src("screens/Quest.tsx")
        self.assertIn(">Your trips</h2>", crew)
        for gone in (">Friends</h3>", 'data-qnav="view-race"', 'data-qnav="view-friends"', 'id="comm-board"'):
            self.assertNotIn(gone, crew)
        self.assertIn('nav.back("community")', crew)
        reg = frontend.src("screens/registry.tsx")
        self.assertIn("community: QuestMode,", reg)
        self.assertIn("friends: Friends,", reg)

    def test_today_has_no_crew_or_game_card(self):
        home = frontend.src("screens/Today.tsx")
        for el in ("today-crew", "today-hero", "quest-sessions", "btn-new-hunt", "today-level"):
            self.assertNotIn(f'id="{el}"', home)
        self.assertNotIn("paintTodayCrew", frontend.app())

    def test_plan_and_score_invite_a_race(self):
        self.assertIn('id="opt-race"', frontend.src("screens/Optimize.tsx"))
        self.assertIn("score-challenge", frontend.src("screens/Score.tsx"))


class OneAvatar(unittest.TestCase):
    def test_demo_hides_the_make_controls_and_one_avatar_hosts_cards(self):
        profile = frontend.src("screens/Profile.tsx")
        self.assertIn('<div id="av-make-box" hidden={demo}>', profile)
        app = frontend.app()
        self.assertNotIn('id="pf-card"', app)
        self.assertNotIn("Your player", app)
        self.assertTrue(re.search(r'"custom"', frontend.src("screens/haul/Share.tsx")))


if __name__ == "__main__":
    unittest.main()
