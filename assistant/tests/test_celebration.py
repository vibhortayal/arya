"""Collect celebration (Discussion 32): on COLLECT in Quest mode the
item pops in as a Muse Image character with one fun fact from the
verified static bank. Express never celebrates; "Not here" never
fires it; bubbles never stack.

The fact bank below is the brief's verified text, verbatim — the
manifest must match it exactly (fun facts only; no nutrition or
health claims; nothing improvised at runtime). Behavior is pinned
headless under node with the real manifest (skipped without node).
"""
import json, os, re, shutil, subprocess, tempfile, unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")
ASSETS = os.path.join(PWA, "assets", "characters")
NODE = shutil.which("node")

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
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


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
        html, css = read("index.html"), read("styles.css")
        hunt = html.split('id="view-hunt"')[1].split('id="view-express"')[0]
        self.assertIn('id="celeb-layer"', hunt)
        express = html.split('id="view-express"')[1].split('id="view-finish"')[0]
        self.assertNotIn("celeb-layer", express)
        self.assertIn("@keyframes celebpop", css)
        celeb_css = css.split("Collect celebration")[1]
        self.assertIn("prefers-reduced-motion", celeb_css)
        reduced = celeb_css.split("prefers-reduced-motion")[1]
        self.assertIn("celebfade", reduced)  # fade, not bounce

    def test_hook_wiring(self):
        js = read("quest.js")
        # Owner-disabled (phone pass, 2026-10-28): the collect hook
        # never pops a character card. The machinery stays wired
        # for a one-function re-enable.
        hook = js.split("function qOnCollected(")[1].split("\n}")[0]
        self.assertIn("DISABLED at the owner's word", hook)
        self.assertNotIn("qCelebrate(", hook)
        self.assertIn("setTimeout(qCelebHide, 3500)", js)
        self.assertIn("function qCelebResolve(", js)
        # Hunt v2: list-row GRABs route through collectStop, the one
        # collect path that fires the hook (the summoned panel is gone).
        self.assertIn("collectStop(Number(g.dataset.grab))", js)
        self.assertIn("qOnCollected(name);", js.split("async function collectStop(")[1].split("\n}")[0])

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
        sw = read("sw.js")
        self.assertIn('CACHE = "arya-v96"', sw)
        self.assertIn("/assets/characters/manifest.json", sw)
        self.assertIn("/assets/characters/blueberry.webp", sw)
        self.assertIn("/assets/characters/pantry.webp", sw)


PRELUDE = r"""
const __els = {};
function __el() {
  return {
    hidden: false, disabled: false, value: "", textContent: "", innerHTML: "",
    style: {}, dataset: {}, files: [],
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return __el(); }, querySelectorAll() { return []; },
    closest() { return null; }
  };
}
globalThis.document = {
  currentScript: null, baseURI: "http://test/", body: __el(),
  querySelector(sel) { return __els[sel] || (__els[sel] = __el()); },
  querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {}
};
globalThis.window = globalThis;
window.addEventListener = () => {}; window.removeEventListener = () => {}; window.scrollTo = () => {};
globalThis.localStorage = { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.$ = s => document.querySelector(s);
globalThis.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
globalThis.qtyFmt = q => { const n = Number(q); return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10); };
globalThis.CHECK_SVG = "<svg></svg>";
globalThis.empty = t => `<p class="empty">${t}</p>`;
globalThis.row = () => "";
globalThis.money = n => "$" + n;
globalThis.fmtShort = s => s;
globalThis.refresh = () => {};
globalThis.show = () => {};
globalThis.toast = () => {};
"""

DRIVER = r"""
const out = {};
const layer = () => document.querySelector("#celeb-layer");
qCelebSetManifest(MANIFEST);
const R = (n) => qCelebResolve(n, MANIFEST);
// --- resolution: exact item, independent char/fact fallback ---
out.blueberry = R("Blueberries").char === "blueberry.webp" && R("Blueberries").fact.includes("bloom");
out.banana = R("Organic Bananas").char === "banana.webp" && R("Organic Bananas").fact.startsWith("Botanically");
out.strawberry = R("Strawberries").char === "fruit.webp" && R("Strawberries").fact.includes("200 of them");
out.milk = R("Whole Milk").char === "milk.webp" && R("Whole Milk").fact.includes("Swiss cheese");
out.egg = R("Eggs 12ct").char === "egg.webp" && R("Eggs 12ct").fact.includes("shell color");
out.eggplant_not_egg = R("Eggplant").char === "vegetable.webp" && R("Eggplant").fact === null;
out.olive_oil = R("Olive Oil").char === "olive-oil.webp" && R("Olive Oil").fact.includes("1,000 years");
out.peanut_butter = R("Peanut Butter").char === "peanut-butter.webp" && R("Peanut Butter").fact.includes("540 peanuts");
out.almond = R("KS Almonds").char === "almond.webp" && R("KS Almonds").fact.includes("cousins of peaches");
out.frozen_pizza_item_wins = R("Frozen Pizza").char === "pizza.webp";
out.ice_cream_frozen = R("Ice Cream").char === "frozen.webp" && R("Ice Cream").fact.includes("Pizza Month");
out.yogurt_dairy = R("Greek Yogurt").char === "dairy.webp" && R("Greek Yogurt").fact.includes("Swiss cheese");
out.bagel_bakery = R("Bagels").char === "bakery.webp" && R("Bagels").fact.includes("10,000 years");
out.carrot_veg_no_fact = R("Carrots").char === "vegetable.webp" && R("Carrots").fact === null;
out.granola_pantry = R("Granola").char === "pantry.webp" && R("Granola").fact.includes("300 shapes");
out.unmatched_none = R("Durian") === null;
// --- the hook is owner-disabled (2026-10-28): silent in BOTH
// modes; the machinery itself still renders when called directly ---
Q.current = { mode: "express", items: [] };
qOnCollected("Blueberries");
out.express_silent = layer().innerHTML === "";
Q.current = { mode: "quest", items: [] };
qCelebHide();
qOnCollected("Blueberries");
out.quest_silent = layer().hidden === true && layer().innerHTML === "";
qCelebrate("Blueberries");
out.direct_still_works = layer().hidden === false && layer().innerHTML.includes("blueberry.webp") && layer().innerHTML.includes("bloom");
qCelebHide();
out.hide_clears = layer().hidden === true && layer().innerHTML === "";
console.log(JSON.stringify(out));
"""


@unittest.skipUnless(NODE, "node not available")
class TestCelebrationBehavior(unittest.TestCase):
    def test_resolution_and_gates(self):
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(PRELUDE)
            fh.write("\nconst MANIFEST = ")
            json.dump(manifest(), fh)
            fh.write(";\n")
            fh.write(read("quest.js"))
            fh.write(DRIVER)
            path = fh.name
        try:
            out = subprocess.run([NODE, path], capture_output=True, text=True, timeout=60)
        finally:
            os.unlink(path)
        self.assertEqual(out.returncode, 0, out.stderr)
        res = json.loads(out.stdout.strip().splitlines()[-1])
        failed = [k for k, v in res.items() if v is not True]
        self.assertEqual(failed, [], f"harness checks failed: {failed} in {res}")


if __name__ == "__main__":
    unittest.main()
