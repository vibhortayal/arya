"""Hunt menu (hunt slice, 2026-10-28): string pins over the hunt
screen (web/src/screens/Hunt.tsx), the menu sheet (hunt/HuntMenu.tsx),
its logic (hunt/menu.ts), hunt.css and the copy.

The behaviour the old node harnesses ran against pwa/quest.js and
pwa/huntmenu.js runs under vitest beside the code:
- hunt/model.test.ts: the pure helpers, points, boss, combo, the
  offline outbox, Forgot something, substitutes, the toast duration,
  and the menu's mirrors of api/hunt.py on the shared fixture;
- hunt/hunt.test.tsx: the leave sheet, the row menu, Not here, Found
  it after all, the grab toast and events, the double tap, the rows.

One fixture, two implementations: web/src/screens/hunt/menu-cases.json
is read here by the server test and by model.test.ts for the mirrors."""
import json, os, re, tempfile, unittest

os.environ.setdefault("ARYA_DATA_DIR", tempfile.mkdtemp())

from tests import frontend

EMOJI = re.compile("[←-⇿☀-➿\U0001F000-\U0001FAFF]")
BANNED = ("lives", "game over", "timer", "streak", "hurry", "penalty", "retake",
          "try again", "incomplete", "last place", "failed", "verified",
          "cropped", "frame deleted")

with open(os.path.join(frontend.SRC, "screens", "hunt", "menu-cases.json"), encoding="utf-8") as _fh:
    CASES = json.load(_fh)


def read(name):
    return frontend.read(name)


def src(rel):
    return frontend.src(rel)


def hunt():
    return src("screens/Hunt.tsx")


def menu():
    return src("screens/hunt/HuntMenu.tsx") + "\n" + src("screens/hunt/menu.ts")


# --- one fixture, two implementations (api/hunt.py and hunt/menu.ts) -----------

def view(sess):
    return {"items": [[i["name"], i["qty"], bool(i.get("checked")), i.get("note", "")] for i in sess["items"]],
            "left": [[e["name"], e["how"], e["idx"]] for e in sess.get("left", [])],
            "added": [i["name"] for i in sess["items"] if i.get("added_mid_hunt")]}


class TestSharedFixtureServer(unittest.TestCase):
    def test_server_matches_the_fixture(self):
        import copy
        from api import hunt
        for case in CASES:
            sess = {"items": copy.deepcopy(case["items"]), "left": copy.deepcopy(case["left"])}
            a = case["args"]
            fn = {"leave": lambda: hunt.apply_leave(sess, a["entries"]),
                  "restore": lambda: hunt.apply_restore(sess, a["name"]),
                  "edit": lambda: hunt.apply_edit(sess, a["name"], a.get("qty"), a.get("note")),
                  "forgot": lambda: hunt.apply_forgot(sess, a["name"], a.get("qty", 1), a.get("note", ""))}[case["op"]]
            if case.get("error"):
                with self.assertRaises((ValueError, LookupError), msg=case["id"]):
                    fn()
                continue
            fn()
            got = view(sess)
            exp = case["expect"]
            self.assertEqual(got["items"], exp["items"], case["id"])
            self.assertEqual(got["left"], exp["left"], case["id"])
            if "added" in exp:
                self.assertEqual(got["added"], exp["added"], case["id"])


# --- shell and copy pins --------------------------------------------------------

