"""Express mode (owner, 2026-10-29): a clean grocery checklist with the
same Arya help as Quest and none of the game. The photo shows only on
request, Not here? and Find with camera reuse the Quest report sheet
and the Shelf Scan, and the finish screen keeps the receipt and the
haul share but shows no points, level, badges, album or characters.
Pins over web/src/screens/Express.tsx and its neighbours; the taps run
in web/e2e/express.e2e.mjs.
"""
import unittest

from tests import frontend


class TestExpressScreen(unittest.TestCase):
    def setUp(self):
        self.exp = frontend.src("screens/Express.tsx")

    def test_help_row_and_more_help(self):
        for el in ("exp-help", "exp-show", "exp-nothere", "exp-find", "exp-photo",
                   "exp-mount", "exp-more", "exp-more-list", "exp-ask", "exp-teach"):
            self.assertIn(f'id="{el}"', self.exp)
        # The photo is hidden until asked for.
        self.assertIn('<div id="exp-photo" hidden={!sceneOn}>', self.exp)
        self.assertIn("const sceneOn = show && hasData;", self.exp)
        # No game, no 3D, no characters in the Express markup.
        for gone in ("btn-3d", "hunt-pts", "hunt-combo", "btn-sound", "btn-wild",
                     "assets/characters", "assets/scenes", "celeb-layer"):
            self.assertNotIn(gone, self.exp)

    def test_scan_and_report_sheets_are_shared(self):
        # One Shelf Scan component (hunt/Scan.tsx) for both modes, and
        # the same report sheet with the same kinds.
        hunt = frontend.src("screens/Hunt.tsx")
        for src in (hunt, self.exp):
            self.assertIn('import { ScanView', src)
            self.assertIn("<ScanView open={!!scan}", src)
            self.assertIn('id="spot-sheet"', src)
            self.assertIn('["wrong_aisle", "It is in a different aisle"]', src)
        scan = frontend.src("screens/hunt/Scan.tsx")
        for el in ("scan-overlay", "scan-photo"):
            self.assertIn(f'id="{el}"', scan)

    def test_chooser_says_what_express_keeps(self):
        mode = frontend.src("screens/Mode.tsx")
        self.assertIn("Your list in aisle order, with the same camera help.", mode)
        self.assertIn("No points.", mode)

    def test_client_wiring(self):
        # Show me toggles the photo; Not here? opens the moved sheet
        # (huntmenu.js movedSheet) with Find it for me; Teach Arya is
        # mapper.js mapperTeachNow.
        self.assertIn("onClick={() => setShow(v => !v)}", self.exp)
        self.assertIn("Can't find {{name}}?", self.exp)
        self.assertIn("findWithCamera(moved)", self.exp)
        self.assertIn('id="exp-teach" className="chip" type="button" onClick={teach}', self.exp)
        # Express repaints itself after a scan grab, a report or a withdraw.
        self.assertIn("Q.repaint = repaint;", self.exp)
        # The photo mounts only when asked, and the help row moves with
        # the next item instead of being rebuilt.
        self.assertIn("if (i === next) listChildren.push(helpRow);", self.exp)
        self.assertIn('driver={photos ? "photo" : "strip"}', self.exp)


class TestExpressFinish(unittest.TestCase):
    def test_score_is_plain(self):
        score = frontend.src("screens/Score.tsx")
        self.assertIn('const plain = sess.mode === "express";', score)
        self.assertIn("if (plain) profile = null;", score)
        # no friend challenge (and none at all while Race is hidden)
        self.assertIn("{SHOW_RACE && attached && !plain && (", score)
        self.assertIn('id="score-challenge"', score.split("{SHOW_RACE && attached && !plain && (")[-1])
        self.assertIn('t(plain ? "{{store}} — shopping done" : "{{store}} — quest finished"', score)
        # Receipt, haul card and haul share stay.
        self.assertIn("<ScoreRow sess={sess} attached={attached} />", score)
        self.assertIn("<HaulPhoto sess={sess} plain={plain}", score)
        self.assertIn('id="share-haul"', frontend.src("screens/score/HaulPhoto.tsx"))

    def test_album_button_is_quest_only(self):
        self.assertIn('{quest && <button className="btn" type="button" data-hl="album"',
                      frontend.src("screens/haul/ScoreRow.tsx"))

    def test_finish_hides_the_bonus_line(self):
        self.assertIn('id="fin-bonus" hidden={sess.mode === "express"}', frontend.src("screens/Finish.tsx"))


if __name__ == "__main__":
    unittest.main()
