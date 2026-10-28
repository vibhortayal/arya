"""Owner phone-pass batch (2026-10-28): shell pins for the seven
fixes he called out walking the live app — store picker
tap-to-advance + receipts fold, skippable Check-the-list, character
popups off, the receipt-sheet button, Add folded into List, New
session on top, and the compact staples line. Behavior drives live
in the gate report; these pin the wiring so it cannot regress
silently."""
import os
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return f.read()


class TestPhonePassBatch(unittest.TestCase):
    def test_store_picker_tap_advances_and_folds(self):
        js, html = read("quest.js"), read("index.html")
        self.assertNotIn('id="st-next"', html)
        # Receipt stores: top 3, the rest behind the fold.
        self.assertIn("hist.slice(0, 3)", js)
        self.assertIn("Show all ${hist.length} stores", js)
        self.assertIn('closest("[data-histall]")', js)
        # The typed store starts the plan on Enter.
        self.assertIn('$("#st-name").addEventListener("keydown"', js)

    def test_check_the_list_is_skippable(self):
        js, html = read("quest.js"), read("index.html")
        self.assertIn('id="opt-skip"', html)
        # The way forward is never disabled; Skip shows while
        # questions remain, and unanswered means kept as typed.
        self.assertIn('$("#opt-next").disabled = false', js)
        self.assertIn('Q.draft.answers[q.item] || "typed"', js)
        self.assertIn('$("#opt-skip").addEventListener("click", qOptProceed)', js)
        # The question persists on the item: an ask-later set the
        # List rows read.
        self.assertIn('"arya-ask-later"', js)
        self.assertIn("window.qAskLaterHas", js)
        self.assertIn("qAskLaterHas(i.name)", read("app.js"))

    def test_receipt_button_takes_its_own_box(self):
        css = read("styles.css")
        btn = css.split(".btn {")[1].split("}")[0]
        self.assertIn("display: inline-flex", btn)

    def test_today_order_and_compact_line(self):
        html = read("index.html")
        home = html.split('id="view-home"')[1].split("</section>")[0]
        self.assertLess(home.index('id="btn-new-hunt"'),
                        home.index('id="quest-sessions"'))
        js = read("app.js")
        line = js.split("function staplesLine(")[1].split("\n}")[0]
        self.assertIn("staple", line)
        self.assertNotIn("items.map", line)  # no name dump

    def test_composer_on_list(self):
        js, html = read("app.js"), read("index.html")
        lst = html.split('id="view-list"')[1].split("</section>")[0]
        for el in ('id="add-text"', 'id="add-submit"', 'id="add-mic"',
                   'id="add-photo"', 'id="add-split"', 'id="list-eyes"'):
            self.assertIn(el, lst)
        # The split preview + one-line Enter, wired in bindAdd.
        self.assertIn("function paintAddSplit()", js)
        self.assertIn("splitPreview(field.value)", js)
        self.assertIn('field.dispatchEvent(new Event("input"))', js)


if __name__ == "__main__":
    unittest.main()
