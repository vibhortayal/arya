"""Collect celebration (Discussion 32): on COLLECT in Quest mode the
item pops in as a Muse Image character with one fun fact from the
verified static bank. Express never celebrates; "Not here" never
fires it; bubbles never stack.

The fact bank below is the brief's verified text, verbatim — the
manifest must match it exactly (fun facts only; no nutrition or
health claims; nothing improvised at runtime). Behavior is pinned
headless under node with the real manifest (skipped without node).
"""
import json, os, re, unittest

from tests import frontend  # noqa: E402

PWA = frontend.STATIC
ASSETS = os.path.join(PWA, "assets", "characters")

FACTS = {
    "blueberry": "The white dusty coating on a blueberry is called bloom — it's a natural shield that keeps the berry fresh.",
    "banana": "Botanically, a banana is a berry — but a strawberry isn't.",
    "strawberry": "A strawberry carries its seeds on the outside — about 200 of them on every berry.",
    "raspberry": "A raspberry is many tiny fruits joined together — every little bead is one fruit.",
    "mandarin": "Mandarins were named after the bright orange robes of officials in ancient China.",
    "egg": "Brown eggs and white eggs taste the same — the shell color just depends on the hen.",
    "cheese": "The holes in Swiss cheese are bubbles made by friendly bacteria.",
    "bread": "People have been baking bread for more than 10,000 years.",
    "pasta": "There are over 300 shapes of pasta, each made to hold sauce its own way.",
    "pizza": "October is National Pizza Month in the United States.",
    "hummus": "Hummus means 'chickpeas' in Arabic — the dip is named after its main ingredient.",
    "olive oil": "An olive tree can live for over 1,000 years and still make olives.",
    "peanut butter": "It takes about 540 peanuts to make one jar of peanut butter.",
    "almond": "Almonds are cousins of peaches — an almond is the seed inside a fruit.",
}
CATEGORY_FACTS = {"fruit": "banana", "dairy": "cheese", "bakery": "bread",
                  "frozen": "pizza", "pantry": "pasta", "vegetable": None}
ITEM_CHARS = {"blueberry", "banana", "raspberry", "mandarin", "egg",
              "cheese", "bread", "pasta", "pizza", "hummus",
              "olive oil", "peanut butter", "almond", "milk"}


def read(name):
    return frontend.read(name)


def manifest():
    with open(os.path.join(ASSETS, "manifest.json"), encoding="utf-8") as fh:
        return json.load(fh)


class TestManifest(unittest.TestCase):
    def test_facts_are_the_verified_bank_verbatim(self):
        m = manifest()
        by_id = {r["id"]: r for r in m["items"]}
        for item_id, fact in FACTS.items():
            self.assertIn(item_id, by_id)
            self.assertEqual(by_id[item_id].get("fact"), fact, item_id)
        cats = {c["id"]: c for c in m["categories"]}
        for cat_id, src in CATEGORY_FACTS.items():
            want = FACTS[src] if src else None
            self.assertEqual(cats[cat_id].get("fact"), want, cat_id)

    def test_every_character_file_exists(self):
        m = manifest()
        files = set()
        for r in m["items"]:
            if r.get("char"):
                files.add(r["char"])
        for c in m["categories"]:
            files.add(c["char"])
        self.assertEqual(len(files), 20)  # 14 items + 6 categories
        for f in files:
            path = os.path.join(ASSETS, f)
            self.assertTrue(os.path.exists(path), f)
            self.assertGreater(os.path.getsize(path), 1000, f)
            with open(path, "rb") as fh:
                self.assertEqual(fh.read(4), b"RIFF", f)

    def test_item_character_coverage(self):
        m = manifest()
        by_id = {r["id"]: r for r in m["items"]}
        for item_id in ITEM_CHARS:
            self.assertIn("char", by_id[item_id], item_id)
        # Strawberry has a fact but no character of its own: it falls
        # back to the fruit character with its own fact.
        self.assertNotIn("char", by_id["strawberry"])
        # Milk has a character; its fact falls back to dairy.
        self.assertNotIn("fact", by_id["milk"])


class TestCelebrationShell(unittest.TestCase):
    def test_layer_markup_and_styles(self):
        hunt, express = frontend.src("screens/Hunt.tsx"), frontend.src("screens/Express.tsx")
        css = read("styles.css")
        self.assertIn('id="celeb-layer"', hunt)
        self.assertNotIn("celeb-layer", express)
        self.assertIn("@keyframes celebpop", css)
        celeb_css = css.split("Collect celebration")[1]
        self.assertIn("prefers-reduced-motion", celeb_css)
        reduced = celeb_css.split("prefers-reduced-motion")[1]
        self.assertIn("celebfade", reduced)  # fade, not bounce

    def test_hook_wiring(self):
        js = frontend.src("screens/hunt/fx.ts")
        # Owner-disabled (phone pass, 2026-10-28): the collect hook
        # never pops a character card. The machinery stays wired
        # for a one-line re-enable.
        self.assertIn("DISABLED at the owner's word", js)
        self.assertIn("const CELEBRATE = false;", js)
        hook = js.split("export function qOnCollected(")[1].split("\n}")[0]
        self.assertIn("if (!CELEBRATE) return;", hook)
        self.assertIn("setTimeout(qCelebHide, 3500)", js)
        self.assertIn("export function qCelebResolve(", js)
        # Hunt v2: list-row GRABs route through collectStop, the one
        # collect path that fires the hook.
        hunt = frontend.src("screens/Hunt.tsx")
        self.assertIn("collectStop(i);", hunt)
        self.assertIn("qOnCollected(name);", hunt.split("async function collectStop(")[1].split("\n  }\n")[0])

    def test_corner_card_placement(self):
        # Discussion 44 (owner phone test): the celebration is a
        # small card in the bottom-left corner — never center-
        # screen over the store view. Hunt v2: the hunt is one
        # scrolling column, so the card rides the viewport corner.
        # Anchor + caps are pinned as CSS tokens, not screenshots.
        css = read("styles.css")
        layer = css.split(".celeblayer {")[1].split("}")[0]
        self.assertIn("left: 12px", layer)
        self.assertNotIn("right:", layer)
        self.assertNotIn("translateX(-50%)", layer)
        self.assertIn("max-width: 55vw", layer)
        self.assertIn("position: fixed", layer)
        self.assertIn("bottom: calc(16px", layer)
        char = css.split(".celeb-char {")[1].split("}")[0]
        w = int(re.search(r"width: (\d+)px", char).group(1))
        h = int(re.search(r"height: (\d+)px", char).group(1))
        self.assertLessEqual(w, 56)
        self.assertLessEqual(h, 56)
        bubble = css.split(".celeb-bubble {")[1].split("}")[0]
        self.assertIn("font-size: 13px", bubble)  # the small size

    def test_sw_precaches_celebration_assets(self):
        sw = frontend.src("sw.js")
        self.assertIn('"/assets/characters/manifest.json"', sw)
        for n in ("blueberry", "pantry"):
            self.assertIn(f'"{n}"', sw.split("const STATIC")[1].split("const BYPASS")[0])


class TestCelebrationBehavior(unittest.TestCase):
    def test_resolution_and_gates(self):
        # The node harness that ran quest.js is now a vitest beside the
        # port: every item and category case, and the disabled hook.
        t = frontend.src("screens/hunt/fx.test.ts")
        for case in ("Blueberries", "Eggplant", "Frozen Pizza", "Granola", "Durian"):
            self.assertIn(f'"{case}"', t)
        self.assertIn("the collect hook is owner-disabled", t)


if __name__ == "__main__":
    unittest.main()
