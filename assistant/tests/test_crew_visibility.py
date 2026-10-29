"""Crew visibility (owner, 2026-10-28): Profile opens from the top-right
avatar. Since the list-first pass (owner, 2026-10-29) Crew lives inside
the Quest tab, and Today carries no game or Crew card."""
import re
import unittest
from pathlib import Path

PWA = Path(__file__).resolve().parent.parent / "pwa"


def read(name):
    return (PWA / name).read_text()


class CrewVisibility(unittest.TestCase):
    def test_settings_tab_and_avatar_both_open_profile(self):
        # Owner 2026-10-29: a Settings tab next to Quest opens the same
        # Profile page; the avatar still does too.
        html = read("index.html")
        nav = html.split('<nav id="tabs"')[1].split("</nav>")[0]
        self.assertIn('data-view="view-profile"', nav)
        self.assertIn("<span>Settings</span>", nav)
        self.assertNotIn("<header>", html)
        self.assertIn('id="avatar-btn"', html)
        self.assertNotIn('id="userbar"', html)
        self.assertIn('id="btn-signout2"', html)
        self.assertIn('id="profile-account"', html)

    def test_crew_view_leads_with_friends_and_race(self):
        html = read("index.html")
        crew = html.split('id="view-community"')[1].split("</section>")[0]
        self.assertIn(">Quest</h2>", crew)
        self.assertIn(">Crew</h3>", crew)
        self.assertLess(crew.index("view-race"), crew.index("comm-board"))
        self.assertLess(crew.index("view-friends"), crew.index("comm-board"))
        self.assertNotIn("qback", crew)

    def test_today_has_no_crew_or_game_card(self):
        html = read("index.html")
        home = html.split('id="view-home"')[1].split("</section>")[0]
        for el in ("today-crew", "today-hero", "quest-sessions", "btn-new-hunt", "today-level"):
            self.assertNotIn(f'id="{el}"', home)
        self.assertNotIn("paintTodayCrew", read("app.js"))

    def test_plan_and_score_invite_a_race(self):
        self.assertIn('id="opt-race"', read("index.html"))
        self.assertIn("score-challenge", read("quest.js"))


class OneAvatar(unittest.TestCase):
    def test_demo_hides_the_make_controls_and_one_avatar_hosts_cards(self):
        html, js = read("index.html"), read("app.js")
        self.assertIn('id="av-make-box" hidden', html)
        self.assertIn('$("#av-make-box").hidden = isDemo;', js)
        self.assertNotIn('id="pf-card"', html)
        self.assertNotIn("Your player", html + js)
        self.assertIn('"custom"', read("share.js"))


if __name__ == "__main__":
    unittest.main()