class TestHuntMenuShell(unittest.TestCase):
    def test_stylesheets_load_in_order(self):
        main = src("main.tsx")
        self.assertLess(main.index('import "./styles/styles.css";'), main.index('import "./styles/hunt.css";'))

    def test_the_one_sheet_is_an_accessible_dialog(self):
        self.assertIn('<Sheet open onClose={close} id="hunt-sheet" labelledBy="hm-title"', src("screens/hunt/HuntMenu.tsx"))
        sheet = src("ui/Sheet.tsx")
        self.assertIn('role="dialog" aria-modal="true"', sheet)
        self.assertIn("if (!open) return null;", sheet)

    def test_hunt_view_new_surfaces(self):
        h = hunt()
        for el in ("hunt-combo", "hunt-left", "hunt-add", "hm-add-input", "hm-add-btn", "hm-add-mic", "hunt-timer"):
            self.assertIn(f'id="{el}"', h)
        self.assertLess(h.index('id="hunt-list"'), h.index('id="hunt-left"'))
        self.assertLess(h.index('id="hunt-left"'), h.index('id="hunt-add"'))
        self.assertLess(h.index('id="hunt-add"'), h.index('id="btn-finish"'))
        self.assertIn('<button id="btn-finish" className={stillOpen ? "btn secondary wide" : "btn primary wide"}', h)
        self.assertIn('<span aria-hidden="true">+ </span>Forgot something?', h)

    def test_row_markup_carries_every_action(self):
        h = hunt()
        row = h[h.index("const listRows = sess.items.map("):h.index("const left = sess.left || [];")]
        for pin in ("data-more={i}", "data-grab={i}", "data-putback={i}", "data-foundit={i}", "data-unfind={i}",
                    'aria-label="More for {{name}}"', "Found it after all", "Put back", "Golden", "Just added",
                    "findline"):
            self.assertIn(pin, row)
        # Design pass (2026-10-29): the check is the grab; its label
        # carries the quantity.
        self.assertIn('aria-label={qty ? "Grab {{qty}} {{name}}" : "Grab {{name}}"}', row)
        self.assertIn('className={"huntcheck', row)
        self.assertEqual(EMOJI.findall(row), [])

    def test_no_emoji_in_new_markup_and_scripts(self):
        for name, text in (("HuntMenu.tsx + menu.ts", menu()), ("hunt.css", read("hunt.css"))):
            self.assertEqual(EMOJI.findall(text), [], name)

    def test_sheet_keyboard_guard(self):
        # An open sheet owns the keys: the hunt's hotkeys stand down, a
        # key inside the sheet stops at the sheet, Esc closes it.
        self.assertIn('if (!Q.current || document.querySelector(".sheetwrap")) return;', hunt())
        sheet = src("ui/Sheet.tsx")
        self.assertIn("ev.stopPropagation();", sheet)
        self.assertIn('if (ev.key === "Escape") { close.current(); return; }', sheet)
        # The report path is explicit: moved sheet -> spot sheet only.
        self.assertNotIn("report-missing", menu())
        self.assertIn("onTell={idx => openSpot(idx)}", hunt())

    def test_copy_has_the_required_lines_and_no_banned_words(self):
        text = menu() + "\n" + hunt()
        for line in ("Leave {{n}} for next time?", "Nothing is lost. Saved items come first on your next trip.",
                     "Keep going", "Check out", "Next trip", "Drop", "Find it for me",
                     "Tell other Arya shoppers it is gone", "Keep looking", "Type my own",
                     "Your quantity carries over.", "is saved for next trip.", "Last seen:",
                     "Check the end caps too.", "Left for next time (", "Saved for next trip",
                     "Not needed today", "Bring back", "I'm done shopping", "Done. Add receipt",
                     "Change quantity or note", "Save for next trip", "Don't need it today", "Swap it", "It moved",
                     "already on the list, now x", "in your cart"):
            self.assertIn(line, text)
        for line in ("Welcome back. {{done}} of {{total}} in your cart.",
                     "Others couldn't find it on {{reports}} trips. Find it for +{{boss}}.",
                     "Nothing left to grab. Tap Done when you are ready.",
                     "No signal. Tap it again when you are back online."):
            self.assertIn(line, hunt())
        self.assertIn("left for next time at {{store}}.", src("screens/Finish.tsx"))
        low = menu().lower()
        for word in BANNED:
            if word in ("verified", "timer"):
                continue
            self.assertNotIn(word, low, word)
        row = hunt()[hunt().index("const listRows"):hunt().index("const left = sess.left || [];")].lower()
        self.assertNotIn("incomplete", row)

    def test_toast_close_button_and_live_region(self):
        t = src("ui/Toast.tsx")
        self.assertIn('className="toastclose" aria-label="Dismiss"', t)
        self.assertLess(t.index("{cur?.msg}"), t.index('className="toastact"'))
        self.assertIn("clearTimeout(timer.current)", t)
        self.assertIn("toastMs(msg, !!opts?.action)", t)
        self.assertIn('<div id="toast" role="status" aria-live="polite"', t)

    def test_hunt_css_rules(self):
        css = read("hunt.css")
        self.assertRegex(css, r"\.morebtn[^{]*\{[^}]*width: 44px; height: 44px")
        self.assertRegex(css, r"\.hunt-lead[^{]*\{[^}]*width: 44px; height: 44px")
        rowact = css.split(".rowact {")[1].split("}")[0]
        self.assertIn("min-width: 112px", rowact)
        self.assertIn("min-height: 44px", rowact)
        self.assertIn("white-space: normal", rowact)
        self.assertIn("#view-hunt .sub, #hunt-left .sub, .huntrow .sub { font-size: 15px; }", css)
        # chips are scoped to the hunt: no bare .chip rule leaks into other views
        self.assertIn("#view-hunt .toolbtn, .hchip, .hudbtn, #view-hunt .chip, #spot-sheet .chip, .hm-chip { min-height: 44px; }", css)
        self.assertNotRegex(css, r"(?m)(^|,\s*)\.chip\b")
        self.assertIn(".hunthud { flex-wrap: wrap;", css)
        self.assertRegex(css, r"\.hm-opt \{[^}]*min-height: 56px")
        self.assertRegex(css, r"\.hm-segbtn \{[^}]*min-height: 44px")
        self.assertRegex(css, r"\.toastclose \{[^}]*width: 44px; height: 44px")
        self.assertIn(".findline", css)
        self.assertIn(".hchip.combo", css)
        badge = css.split(".hunt-badge {")[1].split("}")[0]
        self.assertIn("font-size: 12px", badge)
        # tokens only: no gradients, no raw gold, no new hex colours
        code = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        self.assertNotIn("gradient", code)
        self.assertEqual(re.findall(r"#[0-9a-fA-F]{3,6}\b", code), [])
        # nothing under 15px except badges
        for size in re.findall(r"font-size: (\d+)px", code):
            if int(size) < 15:
                self.assertEqual(size, "12")

    def test_styles_css_is_not_edited_by_this_slice(self):
        self.assertNotIn("hm-opt", read("styles.css"))

    def test_doc_rows(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "..", "docs", "quest", "GAME-DESIGN.md"),
                  encoding="utf-8") as fh:
            doc = fh.read()
        self.assertIn("Combo: each grab of the suggested stop adds 1. It never resets and put back never lowers it.", doc)
        self.assertIn("+40, only when the boss item was grabbed", doc)
        self.assertIn("I'm done shopping works any time", doc)
        self.assertNotIn("Streak (3 grabs in 45 s)", doc)


