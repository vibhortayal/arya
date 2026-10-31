"""Profile is one short screen (owner, 2026-10-29): the avatar choices
open on Edit, and Connect an AI agent and About sit one tap away.
Quest progress lives in the Quest tab (usability pass)."""
import unittest

from tests.frontend import src


def profile_view():
    return src("screens/Profile.tsx")


class TestProfileSimple(unittest.TestCase):
    def test_avatar_choices_wait_behind_edit(self):
        prof = profile_view()
        self.assertIn('<div id="av-panel" hidden={!open}>', prof)
        self.assertIn('id="av-edit-label" type="button" aria-expanded={open} aria-controls="av-panel" onClick={() => setOpen(o => !o)}', prof)
        # One edit control (usability pass): no pencil on the picture.
        self.assertNotIn('id="av-edit-btn"', prof)

    def test_quest_stuff_left_the_profile_view(self):
        prof = profile_view()
        for el in ("pf-stats", "pf-badges", "pf-spots", "pf-stores", "profile-token-row"):
            self.assertNotIn(f'id="{el}"', prof)
        # About Arya (2026-10-31): Settings has one row to it; the Muse row
        # lives on that page.
        self.assertIn('id="btn-about"', prof)
        self.assertIn('"btn-muse"', src("screens/About.tsx"))
        # Usability pass: Quest progress moved into the Quest tab.
        self.assertNotIn('id="btn-quest-progress"', prof)
        self.assertIn('id="qm-progress"', src("screens/quest/QuestMode.tsx"))

    def test_sub_views_exist_and_go_back_to_profile(self):
        views = src("app/views.ts")
        for view, rel, back, to in (("quest-progress", "screens/QuestProgress.tsx", "pfq-back", "community"),
                                    ("muse", "screens/Muse.tsx", "pfm-back", "profile"),
                                    ("about", "screens/About.tsx", "pfa-back", "profile")):
            self.assertIn(f'"{view}"', views)
            self.assertIn(f'id="{back}" onClick={{ev => {{ ev.preventDefault(); nav.back("{to}"); }}}}', src(rel))


if __name__ == "__main__":
    unittest.main()
