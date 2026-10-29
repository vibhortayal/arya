"""Pack slice, client side: string pins over the plan screen
(web/src/screens/NewList.tsx, which holds the port of pwa/pack.js and
the plan half of quest.js), the mode screen (Mode.tsx) and pack.css.

The behaviour the old node harnesses ran (PURE, MACHINE, REVIEW and
COMBINED over pack.js and quest.js) runs under vitest in
web/src/screens/pack.test.tsx; the browser run is
web/e2e/newlist.e2e.mjs. Helper mode was hidden in the old app
(HELPER_ENABLED = false) and is not ported, so its checks retired
with it: the saved draft only keeps its `helper` field."""
import re
import unittest

from tests import frontend

BANNED = ("lives", "game over", "timer", "streak", "hurry", "penalty", "retake",
          "try again", "incomplete", "last place", "failed", "verified", "cropped",
          "frame deleted")


def read(name):
    return frontend.read(name)


def src(rel):
    return frontend.src(rel)


def newlist():
    return src("screens/NewList.tsx")


def screen():
    """NewList's markup: its return, from the Back link on."""
    nl = newlist()
    return nl[nl.index('<p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back("store"); }}>'):]


def body(text, header, end="\n  };"):
    return text.split(header)[1].split(end)[0]


class TestPackShell(unittest.TestCase):
    def test_stylesheet_order(self):
        main = src("main.tsx")
        self.assertIn('import "./styles/pack.css";', main)
        self.assertLess(main.index('import "./styles/styles.css";'), main.index('import "./styles/pack.css";'))
        # scene.js loads on demand from the static folder (ui/Scene.tsx).
        self.assertIn('s.src = "/scene.js";', src("ui/Scene.tsx"))

    def test_newlist_block(self):
        nl = screen()
        for el in ("nl-text", "nl-add", "nl-helper", "nl-deck", "nl-plan", "nl-foot", "nl-next",
                   "nl-mic", "nl-photo", "nl-status"):
            self.assertIn(f'id="{el}"', nl)
        # Wireframe order: the deck first (cards on screen at phone
        # height), then "Add something else" (kept above the rows by the
        # fun pass), then the bag rows.
        self.assertLess(nl.index('id="nl-deck"'), nl.index('id="nl-text"'))
        self.assertLess(nl.index('id="nl-text"'), nl.index('id="nl-plan"'))
        self.assertLess(nl.index('id="nl-plan"'), nl.index('id="nl-foot"'))
        self.assertLess(nl.index('id="nl-foot"'), nl.index('id="nl-next"'))
        self.assertEqual(nl.count('className="btn primary'), 1)
        self.assertIn('<button id="nl-next" className="btn primary wide"', nl)
        self.assertIn('<textarea id="nl-text" rows={2}', nl)

    def test_the_draft_is_finished_once_the_session_exists(self):
        mode = src("screens/Mode.tsx")
        create = body(mode, "const create = async (mode: string) => {")
        self.assertIn("if (!D || D.creating) return;", create)
        self.assertIn("D.creating = true;", create)
        self.assertIn("finally", create)
        self.assertLess(create.index('post("/api/quest/sessions"'), create.index("packFinish(D);"))
        fin = body(newlist(), "export function packFinish(", "\n}")
        self.assertIn('post("/api/quest/queued/finish", { ids })', fin)
        self.assertIn("lsDel(KEY_DRAFT);", fin)
        self.assertIn("draft.pack = null;", fin)

    def test_plan_block(self):
        nl = newlist()
        start = body(nl, "const start = async () => {")
        # Text still in the box becomes bag rows first, then the list
        # joins, then the optimize call.
        self.assertIn("if (textRef.current.trim()) { addFromText(textRef.current);", start)
        self.assertIn('post("/api/list/add", { ...body, ...lid })', start)
        self.assertIn("if (D.creating) return;", start)
        self.assertIn("finally", start)
        self.assertLess(start.index("addFromText"), start.index("await optimize(false);"))
        self.assertLess(start.index('post("/api/list/add"'), start.index("await optimize(false);"))
        self.assertIn("const raw = pickedRows().map(r => rawItem(r));", start)
        self.assertIn('(replace ? nav.replace : nav.show)("newlist", params);', src("screens/Store.tsx"))
        self.assertNotIn("Often bought here, not on your list", nl)

    def test_pack_is_a_safe_module(self):
        nl = newlist()
        for s in ("onPointerDown", "onPointerMove", "onPointerUp", "onPointerCancel", "busy.current",
                  "Back one card", "Pack all", "Skip the rest", "Pack it",
                  "Any brand", "Take out of this trip",
                  "arya-pack-draft", "arya-pack-budget", "arya-helper-name",
                  "/api/pack/variants", "/api/quest/queued/finish"):
            self.assertIn(s, nl, s)
        for s in ("re-adding", "arya-carry", "arya-pack-queue", "packQueueAdd"):
            self.assertNotIn(s, nl)
        # every mutator snapshots first and offers Undo through done()
        for header in ("const decide = (kind: string, id: string) => {", "const backOne = () => {",
                       "const sweep = (kind: string) => {", "const restore = (key: string) => {",
                       "const addFromText = (t: string, src?: string) => {", "const addStarter = (name: string) => {"):
            self.assertIn("snap();", body(nl, header), header)
        self.assertIn('if (msg) toast(msg, { action: "Undo", onAction: undo });', nl)
        # no emoji, no banned words in anything the shopper reads
        self.assertFalse([c for c in nl if ord(c) >= 0x1F000])
        # (the voice block is quest.js's recorder copy, not the Pack's)
        packed = nl.split("/* ---- voice ---- */")[0] + nl.split("/* ---- plan rows")[1]
        copy = " ".join(a or b for a, b in re.findall(r'"([^"\n]{6,})"|`([^`\n]{6,})`', packed)).lower()
        for bad in BANNED:
            self.assertNotIn(bad, copy, bad)
        # the estimate never leaves the phone
        for call in re.findall(r"post(?:<[^>]*>)?\([^)]*\)", nl):
            self.assertNotIn("estimate", call)
            self.assertNotIn("budget", call)

    def test_pack_css_rules(self):
        css = read("pack.css")
        b = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        self.assertEqual(re.findall(r"#[0-9a-fA-F]{3,8}\b", b), [])
        self.assertNotIn("gradient", b)
        self.assertNotIn("--danger", b)
        self.assertNotIn("red", re.sub(r"prefers-reduced[^{]*", "", b).lower().replace("reduce", ""))
        for sel in (".packdeck", ".packcard", ".packbtns", ".packlinks", ".packqty", ".packrow",
                    ".budgetrow", ".helperbar", ".pendingrow", ".packsheet"):
            self.assertIn(sel, b, sel)
        self.assertIn("touch-action: pan-y", b)
        self.assertIn("height: 340px", b)
        self.assertIn('.btn.primary[aria-disabled="true"]', b)
        self.assertIn("prefers-reduced-motion", b)
        self.assertRegex(b, r"\.packqty button \{[^}]*width: 44px; height: 44px")
        self.assertRegex(b, r"\.packlink \{[^}]*min-height: 44px")
        self.assertRegex(b, r"\.packedit, \.packback \{[^}]*min-height: 44px")
        for size in re.findall(r"font-size: (\d+)px", b):
            self.assertGreaterEqual(int(size), 12)

    def test_other_slices_never_mention_estimate_or_budget(self):
        for rel in ("screens/haul/Share.tsx", "screens/Album.tsx", "screens/album/StickerCard.tsx"):
            js = src(rel).lower()
            self.assertNotIn("estimate", js, rel)
            self.assertNotIn("budget", js, rel)
        # The haul shows the owner's own server-side "estimate vs actual"
        # row (from the ledger, haul view key "private"). It never reads
        # the pack draft, the pack estimate or the budget.
        for rel in ("screens/haul/core.ts", "screens/haul/state.ts", "screens/haul/Reveal.tsx",
                    "screens/haul/ReceiptReview.tsx", "screens/haul/HaulCard.tsx",
                    "screens/haul/CrewFeed.tsx", "screens/haul/ScoreRow.tsx"):
            js = src(rel).lower()
            self.assertNotIn("budget", js, rel)
            self.assertNotIn("arya-pack", js, rel)
            self.assertNotIn("pack.estimate", js, rel)


