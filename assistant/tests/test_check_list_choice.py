"""Check the list: a made choice shows, and every choice can be undone.

String pins over web/src/screens/Optimize.tsx and styles.css: the
chosen chip is pressed and styled, the typed word is struck once a swap
is chosen, a question has an Undo that clears the answer, and a
corrected row can be undone and brought back. The taps themselves run
in web/e2e/optimize.e2e.mjs.
"""
import re
import unittest

from tests import frontend


def read(name):
    return frontend.read(name)


def render_optimize():
    return frontend.src("screens/Optimize.tsx")


class TestCheckListChoice(unittest.TestCase):
    def test_question_shows_choice_and_undo(self):
        r = render_optimize()
        self.assertIn("aria-pressed={ans === val}", r)
        self.assertIn("optchips", r)
        self.assertIn('className="opt-from"', r)
        self.assertIn("data-qundo", r)

    def test_undo_clears_the_answer(self):
        r = render_optimize()
        self.assertIn("delete D.answers[q.item]", r)
        self.assertRegex(r, r'ans \? <button className="opt-undo"')

    def test_corrected_row_can_switch_back(self):
        r = render_optimize()
        self.assertIn('"Use match"', r)
        self.assertIn("delete item._undone", r)
        self.assertIn("delete D.undone[ci]", r)

    def test_styles_for_pressed_and_struck(self):
        css = read("styles.css")
        self.assertRegex(css, r"\.optchips \.chip\[aria-pressed=\"true\"\]\s*\{[^}]*var\(--acc-soft\)")
        self.assertRegex(css, r"\.opt-from\s*\{[^}]*line-through")
        self.assertRegex(css, r"\.opt-undo\s*\{[^}]*min-height: 40px")


if __name__ == "__main__":
    unittest.main()
