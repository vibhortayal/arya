"""QA pass 2026-10-28, Low findings (input handling, copy, polish).
Pins over the React screens (web/src)."""
import unittest

from tests.frontend import app, src


class TestLows(unittest.TestCase):
    def test_enter_on_a_focused_button_is_not_a_grab(self):
        body = src("screens/Hunt.tsx").split("const keyRef = useRef")[1].split("  useEffect(() => {")[0]
        self.assertIn('t.closest("button, a[href], [role=button], summary")', body)

    def test_wild_find_submits_on_enter(self):
        hunt = src("screens/Hunt.tsx")
        wild = hunt.split('<input type="text" id="wild-name"')[1].split("/>")[0]
        self.assertIn('onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addWild(); } }}', wild)

    def test_no_clock_copy_and_no_placeholder_cards(self):
        everything = app()
        self.assertNotIn("beat the clock", everything)
        self.assertNotIn("Not built yet", everything)
        self.assertNotIn("NotPorted", everything)

    def test_raw_errors_are_sentences(self):
        js = src("lib/api.ts")
        self.assertIn("export function friendlyError(", js)
        self.assertIn("no such session", js)

    def test_add_box_keeps_text_typed_meanwhile(self):
        self.assertIn('if (textRef.current.trim() === t) changeText("");', src("screens/Lists.tsx"))

    def test_grab_before_start_explains(self):
        self.assertIn("Tap Start the hunt first.", src("screens/Hunt.tsx"))

    def test_demo_feedback_send_is_disabled(self):
        self.assertIn('id="fb-send" className="btn primary wide" type="button" disabled={demo || busy}',
                      src("screens/Feedback.tsx"))


if __name__ == "__main__":
    unittest.main()
