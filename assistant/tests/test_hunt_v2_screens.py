"""Hunt v2 screen pins (rebuild plan items 5-8, 2026-10-28): a
finished hunt is closed — Today's hero clears, the hunt shows once
under Finished, Profile counts finished and receipt-attached hunts
apart, and nothing on Finish, Score or the Add receipt sheet claims
the receipt was verified. Back is a stack, and the resume route
opens a finished hunt on its Score.
"""
import os, unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as f:
        return f.read()


def fn_body(js, name):
    return js.split(f"function {name}(")[1].split("\n}")[0]


class TestHuntV2Screens(unittest.TestCase):
    def test_labels_are_one_vocabulary(self):
        for name, var in (("quest.js", "QSTATE_LABEL"), ("app.js", "QSTATE_LBL")):
            js = read(name)
            table = js.split(f"{var} = {{")[1].split("}")[0]
            self.assertIn('"Finished · Receipt missing"', table, name)
            self.assertIn('"Finished · Receipt attached ✓"', table, name)

    def test_today_hero_clears_on_finish(self):
        js = read("app.js")
        hero = fn_body(js, "paintTodayHero")
        self.assertIn("No quest in progress", hero)
        self.assertIn("Nothing is waiting on you.", hero)
        # Only an open hunt can hold the hero.
        self.assertNotIn('"finished"', hero.split("No quest in progress")[0])
        games = fn_body(js, "paintTodayGames")
        self.assertIn('class="g-group">Finished</p>', games)

    def test_profile_counts_finished_and_attached_apart(self):
        js = read("app.js")
        self.assertIn(">Hunts finished<", js)
        self.assertIn(">Receipt attached<", js)
        self.assertIn("function paintMissingReceipts(", js)
        self.assertIn('id="pf-missing"', read("index.html"))

    def test_add_receipt_is_reachable_everywhere(self):
        js, app = read("quest.js"), read("app.js")
        self.assertIn("function openAddReceipt(", js)
        self.assertIn("score-addreceipt", fn_body(js, "openScore"))
        self.assertIn("openAddReceipt(up.dataset.upload", app)  # Receipts
        self.assertIn("openAddReceipt(", fn_body(app, "paintMissingReceipts"))  # Profile

    def test_copy_never_claims_verified(self):
        html, js = read("index.html"), read("quest.js")
        fin = html.split('id="view-finish"')[1].split('id="view-score"')[0]
        sheet = html.split('id="ar-sheet"')[1].split("</main>")[0]
        for name, text in (("finish", fin), ("sheet", sheet),
                           ("score", fn_body(js, "openScore")),
                           ("settle", fn_body(js, "qArSettle"))):
            self.assertNotIn("erified", text, name)

    def test_demo_doors_only_in_the_demo(self):
        html = read("index.html")
        for el in ("fin-sample", "ar-sample"):
            tag = html.split(f'id="{el}"')[0].rsplit("<p", 1)[1]
            self.assertIn("demo-only", tag, el)
            self.assertIn("hidden", tag, el)
        self.assertIn("/sample-receipt", fn_body(read("quest.js"), "qSample"))

    def test_back_is_a_stack(self):
        js = read("quest.js")
        back = fn_body(js, "questBack")
        self.assertIn('"view-hunt"', back)
        self.assertIn("openHunt(Q.current)", back)
        self.assertIn("openExpress(Q.current)", back)
        self.assertIn("‹ Back to the hunt", read("index.html"))

    def test_resume_opens_a_finished_hunt_on_score(self):
        body = fn_body(read("quest.js"), "qOpenSession")
        self.assertIn("openScore", body)
        self.assertIn('"finished"', body)


if __name__ == "__main__":
    unittest.main()
