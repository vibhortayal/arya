"""Profile is one short screen (owner, 2026-10-29): the avatar choices
open on Edit, and quest progress, Connect an AI agent and About sit one tap away."""
import unittest

from tests.frontend import src


def profile_view():
    return src("screens/Profile.tsx")


class TestProfileSimple(unittest.TestCase):
    def test_avatar_choices_wait_behind_edit(self):
        prof = profile_view()
        self.assertIn('<div id="av-panel" hidden={!open}>', prof)
        self.assertIn('id="av-edit-label" type="button" onClick={() => setOpen(o => !o)}', prof)

    def test_quest_stuff_left_the_profile_view(self):
        prof = profile_view()
        for el in ("pf-stats", "pf-badges", "pf-spots", "pf-stores", "profile-token-row"):
            self.assertNotIn(f'id="{el}"', prof)
        for el in ("btn-quest-progress", "btn-muse", "btn-about"):
            self.assertIn(f'id="{el}"', prof)

    def test_sub_views_exist_and_go_back_to_profile(self):
        views = src("app/views.ts")
        for view, rel, back in (("quest-progress", "screens/QuestProgress.tsx", "pfq-back"),
                                ("muse", "screens/Muse.tsx", "pfm-back"),
                                ("about", "screens/About.tsx", "pfa-back")):
            self.assertIn(f'"{view}"', views)
            self.assertIn(f'id="{back}" onClick={{ev => {{ ev.preventDefault(); nav.back("profile"); }}}}', src(rel))


if __name__ == "__main__":
    unittest.main()
