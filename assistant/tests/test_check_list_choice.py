"""Check the list: a made choice shows, and every choice can be undone.

String pins over pwa/quest.js and pwa/styles.css: the chosen chip is
pressed and styled, the typed word is struck once a swap is chosen,
a question has an Undo that clears the answer, and a corrected row can
be undone and brought back.
"""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def read(name):
    with open(os.path.join(HERE, "..", "pwa", name), encoding="utf-8") as fh:
        return fh.read()


def render_optimize():
    q = read("quest.js")
    a = q.index("function renderOptimize()")
    return q[a:q.index("function qOptProceed", a)]


class TestCheckListChoice(unittest.TestCase):
    def test_question_shows_choice_and_undo(self):
        r = render_optimize()
        self.assertIn('aria-pressed="${String(ans === val)}"', r)
        self.assertIn("optchips", r)
        self.assertIn('class="opt-from"', r)
        self.assertIn("data-qundo", r)

    def test_undo_clears_the_answer(self):
        r = render_optimize()
        q = read("quest.js")
        self.assertIn("delete Q.draft.answers[qundo.dataset.qundo]", q)
        self.assertRegex(r, r"ans \? `<button class=\"opt-undo\"")

    def test_corrected_row_can_switch_back(self):
        r = render_optimize()
        self.assertIn("Use match", r)
        q = read("quest.js")
        self.assertIn("delete item._undone", q)
        self.assertIn("delete Q.draft.undone[ci]", q)

    def test_styles_for_pressed_and_struck(self):
        css = read("styles.css")
        self.assertRegex(css, r"\.optchips \.chip\[aria-pressed=\"true\"\]\s*\{[^}]*var\(--acc-soft\)")
        self.assertRegex(css, r"\.opt-from\s*\{[^}]*line-through")
        self.assertRegex(css, r"\.opt-undo\s*\{[^}]*min-height: 40px")


if __name__ == "__main__":
    unittest.main()
