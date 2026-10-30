"""Quest sub-palette (owner approved 2026-10-30, DESIGN.md): green means
grabbed or mapped, gold means golden, the rest of the chrome is neutral."""
import os
import re
import unittest

CSS = os.path.join(os.path.dirname(__file__), "..", "web", "src", "game", "game.css")


class TestQuestPalette(unittest.TestCase):
    def setUp(self):
        with open(CSS, encoding="utf-8") as f:
            self.css = f.read()

    def test_green_passes_contrast_and_blue_is_gone(self):
        self.assertIn("--q-green: #237A40;", self.css)
        self.assertNotIn("q-blue", self.css)
        for teal_or_purple in ("#1F7A6E", "#EAF6F4", "#E3D8F7", "#123E75"):
            self.assertNotIn(teal_or_purple, self.css)

    def test_selected_list_chip_is_outlined_not_black(self):
        self.assertIn(".qg-chips button.on { background: var(--q-panel); color: var(--q-ink); box-shadow: inset 0 0 0 2px var(--q-ink); }", self.css)

    def test_simulated_badges_are_neutral(self):
        self.assertIn(".qg-kind.sim { background: var(--q-neutral); color: var(--q-ink2);", self.css)
        self.assertIn(".qg-tag.guess { background: var(--q-neutral); color: var(--q-ink2);", self.css)

    def test_no_900_weights_and_no_tiny_tags(self):
        self.assertNotIn("font-weight: 900", self.css)
        sizes = [float(x) for x in re.findall(r"font-size: (\d+(?:\.\d+)?)px", self.css)]
        self.assertGreaterEqual(min(sizes), 11)


if __name__ == "__main__":
    unittest.main()
