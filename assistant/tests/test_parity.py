"""Wireframe parity pass (2026-10-27): the app matches the approved
"Arya Quest — Wireframes" structure and design language — one
primary action per screen, drawn-SVG chrome (no stock emoji),
no dead surfaces, and Brain/Quest back links that return to the
view that opened them.

Pins here are shell-level (source), in the style of
test_brain_restyle.py, over the React screens (web/src): they keep
the parity fixes from drifting back in later stages.
"""
import glob
import os
import unittest

from tests.frontend import SRC, STATIC, app, src


class TestDeadSurfacesRemoved(unittest.TestCase):
    def test_quest_profile_view_is_gone(self):
        # view-qprofile was unreachable; Quest progress (B6) carries the
        # same card, badges and mapped stores.
        self.assertNotIn("qprofile", src("app/views.ts"))
        everything = app()
        self.assertNotIn("view-qprofile", everything)
        self.assertNotIn('id="qp-', everything)
        self.assertNotIn("renderQProfile", everything)

    def test_dead_hub_renderer_gone_rows_kept(self):
        # The Quest tab owns #quest-sessions; its game rows open the hunt.
        js = src("screens/Quest.tsx")
        self.assertNotIn("renderQuestHub(", app())
        self.assertIn('<div id="quest-sessions">', js)
        self.assertIn('<button className="gamerow" data-sess={s.id} type="button" onClick={() => open(s)}>', js)

    def test_open_receipt_survives(self):
        # The receipt detail is live (Receipts archive opens it).
        self.assertIn('nav.show("receipt", { receipt_id: r.receipt_id', src("screens/Receipts.tsx"))
        self.assertIn('"receipt"', src("app/views.ts"))
        self.assertIn("export function Receipt(", src("screens/Receipt.tsx"))


class TestOnePrimaryAction(unittest.TestCase):
    def test_finish_snap_is_the_primary_button(self):
        fin = src("screens/Finish.tsx")
        self.assertIn('<label className="btn primary wide receiptbtn" htmlFor="fin-photo">Snap the receipt</label>', fin)
        # the raw input stays out of sight
        self.assertIn('<input type="file" id="fin-photo" accept="image/*" aria-label="Receipt photo" hidden', fin)

    def test_mode_cards_are_not_double_wrapped(self):
        mode = src("screens/Mode.tsx")
        self.assertNotIn('className="group pad"', mode)
        self.assertEqual(mode.count('<button className="modecard"'), 2)

    def test_flow_screens_have_one_primary(self):
        for rel in ("screens/NewList.tsx", "screens/Optimize.tsx"):
            self.assertEqual(src(rel).count("btn primary"), 1, rel)

    def test_score_leaves_through_the_tab_bar(self):
        # The Score is a summary the haul flow opens; the Today tab is
        # always visible there, so it carries no "Back to Today" button.
        sec = src("screens/Score.tsx")
        self.assertEqual(sec.count("btn primary"), 0)
        self.assertNotIn("score-done", sec)


class TestBackLinksReturnHome(unittest.TestCase):
    def test_receipts_back_is_a_brain_return(self):
        rec = src("screens/Receipts.tsx")
        self.assertIn('id="rc-back"', rec)
        self.assertNotIn('className="qback"', rec)
        detail = src("screens/Receipt.tsx")
        self.assertIn('id="rcd-back"', detail)
        self.assertNotIn('className="qback"', detail)

    def test_back_handlers_wired(self):
        # Back is the nav stack: it returns to whatever opened the view.
        self.assertIn('id="rc-back" className="backlink" onClick={ev => { ev.preventDefault(); nav.back(',
                      src("screens/Receipts.tsx"))
        self.assertIn('id="rcd-back" className="backlink" onClick={ev => { ev.preventDefault(); nav.back("receipts"); }}',
                      src("screens/Receipt.tsx"))


# The group sheets (ports of group.js: leave/join bullets) and the
# Lists "here" pin (lists.js) carry content emoji by design; the old
# pin never read those files either.
CONTENT_EMOJI = {"screens/GroupJoin.tsx", "screens/Profile.tsx", "screens/lists/ListSheets.tsx"}


class TestNoStockEmojiInChrome(unittest.TestCase):
    def test_no_emoji_codepoints(self):
        root = os.path.join(SRC, "")
        files = [p for p in glob.glob(os.path.join(SRC, "**", "*.ts*"), recursive=True)
                 if ".test." not in p and p[len(root):] not in CONTENT_EMOJI]
        self.assertGreater(len(files), 50)
        for path in files + [os.path.join(STATIC, "scene.js")]:
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            bad = [ch for ch in text if ord(ch) >= 0x1F000
                   or ch in "☀☁☂⭐🔔🛒✨"]
            self.assertFalse(bad, f"{path}: {bad[:5]}")


if __name__ == "__main__":
    unittest.main()
