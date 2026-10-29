"""Crew visibility (owner, 2026-10-28): Profile opens from the top-right
avatar. Since the list-first pass (owner, 2026-10-29) Crew lives inside
the Quest tab, and Today carries no game or Crew card."""
import re
import unittest

from tests import frontend


class CrewVisibility(unittest.TestCase):
    def test_settings_tab_opens_profile(self):
        # Owner 2026-10-29: a Settings tab next to Quest opens Profile.
        app = frontend.src("App.tsx")
        self.assertIn('profile: "Settings"', app)
        self.assertIn('"profile"]', frontend.src("app/views.ts").split("TABS")[1])
        self.assertNotIn("<header>", frontend.app())
        # Usability pass (owner 2026-10-29): no floating avatar; it did
        # what the Settings tab does and covered page titles.
        self.assertNotIn('id="avatar-btn"', app)
        self.assertNotIn('id="userbar"', frontend.app())
        profile = frontend.src("screens/Profile.tsx")
        self.assertIn('id="btn-signout2"', profile)
        self.assertIn('id="profile-account"', profile)

    def test_crew_view_leads_with_friends_and_race(self):
        # The Quest tab is the game (#158); the old hub is Trips, opened
        # from the game's home, with Back to the game.
        crew = frontend.src("screens/Quest.tsx")
        self.assertIn(">Your trips</h2>", crew)
        self.assertIn(">Friends</h3>", crew)
        # Race is hidden until cross-account races work (labels audit).
        self.assertIn('{SHOW_RACE && <button className="navrow" data-qnav="view-race"', crew)
        self.assertLess(crew.index('data-qnav="view-race"'), crew.index('id="comm-board"'))
        self.assertLess(crew.index('data-qnav="view-friends"'), crew.index('id="comm-board"'))
        self.assertIn('nav.back("community")', crew)
        self.assertIn("community: QuestMode,", frontend.src("screens/registry.tsx"))

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
