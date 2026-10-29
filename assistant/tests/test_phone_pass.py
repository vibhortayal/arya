"""Owner phone-pass batch (2026-10-28): shell pins for the seven
fixes he called out walking the live app — store picker
tap-to-advance + receipts fold, skippable Check-the-list, character
popups off, the receipt-sheet button, Add folded into List, New
session on top, and the compact staples line. Behavior drives live
in the gate report; these pin the wiring so it cannot regress
silently. Pins over the React screens (web/src)."""
import unittest

from tests.frontend import read, src


class TestPhonePassBatch(unittest.TestCase):
    def test_store_picker_tap_advances_and_folds(self):
        js = src("screens/Store.tsx")
        self.assertNotIn('id="st-next"', js)
        # Receipt stores: top 3, the rest behind the fold.
        self.assertIn("const shown = histAll ? hist : hist.slice(0, 3);", js)
        self.assertIn("Show all {{histCount}} stores", js)
        self.assertIn('data-histall="1"', js)
        # The typed store starts the plan on Enter.
        self.assertIn('onKeyDown={ev => { if (ev.key === "Enter") { ev.preventDefault(); pickStore(name, selId); } }}', js)

    def test_check_the_list_is_skippable(self):
        js = src("screens/Optimize.tsx")
        self.assertIn('id="opt-skip"', js)
        # The way forward is never disabled; Skip shows while
        # questions remain, and unanswered means kept as typed.
        nxt = js.split('<button id="opt-next"')[1].split(">")[0]
        self.assertNotIn("disabled", nxt)
        self.assertIn('String(D.answers[q.item] || "typed")', js)
        self.assertIn('id="opt-skip" className="btn secondary wide" type="button" hidden={pending === 0} onClick={proceed}', js)
        # The question persists on the item: an ask-later set the
        # List rows read.
        self.assertIn('"arya-ask-later"', js)
        self.assertIn("export function askLaterHas(name: string)", src("screens/lists/model.ts"))
        self.assertIn("askLaterHas(i.name)", src("screens/Lists.tsx"))

    def test_receipt_button_takes_its_own_box(self):
        css = read("styles.css")
        btn = css.split(".btn {")[1].split("}")[0]
        self.assertIn("display: inline-flex", btn)

    def test_today_order_and_compact_line(self):
        quest = src("screens/Quest.tsx")
        # Your trips is history only: a new quest starts in Quest itself.
        self.assertNotIn('id="btn-new-hunt"', quest)
        # The Today line is a link to the lists, never a dump of names
        # (app.js staplesLine was a count only, and was no longer
        # called on main).
        today = src("screens/Today.tsx")
        line = today.split('id="today-listline"')[1].split("</button>")[0]
        self.assertIn('<span id="today-listline-text">Open Lists</span>', line)
        self.assertNotIn(".map(", line)

    def test_composer_on_list(self):
        js = src("screens/Lists.tsx")
        for el in ('id="add-text"', 'id="add-submit"', 'id="add-mic"',
                   'id="add-photo"', 'id="add-split"', 'id="list-eyes"'):
            self.assertIn(el, js)
        # The split preview + one-line Enter.
        self.assertIn("function splitPreview(text: string): string[]", js)
        self.assertIn("const items = splitPreview(text);", js)


if __name__ == "__main__":
    unittest.main()
