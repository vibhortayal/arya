"""Wireframe parity pass (2026-10-27): the PWA matches the approved
"Arya Quest — Wireframes" structure and design language — one
primary action per screen, drawn-SVG chrome (no stock emoji),
no dead surfaces, and Brain/Quest back links that return to the
view that opened them.

Pins here are shell-level (markup/source), in the style of
test_brain_restyle.py: they keep the parity fixes from drifting
back in later stages.
"""
import os, unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


def section(html, start, end):
    return html.split(start)[1].split(end)[0]


class TestDeadSurfacesRemoved(unittest.TestCase):
    def test_quest_profile_view_is_gone(self):
        # view-qprofile was unreachable: no data-qnav target and no
        # questGo caller ever named it; B6 (view-profile) carries the
        # same card, badges and mapped stores.
        for name in ("index.html", "quest.js", "app.js"):
            self.assertNotIn("view-qprofile", read(name), name)
            self.assertNotIn("qp-", read(name), name)
        self.assertNotIn("renderQProfile", read("quest.js"))

    def test_dead_hub_renderer_gone_listener_kept(self):
        # app.js paintTodayGames owns #quest-sessions; the quest.js
        # renderer was never called. Its delegated click handler is
        # the live path for game rows and stays.
        js = read("quest.js")
        self.assertNotIn("renderQuestHub", js)
        self.assertIn('$("#quest-sessions").addEventListener("click"', js)

    def test_open_receipt_survives(self):
        # The receipt detail is live (Receipts archive opens it).
        self.assertIn("function openReceipt(", read("quest.js"))
        self.assertIn('id="view-receipt"', read("index.html"))


class TestOnePrimaryAction(unittest.TestCase):
    def test_finish_snap_is_the_primary_button(self):
        fin = section(read("index.html"), 'id="view-finish"', 'id="view-score"')
        self.assertIn('<label class="btn primary wide receiptbtn" for="fin-photo">Snap the receipt</label>', fin)
        self.assertIn('id="fin-photo"', fin)
        self.assertIn("hidden>", fin)  # the raw input stays out of sight

    def test_mode_cards_are_not_double_wrapped(self):
        mode = section(read("index.html"), 'id="view-mode"', 'id="view-hunt"')
        self.assertNotIn('class="group pad"', mode)
        self.assertEqual(mode.count('class="modecard"'), 2)

    def test_flow_screens_have_one_primary(self):
        html = read("index.html")
        for start, end in (('id="view-newlist"', 'id="view-store"'),
                           ('id="view-optimize"', 'id="view-mode"')):
            sec = section(html, start, end)
            self.assertEqual(sec.count("btn primary"), 1, start)

    def test_score_leaves_through_the_tab_bar(self):
        # The Score is a summary the haul flow opens; the Today tab is
        # always visible there, so it carries no "Back to Today" button.
        sec = section(read("index.html"), 'id="view-score"', 'id="view-community"')
        self.assertEqual(sec.count("btn primary"), 0)
        self.assertNotIn("score-done", sec)


class TestBackLinksReturnHome(unittest.TestCase):
    def test_receipts_back_is_a_brain_return(self):
        html = read("index.html")
        rec = section(html, 'id="view-receipts"', 'id="view-chat"')
        self.assertIn('id="rc-back"', rec)
        self.assertNotIn('class="qback"', rec)
        detail = section(html, 'id="view-receipt"', "</main>")
        self.assertIn('id="rcd-back"', detail)
        self.assertNotIn('class="qback"', detail)

    def test_back_handlers_wired(self):
        app, quest = read("app.js"), read("quest.js")
        self.assertIn("receiptsFrom", app)
        self.assertIn('$("#rc-back").addEventListener("click"', app)
        self.assertIn('$("#rcd-back").addEventListener("click"', quest)
        self.assertIn('show("view-receipts")', quest)


class TestNoStockEmojiInChrome(unittest.TestCase):
    def test_no_emoji_codepoints(self):
        for name in ("index.html", "app.js", "quest.js", "scene.js"):
            src = read(name)
            bad = [ch for ch in src if ord(ch) >= 0x1F000
                   or ch in "☀☁☂⭐🔔🛒✨"]
            self.assertEqual(bad, [], f"{name}: {bad[:5]}")


if __name__ == "__main__":
    unittest.main()