class TestPackUnderVitest(unittest.TestCase):
    """The old node harnesses, ported to web/src/screens/pack.test.tsx."""

    def test_harness_checks_are_ported(self):
        t = src("screens/pack.test.tsx")
        for name in (
            # PURE
            "parseLine: quantity, size note, brands with numbers, markup kept as text",
            "splitInput", "aisleFor", "matchRow: exact, plural, a unique core name; never a wrong guess",
            "the deck: carried, queued, due before usual; dedupe; cap; approved helper rows are not dealt",
            "drag boundaries",
            "the estimate: the store's price first, unpriced items said so; the budget line is calm",
            "the shapes sent on: the raw line and the session item",
            # MACHINE
            "deals in order; a double tap is one decision; the next card waits for the motion",
            "Back one card undoes the last decision, then the one before",
            "Undo is exact; Pack all; Skip the rest; a skipped row comes back",
            "added, merged, matched only when sure", "an empty bag keeps Start disabled",
            "names are text, never markup",
            "saved on a decision, restored at the same store, fresh elsewhere or after 12 hours",
            "packFinish posts the dealt queued cards once and clears the draft",
            "every storage call survives a throwing store",
            "the budget keeps digits and a dot, and persists",
            # REVIEW
            "plain milk is not the oat milk row; butter is not peanut butter; an exact name links",
            "arrow keys pack and skip, and focus follows the new card",
            # COMBINED
            "the plan draws the deck and the bag apart; Start flushes the box, joins the list, then optimizes; "
            "a mode makes one session and finishes the queue",
        ):
            self.assertIn(name, t)


if __name__ == "__main__":
    unittest.main()
