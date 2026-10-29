"""Profile is one short screen (owner, 2026-10-29): the avatar choices
open on Edit, and quest progress, Connect an AI agent and About sit one tap away."""
import os
import unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


def profile_view(html):
    return html.split('id="view-profile"')[1].split('id="view-quest-progress"')[0]


class TestProfileSimple(unittest.TestCase):
    def test_avatar_choices_wait_behind_edit(self):
        html = read("index.html")
        self.assertIn('id="av-panel" hidden', html)
        self.assertIn('id="av-edit-label"', html)
        self.assertIn("function avEdit(", read("app.js"))

    def test_quest_stuff_left_the_profile_view(self):
        prof = profile_view(read("index.html"))
        for el in ("pf-stats", "pf-badges", "pf-spots", "pf-stores", "profile-token-row"):
            self.assertNotIn(f'id="{el}"', prof)
        for el in ("btn-quest-progress", "btn-muse", "btn-about"):
            self.assertIn(f'id="{el}"', prof)

    def test_sub_views_exist_and_go_back_to_profile(self):
        html, js = read("index.html"), read("app.js")
        for view in ("view-quest-progress", "view-muse", "view-about"):
            self.assertIn(f'id="{view}"', html)
        self.assertIn('show("view-profile"); refresh("view-profile");', js)


if __name__ == "__main__":
    unittest.main()
