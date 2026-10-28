"""QA pass 2026-10-28, Low findings (input handling, copy, polish)."""
import os, unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name)) as f:
        return f.read()


class TestLows(unittest.TestCase):
    def test_enter_on_a_focused_button_is_not_a_grab(self):
        body = read("quest.js").split("function qHuntKey(")[1].split("\n}")[0]
        self.assertIn('e.target.closest("button, a[href], [role=button], summary")', body)

    def test_wild_find_submits_on_enter(self):
        self.assertIn('$("#wild-name").addEventListener("keydown"', read("quest.js"))

    def test_no_clock_copy_and_no_placeholder_cards(self):
        html = read("index.html")
        self.assertNotIn("beat the clock", html)
        self.assertNotIn("Not built yet", html)

    def test_raw_errors_are_sentences(self):
        js = read("app.js")
        self.assertIn("function friendlyError(", js)
        self.assertIn("no such session", js)

    def test_add_box_keeps_text_typed_meanwhile(self):
        self.assertIn('if (field.value.trim() === text) field.value = "";', read("app.js"))

    def test_grab_before_start_explains(self):
        self.assertIn("Tap Start the hunt first.", read("quest.js"))

    def test_demo_feedback_send_is_disabled(self):
        self.assertIn('$("#fb-send").disabled = isDemo;', read("app.js"))
