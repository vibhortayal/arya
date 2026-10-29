"""Theme migration — wireframe parity at the token layer.

The first parity pass matched structure only, and the colors
stayed behind (owner catch, 2026-10-27). These tests are the
verification that pass skipped: the built CSS must carry the
approved wireframes' token values EXACTLY (greyscale is
structure; the orange #E4572E is the game), the app's semantic
aliases must resolve onto them, and no pre-migration color —
above all the old green accent — may survive in any
first-party source (every file under web/src, scene.js, index.html). The amber warning palette stays
separate from the accent, exactly as the wireframes hold it.
"""
import glob, os, re, unittest

from tests.frontend import SRC, STATIC, WEB, read, src


def first_party():
    """Every first-party front-end file: web/src (tests included),
    web/index.html and the static scene.js."""
    files = sorted(glob.glob(os.path.join(SRC, "**", "*.*"), recursive=True))
    return files + [os.path.join(WEB, "index.html"), os.path.join(STATIC, "scene.js")]

WIREFRAME_TOKENS = {
    "--acc": "#E4572E", "--acc-soft": "#FDEEE8",
    "--ink": "#1B1B1E", "--ink2": "#55555C", "--ink3": "#8B8B93",
    "--line": "#D9D9DE", "--line2": "#ECECEF",
    "--bg": "#EFEFF1", "--panel": "#FFFFFF",
    "--fill": "#F4F4F6", "--fill2": "#E7E7EB",
}

# Pre-migration colors that must never come back: the old green
# accent family, the Apple system green/blue/orange used in the
# scene and scan layers, the dark scene background, the old
# Apple greys, and the old translucent amber.
FORBIDDEN = (
    "1c6b3c", "155c32", "176b36",          # old green accent
    "30c759", "34c759",                     # Apple system green
    "2f7cf6", "0, 122, 255",                # Apple system blue
    "ff9f0a",                               # Apple system orange
    "101318",                               # old dark scene bg
    "f2f2f7", "1c1c1e", "636366", "aeaeb2",  # old Apple greys
    "28, 107, 60", "52, 199, 89",           # green rgb/rgba forms
    "217, 144, 0",                          # old translucent amber
)


def root_tokens(css):
    block = css.split(":root", 1)[1].split("}", 1)[0]
    return {m.group(1): m.group(2).strip()
            for m in re.finditer(r"(--[\w-]+)\s*:\s*([^;]+);", block)}


class TestWireframeTokens(unittest.TestCase):
    def test_tokens_equal_the_wireframe_values_exactly(self):
        tokens = root_tokens(read("styles.css"))
        for name, value in WIREFRAME_TOKENS.items():
            self.assertEqual(tokens.get(name), value,
                             f"{name}: app has {tokens.get(name)}, "
                             f"wireframes say {value}")

    def test_semantic_aliases_resolve_onto_the_tokens(self):
        tokens = root_tokens(read("styles.css"))
        self.assertEqual(tokens["--accent"], "var(--acc)")
        self.assertEqual(tokens["--accent-text"], "var(--acc)")
        self.assertEqual(tokens["--group"], "var(--panel)")
        self.assertEqual(tokens["--label"], "var(--ink)")
        self.assertEqual(tokens["--secondary"], "var(--ink2)")
        self.assertEqual(tokens["--tertiary"], "var(--ink3)")
        self.assertEqual(tokens["--sep"], "var(--line)")

    def test_scene_backgrounds_are_the_wireframe_value(self):
        css = read("styles.css")
        self.assertIn("background: #FAFAFA", css)
        js = read("scene.js")
        self.assertIn("0xFAFAFA", js)

    def test_game_shadows_are_the_wireframe_values(self):
        css = read("styles.css")
        self.assertIn("box-shadow: 0 8px 22px rgba(228, 87, 46, .35)", css)
        self.assertIn("box-shadow: 0 8px 22px rgba(228, 87, 46, .32)", css)
        self.assertIn("receiptbtn", src("screens/Finish.tsx"))

    def test_amber_stays_separate_from_the_accent(self):
        css = read("styles.css")
        self.assertIn("color: #8a3b12; background: #FFF1D6; "
                      "border: 1px solid #E8A33D", css)
        self.assertIn("border: 1.5px solid #E8A33D", css)   # needs-your-eye
        self.assertIn('"#E8A33D"', read("scene.js"))        # marker flag badge

    def test_no_pre_migration_color_survives(self):
        files = first_party()
        self.assertGreater(len(files), 60)
        for name in files:
            with open(name, encoding="utf-8") as fh:
                text = fh.read().lower()
            for bad in FORBIDDEN:
                self.assertNotIn(bad, text,
                                 f"{bad} still present in {name}")

    def test_game_elements_wear_the_accent(self):
        css = read("styles.css")
        # Today hero card: 2px accent border.
        self.assertIn(".herocard {\n  background: var(--group); "
                      "border: 2px solid var(--accent);", css)
        # Quest mode card: acc-soft ground, acc ring; Express not.
        self.assertIn('.modecard[data-mode="quest"]', css)
        self.assertIn("background: var(--acc-soft);", css)
        # Cloud markers: collected orange, pending ink2, in scene.js.
        js = read("scene.js")
        self.assertIn('state === "got" ? "#E4572E" : "#55555C"', js)
        # Reported-missing renders use the amber flag class.
        for rel in ("screens/Hunt.tsx", "screens/Express.tsx"):
            js = src(rel)
            self.assertIn('className="repflag"', js, rel)
            self.assertNotIn('className="sub warn">Reported missing', js, rel)

    def test_chip_on_states_match_the_wireframes(self):
        css = read("styles.css")
        # Picked chips: soft treatment; the scene toggle's "on"
        # is the one solid exception.
        self.assertIn(".seg .chip[aria-pressed=\"true\"] {\n"
                      "  background: var(--acc-soft); color: var(--acc);", css)
        self.assertIn("#scene-toggle .chip[aria-pressed=\"true\"] {\n"
                      "  background: var(--accent); color: #fff;", css)
        self.assertIn("0 0 0 3px var(--acc-soft)", css)


if __name__ == "__main__":
    unittest.main()
