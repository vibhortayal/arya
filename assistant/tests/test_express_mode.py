"""Express mode (owner, 2026-10-29): a clean grocery checklist with the
same Arya help as Quest and none of the game. The photo shows only on
request, Not here? and Find with camera reuse the Quest report sheet
and the Shelf Scan, and the finish screen keeps the receipt and the
haul share but shows no points, level, badges, album or characters.
"""
import os, unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


def fn_body(js, name):
    return js.split(f"function {name}(")[1].split("\n}")[0]


class TestExpressScreen(unittest.TestCase):
    def setUp(self):
        self.html = read("index.html")
        self.exp = self.html.split('id="view-express"')[1].split('id="view-finish"')[0]

    def test_help_row_and_more_help(self):
        for el in ("exp-help", "exp-show", "exp-nothere", "exp-find", "exp-photo",
                   "exp-mount", "exp-more", "exp-more-list", "exp-ask", "exp-teach"):
            self.assertIn(f'id="{el}"', self.exp)
        # The photo is hidden until asked for.
        self.assertIn('id="exp-photo" hidden', self.exp)
        # No game, no 3D, no characters in the Express markup.
        for gone in ("btn-3d", "hunt-pts", "hunt-combo", "btn-sound", "btn-wild",
                     "assets/characters", "assets/scenes", "celeb-layer"):
            self.assertNotIn(gone, self.exp)

    def test_scan_and_report_sheets_are_shared(self):
        # They sit outside both views, so Express can open them.
        hunt = self.html.split('id="view-hunt"')[1].split('id="view-express"')[0]
        after_hunt = hunt.split("</section>", 1)[1]
        for el in ("scan-overlay", "spot-sheet", "scan-photo"):
            self.assertIn(f'id="{el}"', after_hunt)
            self.assertNotIn(f'id="{el}"', hunt.split("</section>", 1)[0])
        self.assertIn('data-kind="wrong_aisle"', self.html)

    def test_chooser_says_what_express_keeps(self):
        mode = self.html.split('id="view-mode"')[1].split("</section>")[0]
        self.assertIn("Same help from Arya, no game", mode)
        self.assertIn("No characters, points or badges", mode)

    def test_client_wiring(self):
        js = read("quest.js")
        self.assertIn('$("#exp-show").addEventListener("click"', js)
        self.assertIn("window.huntMoved", js)
        self.assertIn("window.huntMoved = movedSheet", read("huntmenu.js"))
        self.assertIn("window.mapperTeachNow = mapperTeachNow", read("mapper.js"))
        # Express repaints itself after a scan grab, a report or a withdraw.
        for name in ("collectStop",):
            self.assertIn("renderCurrent();", fn_body(js, name))
        # The photo mounts only when asked, and the help row is moved, not rebuilt.
        paint = js.split("function qExpPaintHelp(")[1].split("\n}")[0]
        self.assertIn("Q.expShow", paint)
        self.assertIn("rows[next].after(help)", paint)
        self.assertIn('"photo" : "strip"', paint)


class TestExpressFinish(unittest.TestCase):
    def test_score_is_plain(self):
        js = read("quest.js")
        score = js.split("async function openScore(")[1].split("\nasync function ")[0] \
            if "\nasync function " in js.split("async function openScore(")[1] \
            else js.split("async function openScore(")[1]
        self.assertIn('const plain = sess.mode === "express";', score)
        self.assertIn("if (plain) profile = null;", score)
        self.assertIn("if (!plain) html += qHaulHtml(sess, profile, attached);", score)
        self.assertIn("if (attached && !plain) {", score)           # no friend challenge
        self.assertIn("if (!plain) qAfterHaul(sess, profile, attached);", score)
        self.assertIn("shopping done", score)
        # Receipt, haul card and haul share stay.
        self.assertIn("HaulUI.scoreRow(sess, attached)", score)
        self.assertIn('id="share-haul"', score)

    def test_album_button_is_quest_only(self):
        self.assertIn("window.renderAlbum && quest ?", read("haul.js"))

    def test_finish_hides_the_bonus_line(self):
        self.assertIn('id="fin-bonus"', read("index.html"))
        self.assertIn('bonus.hidden = sess.mode === "express"', read("quest.js"))


if __name__ == "__main__":
    unittest.main()
