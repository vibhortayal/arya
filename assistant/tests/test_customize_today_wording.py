"""Owner, 2026-11-02 (phone check on live): Today still said "Edit Today".
The #446 term is Customize your "Today" screen; the Today header button
reads "Customize" (fits at 360 px) and Help and Ask say to tap it."""
import os
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


def src(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


class CustomizeTodayWording(unittest.TestCase):
    def test_no_edit_today_left(self):
        for rel in ("web/src/i18n/en.json", "prompts/arya_features.md"):
            self.assertNotIn("Edit Today", src(rel), rel)

    def test_button_help_and_ask_agree(self):
        en = src("web/src/i18n/en.json")
        self.assertIn('"editToday": "Customize"', en)
        self.assertIn('"title": "Customize your \\"Today\\" screen",\n      "hint"', en)
        self.assertIn("On Today, tap Customize", en)
        self.assertIn("Tap Customize on Today", en)
        self.assertIn('tap Customize on Today', src("prompts/arya_features.md"))


if __name__ == "__main__":
    unittest.main()