class TestHuntMenuUnderVitest(unittest.TestCase):
    """The old node harnesses (QUEST_DRIVER, OUTBOX_DRIVER, MENU_DRIVER,
    MIRROR_DRIVER, the toastMs run), ported."""

    def test_model_and_menu_logic(self):
        t = src("screens/hunt/model.test.ts")
        self.assertIn('import CASES from "./menu-cases.json";', t)
        for name in ("one fixture, two implementations (api/hunt.py and hunt/menu.ts)",
                     "a reported row is handled, not open",
                     "an honest report never costs the full haul (mirrors social.hunt_points)",
                     "handled and total count what was left for next time",
                     "boss status and the boss points", "the combo is a count, never a clock",
                     "spotted lines pin the time and the shelf",
                     "hunt UI on the phone: the last six sessions, storage optional",
                     "toast duration: 60 ms a character, floors of 4 s and 7 s with an action",
                     "checks and hunt ops replay in order; an unknown op is dropped; no sticker survives",
                     "offline keeps the queue; one flush at a time; a grab waits for the replay",
                     "a refused entry fetches the hunt again; offline does not",
                     "parsed, added with Undo, and a merge says so",
                     "offline: applies on the phone, queues, and Undo cancels the queued add",
                     "online, the server's answer wins (a dictionary name can merge)",
                     "an added item that synced since: Undo removes it on the server",
                     "substitutes: history only, never on the hunt, this store first"):
            self.assertIn(name, t)

    def test_screen_behaviour(self):
        t = src("screens/hunt/hunt.test.tsx")
        for name in ("Done with items open asks first; Check out leaves them in one call, then Finish",
                     "reported rows alone do not ask; Done then opens Finish",
                     "the leave sheet lists reported rows too; Keep hunting changes nothing",
                     "Not here: the moved sheet first; nothing is reported until Tell",
                     "an unplaced stop says so; Find it for me aims the scan at it",
                     "a reported row's menu saves it for next trip or drops it, nothing else",
                     "Found it after all withdraws the report, then grabs",
                     "Found it after all with no signal says so calmly",
                     "the grab toast carries Undo, which puts the item back",
                     "a grab announces itself (arya:grabbed) and a put back too (arya:putback)",
                     "the combo: suggested grabs add one, put back never lowers it, out of order keeps it",
                     "a double tap posts one check and counts once",
                     "row markup: quantity, note, badges, the pinned finder line",
                     "the start card names the boss; the count includes what was left",
                     "a cold open with items in the cart says welcome back, once"):
            self.assertIn(name, t)
        self.assertIn("items left for next time are named; without them the wording stays",
                      src("screens/haul/haul.test.tsx"))


class TestBossConstantsAgree(unittest.TestCase):
    def test_client_and_server_boss_points_match(self):
        from api import social
        m = re.search(r"export const QPTS = \{[^}]*boss: (\d+)", src("screens/hunt/model.ts"))
        self.assertEqual(int(m.group(1)), social.POINTS_BOSS)

    def test_finish_opens_only_from_done_and_the_leave_sheet(self):
        self.assertEqual(hunt().count('nav.show("finish"'), 2)


if __name__ == "__main__":
    unittest.main()
