"""Crew visibility (owner, 2026-10-28): Crew is a tab, Profile opens
from the top-right avatar, and Today carries a Crew card."""
import re
import unittest
from pathlib import Path

PWA = Path(__file__).resolve().parent.parent / "pwa"


def read(name):
    return (PWA / name).read_text()


class CrewVisibility(unittest.TestCase):
    def test_profile_is_not_a_tab_and_avatar_opens_it(self):
        html = read("index.html")
        nav = html.split('<nav id="tabs"')[1].split("</nav>")[0]
        self.assertNotIn("view-profile", nav)
        self.assertIn('id="avatar-btn"', html.split("</header>")[0])
        self.assertNotIn('id="userbar"', html)
        self.assertIn('id="btn-signout2"', html)
        self.assertIn('id="profile-account"', html)

    def test_crew_view_leads_with_friends_and_race(self):
        html = read("index.html")
        crew = html.split('id="view-community"')[1].split("</section>")[0]
        self.assertIn(">Crew</h2>", crew)
        self.assertLess(crew.index("view-race"), crew.index("comm-board"))
        self.assertLess(crew.index("view-friends"), crew.index("comm-board"))
        self.assertNotIn("qback", crew)

    def test_today_crew_card_has_no_pressure_words(self):
        js = read("app.js")
        self.assertIn('id="today-crew"', read("index.html"))
        body = js.split("async function paintTodayCrew")[1].split("async function renderHome")[0]
        for word in ("lose", "behind", "last place", "penalty", "hurry"):
            self.assertNotIn(word, body.lower())

    def test_plan_and_score_invite_a_race(self):
        self.assertIn('id="opt-race"', read("index.html"))
        self.assertIn("score-challenge", read("quest.js"))


if __name__ == "__main__":
    unittest.main()
