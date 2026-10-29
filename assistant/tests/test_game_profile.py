"""One source for level, streak and stickers (usability audit,
owner-approved 2026-10-29): the Quest game's profile lives on the server
and counts toward the account's level and streak."""
import os, tempfile, unittest
from datetime import date, timedelta

from tests.test_quest import make_client, setup_account


def wk(d):
    y, n, _ = d.isocalendar()
    return f"{y}-W{n:02d}"


class TestGameProfile(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        setup_account(self)

    def test_round_trip_and_validation(self):
        c = self.c
        first = c.get("/api/quest/game").json()
        assert first["profile"] is None and first["base_points"] == 0 and first["weeks"] == []
        prof = {"xp": 120, "stickers": ["dairy.webp"], "weeks": [wk(date.today())], "trips": 1}
        r = c.put("/api/quest/game", json={"profile": prof})
        assert r.status_code == 200, r.text
        assert c.get("/api/quest/game").json()["profile"] == prof
        for bad in (None, [], {"xp": -1}, {"xp": "lots"}, {"weeks": "2026-W44"}, {"stickers": [1]},
                    {"xp": 1, "pad": "x" * 300_000}):
            assert c.put("/api/quest/game", json={"profile": bad}).status_code == 400, bad

    def test_game_points_and_weeks_count_everywhere(self):
        c = self.c
        before = c.get("/api/quest/profile").json()
        today = date.today()
        weeks = [wk(today), wk(today - timedelta(days=7))]
        c.put("/api/quest/game", json={"profile": {"xp": 150, "stickers": [], "weeks": weeks}})
        after = c.get("/api/quest/profile").json()
        assert after["points"] == before["points"] + 150
        assert after["level"] == 2  # level 2 starts at 100 points, as in the game
        assert after["stats"]["streak_weeks"] == 2
        g = c.get("/api/quest/game").json()
        assert g["base_points"] == before["points"] and sorted(weeks) == g["weeks"]

    def test_streak_rests_like_the_game(self):
        from api import game_profile
        today = date(2026, 10, 29)
        played = {(today - timedelta(days=7 * k)).isocalendar()[:2] for k in (0, 2, 3)}
        # One missed week between played weeks rests, it does not break.
        assert game_profile.streak(played, today) == 3
        # Three missed weeks in a row break it.
        far = {today.isocalendar()[:2], (today - timedelta(days=28)).isocalendar()[:2]}
        assert game_profile.streak(far, today) == 1


if __name__ == "__main__":
    unittest.main()
