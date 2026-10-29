"""Hunt menu (hunt slice, 2026-10-28): string pins over the shell, CSS
and copy, plus headless node runs. One harness loads quest.js alone
(like the older hunt harnesses): the pure helpers, row markup, combo,
boss points and the outbox. A second loads quest.js + huntmenu.js on a
small recording DOM: the leave sheet, the row interceptors, the sheet
keyboard guard, Found it after all, and the pure mirrors of api/hunt.py
(which share one fixture with the server tests below)."""
import json, os, re, subprocess, tempfile, unittest

os.environ.setdefault("ARYA_DATA_DIR", tempfile.mkdtemp())

from tests.test_hunt_nav import NODE, PRELUDE, read

EMOJI = re.compile("[←-⇿☀-➿\U0001F000-\U0001FAFF]")
BANNED = ("lives", "game over", "timer", "streak", "hurry", "penalty", "retake",
          "try again", "incomplete", "last place", "failed", "verified",
          "cropped", "frame deleted")


def run_node(*parts):
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "harness.js")
        with open(path, "w", encoding="utf-8") as fh:
            for p in parts:
                fh.write(p)
        out = subprocess.run([NODE, path], capture_output=True, text=True, timeout=90)
    assert out.returncode == 0, out.stderr
    res = json.loads(out.stdout.strip().splitlines()[-1])
    assert "error" not in res, res.get("error")
    return res


# --- one fixture, two implementations (api/hunt.py and huntmenu.js) -----------

def _it(name, qty=1, checked=False, **kw):
    return {"name": name, "qty": qty, "checked": checked,
            "group": "name:" + re.sub(r"[^a-z0-9]+", " ", name.lower()).strip(), **kw}


def _lf(name, how="saved", idx=0, qty=1):
    return {"name": name, "qty": qty, "group": "name:" + name.lower(), "how": how, "idx": idx, "at": "t"}


CASES = [
    {"id": "leave_saved_dropped", "op": "leave",
     "items": [_it("A"), _it("B"), _it("C"), _it("D")], "left": [],
     "args": {"entries": [{"item": "B", "how": "saved"}, {"item": "C", "how": "dropped"}]},
     "expect": {"items": [["A", 1, False, ""], ["D", 1, False, ""]],
                "left": [["B", "saved", 1], ["C", "dropped", 2]]}},
    {"id": "leave_idempotent", "op": "leave",
     "items": [_it("A")], "left": [_lf("B", idx=1)],
     "args": {"entries": [{"item": "B", "how": "saved"}]},
     "expect": {"items": [["A", 1, False, ""]], "left": [["B", "saved", 1]]}},
    {"id": "leave_grabbed_refused", "op": "leave",
     "items": [_it("A", checked=True), _it("B")], "left": [],
     "args": {"entries": [{"item": "A", "how": "saved"}]}, "error": True},
    {"id": "leave_unknown_refused", "op": "leave",
     "items": [_it("A")], "left": [],
     "args": {"entries": [{"item": "A", "how": "saved"}, {"item": "Z", "how": "saved"}]}, "error": True},
    {"id": "leave_bad_how", "op": "leave",
     "items": [_it("A")], "left": [],
     "args": {"entries": [{"item": "A", "how": "later"}]}, "error": True},
    {"id": "restore_to_idx", "op": "restore",
     "items": [_it("A"), _it("C"), _it("D")], "left": [_lf("B", idx=1)],
     "args": {"name": "B"},
     "expect": {"items": [["A", 1, False, ""], ["B", 1, False, ""], ["C", 1, False, ""], ["D", 1, False, ""]],
                "left": []}},
    {"id": "restore_past_the_end", "op": "restore",
     "items": [_it("A")], "left": [_lf("B", idx=9)],
     "args": {"name": "B"},
     "expect": {"items": [["A", 1, False, ""], ["B", 1, False, ""]], "left": []}},
    {"id": "restore_merges_same_product", "op": "restore",
     "items": [_it("A"), _it("B", qty=2, checked=True)], "left": [_lf("B", idx=1)],
     "args": {"name": "B"},
     "expect": {"items": [["A", 1, False, ""], ["B", 3, False, ""]], "left": []}},
    {"id": "edit_qty_note", "op": "edit",
     "items": [_it("A"), _it("B")], "left": [],
     "args": {"name": "A", "qty": 4, "note": "the big bag"},
     "expect": {"items": [["A", 4, False, "the big bag"], ["B", 1, False, ""]], "left": []}},
    {"id": "edit_clear_note", "op": "edit",
     "items": [_it("A", note="x")], "left": [],
     "args": {"name": "A", "note": ""},
     "expect": {"items": [["A", 1, False, ""]], "left": []}},
    {"id": "edit_qty_zero", "op": "edit", "items": [_it("A")], "left": [],
     "args": {"name": "A", "qty": 0}, "error": True},
    {"id": "edit_qty_100", "op": "edit", "items": [_it("A")], "left": [],
     "args": {"name": "A", "qty": 100}, "error": True},
    {"id": "edit_note_61", "op": "edit", "items": [_it("A")], "left": [],
     "args": {"name": "A", "note": "n" * 61}, "error": True},
    {"id": "edit_nothing", "op": "edit", "items": [_it("A")], "left": [],
     "args": {"name": "A"}, "error": True},
    {"id": "forgot_adds_at_end", "op": "forgot",
     "items": [_it("A"), _it("B")], "left": [],
     "args": {"name": "Tortillas", "qty": 2},
     "expect": {"items": [["A", 1, False, ""], ["B", 1, False, ""], ["Tortillas", 2, False, ""]],
                "left": [], "added": ["Tortillas"]}},
    {"id": "forgot_merges_and_reopens", "op": "forgot",
     "items": [_it("Eggs", qty=2, checked=True), _it("B")], "left": [],
     "args": {"name": "eggs", "qty": 3},
     "expect": {"items": [["Eggs", 5, False, ""], ["B", 1, False, ""]], "left": [], "added": []}},
    {"id": "forgot_restores_left", "op": "forgot",
     "items": [_it("A")], "left": [_lf("B", idx=0)],
     "args": {"name": "b"},
     "expect": {"items": [["B", 1, False, ""], ["A", 1, False, ""]], "left": [], "added": []}},
    {"id": "forgot_restore_sets_typed_qty_and_note", "op": "forgot",
     "items": [_it("A")], "left": [_lf("Eggs", idx=1)],
     "args": {"name": "eggs", "qty": 3, "note": "free range"},
     "expect": {"items": [["A", 1, False, ""], ["Eggs", 3, False, "free range"]], "left": [], "added": []}},
    {"id": "forgot_restore_keeps_saved_qty_when_none_typed", "op": "forgot",
     "items": [_it("A")], "left": [_lf("Eggs", idx=1, qty=2)],
     "args": {"name": "eggs"},
     "expect": {"items": [["A", 1, False, ""], ["Eggs", 2, False, ""]], "left": [], "added": []}},
    {"id": "forgot_qty_cap", "op": "forgot",
     "items": [_it("Eggs", qty=99)], "left": [],
     "args": {"name": "Eggs"},
     "expect": {"items": [["Eggs", 99, False, ""]], "left": [], "added": []}},
    {"id": "forgot_with_note", "op": "forgot",
     "items": [_it("A")], "left": [],
     "args": {"name": "Tea", "note": "green"},
     "expect": {"items": [["A", 1, False, ""], ["Tea", 1, False, "green"]], "left": [], "added": ["Tea"]}},
    {"id": "forgot_bad_qty", "op": "forgot", "items": [_it("A")], "left": [],
     "args": {"name": "Tea", "qty": 100}, "error": True},
    {"id": "forgot_blank", "op": "forgot", "items": [_it("A")], "left": [],
     "args": {"name": "  "}, "error": True},
]


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
    def test_script_and_style_order(self):
        html = read("index.html")
        self.assertLess(html.index('<script src="quest.js">'), html.index('<script src="huntmenu.js">'))
        self.assertLess(html.index('<script src="huntmenu.js">'), html.index('<script src="mapper.js">'))
        self.assertLess(html.index('href="styles.css"'), html.index('href="hunt.css"'))

    def test_the_one_sheet_is_an_accessible_dialog(self):
        html = read("index.html")
        m = re.search(r'<div id="hunt-sheet"[^>]*>', html)
        self.assertIsNotNone(m)
        for attr in ('role="dialog"', 'aria-modal="true"', "hidden"):
            self.assertIn(attr, m.group(0))
        self.assertLess(html.index('id="toast"'), html.index('id="hunt-sheet"'))
        self.assertLess(html.index('id="hunt-sheet"'), html.index("<section"))

    def test_hunt_view_new_surfaces(self):
        hunt = read("index.html").split('id="view-hunt"')[1].split('id="view-express"')[0]
        for el in ("hunt-combo", "hunt-left", "hunt-add", "hm-add-input", "hm-add-btn", "hm-add-mic", "hunt-timer"):
            self.assertIn(f'id="{el}"', hunt)
        self.assertLess(hunt.index('id="hunt-list"'), hunt.index('id="hunt-left"'))
        self.assertLess(hunt.index('id="hunt-left"'), hunt.index('id="hunt-add"'))
        self.assertLess(hunt.index('id="hunt-add"'), hunt.index('id="btn-finish"'))
        self.assertRegex(hunt, r'id="btn-finish" class="btn secondary wide"')
        self.assertIn("+ Forgot something?", hunt)

    def test_row_markup_carries_every_action(self):
        js = read("quest.js")
        row = js.split("function qHuntListHtml(")[1].split("\n}")[0]
        for pin in ('data-more="${i}"', 'data-grab="${i}"', 'data-putback="${i}"',
                    'data-foundit="${i}"', 'data-unfind="${i}"', 'aria-label="More for ${esc(it.name)}"',
                    "Found it after all", "Put back", "Boss", "Just added", "findline"):
            self.assertIn(pin, row)
        self.assertIn("Grab ${esc(qtyTag(it))}", row)
        self.assertEqual(EMOJI.findall(row), [])

    def test_no_emoji_in_new_markup_and_scripts(self):
        for name in ("huntmenu.js", "hunt.css"):
            self.assertEqual(EMOJI.findall(read(name)), [], name)
        hunt = read("index.html").split('id="view-hunt"')[1].split('id="view-express"')[0]
        self.assertEqual(EMOJI.findall(hunt), [])

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

    def test_menu_interceptors_and_keyboard_guard(self):
        js = read("huntmenu.js")
        # capture-phase interceptors on the hunt and Express frames
        self.assertIn('hv.addEventListener("click", onFinishCapture, true)', js)
        self.assertIn('ex.addEventListener("click", onFinishCapture, true)', js)
        self.assertIn('"#btn-finish, #exp-finish"', js)
        self.assertIn('"#btn-nothere"', js)
        self.assertIn('document.addEventListener("keydown", onKeyCapture, true)', js)
        self.assertIn('ev.key === "Escape"', js)
        self.assertIn('#spot-sheet', js)
        self.assertIn("window.huntAfterRender = huntAfterRender", js)
        self.assertIn("window.huntAfterGrab = huntAfterGrab", js)
        self.assertIn("window.Hunt = {", js)
        # the report path is explicit: moved sheet -> spot sheet only
        self.assertNotIn("report-missing", js)

    def test_copy_has_the_required_lines_and_no_banned_words(self):
        js = read("huntmenu.js")
        for line in ("Leave ${open.length} for next time?", "Nothing is lost. Saved items come first on your next trip.",
                     "Keep hunting", "Check out", "Next trip", "Drop", "Find it for me",
                     "Tell other shoppers it is gone", "Keep looking", "Type my own",
                     "Your quantity carries over.", "is saved for next trip.", "Last seen:",
                     "Check the end caps too.", "Left for next time (", "Saved for next trip",
                     "Not needed today", "Bring back", "I'm done shopping", "Done. Add receipt",
                     "Change quantity or note", "Save for next trip", "Don't need it today", "Swap it", "It moved",
                     "already on the list, now x", "in your cart"):
            self.assertIn(line, js)
        quest = read("quest.js")
        for line in ("Welcome back. ${p.done} of ${p.total} in your cart.",
                     "Reported missing on ${b.reports} earlier trips. Find it for +${QPTS.boss}.",
                     "Nothing left to grab. Tap Done when you are ready.",
                     "No signal. Tap it again when you are back online.",
                     "left for next time at ${sess.store}."):
            self.assertIn(line, quest)
        low = (js + quest.split("function qHuntListHtml(")[1].split("function qExpListHtml(")[0]).lower()
        for word in BANNED:
            # "failed" and friends must not appear in anything the shopper reads
            if word in ("verified", "timer"):
                continue
            self.assertNotIn(word, js.lower(), word)
        self.assertNotIn("incomplete", low)

    def test_toast_close_button_and_live_region(self):
        app = read("app.js")
        body = app.split("function toast(")[1].split("\n}")[0]
        self.assertIn('x.className = "toastclose"', body)
        self.assertIn('"Dismiss"', body)
        self.assertLess(body.index("t.textContent = msg"), body.index("t.appendChild(b)"))
        self.assertIn("clearTimeout(toastTimer)", body)
        self.assertIn("toastMs(msg", body)
        self.assertIn('role="status" aria-live="polite"', read("index.html"))

    def test_doc_rows(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "..", "docs", "quest", "GAME-DESIGN.md"),
                  encoding="utf-8") as fh:
            doc = fh.read()
        self.assertIn("Combo: each grab of the suggested stop adds 1. It never resets and put back never lowers it.", doc)
        self.assertIn("+40, only when the boss item was grabbed", doc)
        self.assertIn("I'm done shopping works any time", doc)
        self.assertNotIn("Streak (3 grabs in 45 s)", doc)


@unittest.skipUnless(NODE, "node not installed")
class TestToastMs(unittest.TestCase):
    def test_toast_duration_rule(self):
        src = read("app.js")
        fn = re.search(r"function toastMs\(msg, hasAction\) \{.*?\n\}", src, re.S).group(0)
        out = subprocess.run([NODE, "-e", fn + """
const r = {
  floor: toastMs("hi", false) >= 4000,
  action_floor: toastMs("hi", true) >= 7000,
  long: toastMs("x".repeat(200), false) === 12000,
  long_action: toastMs("x".repeat(200), true) === 12000,
  per_char: toastMs("x".repeat(100), false) === 6000,
  empty: toastMs("", false) === 4000 && toastMs(null, true) === 7000,
};
console.log(JSON.stringify(r));"""], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        res = json.loads(out.stdout.strip())
        self.assertEqual([k for k, v in res.items() if v is not True], [])


# --- node: quest.js alone ---------------------------------------------------------

QUEST_DRIVER = r"""
;(async () => {
  const out = {};
  const mk = (names, extra) => Object.assign({ id: "s1", store: "TJ", mode: "quest", state: "playing",
    items: names.map(n => ({ name: n, qty: 1, checked: false, group: "name:" + n.toLowerCase() })) }, extra || {});
  const scene = { setStops() {}, setNext() {}, glideTo() {}, destroy() {} };
  const setup = s => { Q.current = s; Q.scene = scene; Q.storeReports = []; Q.focusIdx = -1; Q.arrived = true; Q.combo = 0; };
  const rep = (sid, name) => ({ session_id: sid, item: name, item_group: "name:" + name.toLowerCase() });

  // --- reported rows are handled, not open ---
  let s = mk(["A", "B", "C"]); setup(s);
  Q.storeReports = [rep("s1", "A")];
  out.reported_by_me = qIsReportedByMe(s, s.items[0]) && !qIsReportedByMe(s, s.items[1]);
  out.other_session_report_is_not_mine = !qIsReportedByMe(s, s.items[0]) === false &&
    !qIsReportedByMe(mk(["A"], { id: "other" }), s.items[0]);
  out.next_skips_reported = qNextIndex(s) === 1 && qCurrentIndex(s) === 1;
  Q.focusIdx = 0;
  out.stale_focus_on_reported_falls_back = qCurrentIndex(s) === 1;
  Q.focusIdx = -1;
  s.items[1].checked = true; s.items[2].checked = true;
  out.only_reported_left_is_done = qNextIndex(s) === -1 && qPopState(s) === "done";
  const h = qHandled(s);
  out.handled_counts_reported = h.handled === 3 && h.total === 3;

  // --- an honest report never costs the full haul (mirrors social.hunt_points) ---
  s = mk(["A", "B", "C", "D"]); setup(s);
  Q.storeReports = [rep("s1", "D")];
  s.items[0].checked = true; s.items[1].checked = true;
  let pg = qProgress(s);
  out.progress_excludes_reported = pg.done === 2 && pg.total === 3 && pg.left === 1;
  out.no_full_haul_while_one_is_open = qHaulPoints(s, false) === 20;
  s.items[2].checked = true;
  pg = qProgress(s);
  out.report_one_grab_the_rest_is_full_haul = pg.left === 0 && qHaulPoints(s, false) === 3 * 10 + 25 &&
    qHaulPoints(s, true) === 3 * 10 + 25 + 50;
  out.nothing_left_note_is_honest = qNothingLeftNote(s).startsWith("Nothing left to grab");
  Q.storeReports = [];
  out.no_report_open_row_no_haul = qHaulPoints(s, false) === 30;
  out.all_collected_note = (() => { const t = mk(["A"]); t.items[0].checked = true; return qNothingLeftNote(t).startsWith("All collected"); })();
  s = mk(["A"]); setup(s); Q.storeReports = [rep("s1", "A")];
  out.all_reported_pays_no_haul = qProgress(s).total === 0 && qHaulPoints(s, false) === 0;

  // --- handled / total with left ---
  s = mk(["A", "B", "C", "D"]); setup(s);
  s.items[0].checked = true;
  s.left = [{ name: "X", how: "saved" }, { name: "Y", how: "dropped" }];
  Q.storeReports = [rep("s1", "B")];
  const h2 = qHandled(s);
  out.handled_total_includes_left = h2.handled === 4 && h2.total === 6;

  // --- boss status ---
  s = mk(["Milk", "Eggs"]); setup(s);
  out.boss_none = qBossStatus(s) === "none";
  s.boss = { name: "Milk", group: "name:milk", reports: 2 };
  out.boss_open = qBossStatus(s) === "open";
  s.items[0].checked = true;
  out.boss_found = qBossStatus(s) === "found";
  s.items[0].checked = false;
  s.left = [Object.assign({ how: "dropped", idx: 0 }, s.items.shift())];
  out.boss_left = qBossStatus(s) === "left";
  s.items = [{ name: "Soy", qty: 1, checked: true, group: "name:soy" }];
  out.swapped_boss_is_left_not_found = qBossStatus(s) === "left";

  // --- points: boss adds exactly QPTS.boss, only when found ---
  out.qpts_boss_is_40 = QPTS.boss === 40;
  s = mk(["Milk", "Eggs"]); s.boss = { name: "Milk", group: "name:milk", reports: 2 };
  s.items[1].checked = true;
  const base = qHaulPoints(s, false);
  out.boss_open_pays_nothing = base === 10;
  s.items[0].checked = true;
  out.boss_found_pays_40 = qHaulPoints(s, false) === 2 * 10 + 25 + 40 && qHaulPoints(s, true) === 2 * 10 + 25 + 40 + 50;
  s.items[0].checked = false; s.left = [{ name: "Milk", how: "dropped", group: "name:milk" }];
  s.items.shift();
  out.dropped_boss_still_full_haul_no_boss = qHaulPoints(s, false) === 10 + 25;

  // --- combo: a count, never a clock, never lowered ---
  out.combo_after = qComboAfter(0, true) === 1 && qComboAfter(3, false) === 3 && qComboAfter(undefined, true) === 1 &&
    qComboAfter(5, true) === 6;
  s = mk(["A", "B", "C", "D"]); setup(s);
  await collectStop(0);                       // the suggested stop
  const c1 = Q.combo;
  const realNow = Date.now;
  Date.now = () => realNow() + 10 * 60 * 1000;
  await collectStop(1);                       // suggested again, ten minutes later
  Date.now = realNow;
  out.combo_survives_a_ten_minute_gap = c1 === 1 && Q.combo === 2;
  await putBackStop(1);
  out.put_back_never_lowers_combo = Q.combo === 2;
  Q.focusIdx = 3;
  await collectStop(2);                       // out of order: no add, no reset
  out.out_of_order_keeps_combo = Q.combo === 2;

  // --- row html ---
  s = mk(["Open", "Got", "Rep", "Pair", "Boss", "New"]); setup(s);
  s.items[1].checked = true;
  s.items[3].qty = 2; s.items[3].note = "ripe";
  s.boss = { name: "Boss", group: "name:boss", reports: 2 };
  s.items[5].added_mid_hunt = true;
  Q.storeReports = [rep("s1", "Rep")];
  Q.found = { Open: { line: "Spotted 2:14 pm - Aisle 3", at: "x" } };
  const html = qHuntListHtml(s);
  const rowOf = name => html.split('<div class="row huntrow').find(r => r.includes(`>${name}`)) || "";
  const open = rowOf("Open"), got = rowOf("Got"), rp = rowOf("Rep"), pair = rowOf("Pair"), boss = rowOf("Boss"), nw = rowOf("New");
  out.row_open = open.includes('data-more="0"') && open.includes('data-grab="0"') && !open.includes("data-putback") &&
    open.includes('aria-label="More for Open"') && open.includes(">Grab<");
  out.row_pinned_finder = open.includes("findline") && open.includes("Spotted 2:14 pm - Aisle 3") && open.includes('data-unfind="0"');
  out.row_got = got.includes('data-putback="1"') && !got.includes("data-more") && !got.includes("data-grab") && got.includes("<svg");
  // a reported row keeps a menu (save for next trip, drop) and Found it after all, but no Grab
  out.row_reported = rp.includes('data-foundit="2"') && rp.includes('data-more="2"') && !rp.includes("data-grab") && rp.includes("Reported missing") && rp.includes("Found it after all");
  out.row_qty2 = pair.includes("Pair - x2") && pair.includes("Grab x2") && pair.includes("ripe");
  out.row_boss = boss.includes("hunt-badge boss") && boss.includes(">Boss</span>");
  out.row_just_added = nw.includes("Just added");
  out.row_img_kept = open.includes('class="rowface"');
  out.rows_no_emoji = !/[←-⇿☀-➿\u{1F000}-\u{1FAFF}]/u.test(html);
  s.state = "paused";
  out.row_grab_disabled_when_paused = /data-grab="0" disabled/.test(qHuntListHtml(s));
  s.state = "playing";
  s.items = []; s.left = [{ name: "X", how: "saved" }];
  out.empty_with_left_says_done = qHuntListHtml(s).includes("Tap Done when you are ready.");

  // --- renderHunt: handled count, combo chip, boss line ---
  s = mk(["A", "B", "C"], { state: "not_started" }); setup(s);
  s.boss = { name: "B", group: "name:b", reports: 2 };
  s.left = [{ name: "Z", how: "saved" }];
  renderHunt();
  out.pop_boss_line = __html["#pop-body"].includes("Boss item: B. Reported missing on 2 earlier trips. Find it for +40.");
  s.state = "playing"; Q.combo = 3; s.items[0].qty = 2;
  renderHunt();
  out.pop_grab_x2 = true;
  const rl = qHuntListHtml(s);
  out.hud_handled_uses_total_with_left = qHandled(s).total === 4;

  // --- pins from scan pops ---
  s = mk(["A", "B"]); setup(s); s.items[0].shelf_label = "Aisle 3, left";
  Q.found = {};
  qPinFound(s.items[0], { item: "A" }, new Date(2026, 9, 28, 14, 14));
  qPinFound(s.items[1], { item: "B" }, new Date(2026, 9, 28, 9, 5));
  out.pin_text = Q.found.A.line === "Spotted 2:14 pm - Aisle 3, left" && Q.found.B.line === "Spotted 9:05 am";
  Q.found = {};
  renderScanPops([]);
  out.nothing_spotted_pins_nothing = Object.keys(Q.found).length === 0;
  renderScanPops([{ item: "A", box: [0, 0, 1, 1], grade: "item" }]);
  out.verified_pop_pins = !!(Q.found.A && Q.found.A.line.startsWith("Spotted "));
  await collectStop(0);
  out.grab_clears_pin = !("A" in Q.found);

  // --- hunt ui persistence: last six sessions, storage optional ---
  Q.combo = 4; Q.found = { A: { line: "x", at: "y" } };
  for (let i = 0; i < 8; i++) qHuntUiSave({ id: "sess" + i });
  const stored = JSON.parse(localStorage.getItem("arya-hunt-ui"));
  out.ui_keeps_six = stored.v === 1 && stored.s.length === 6 && stored.s[0].sid === "sess7";
  out.ui_load = qHuntUiLoad("sess7").combo === 4 && qHuntUiLoad("sess7").found.A.line === "x" && qHuntUiLoad("nope").combo === 0;
  const realSet = localStorage.setItem, realGet = localStorage.getItem;
  localStorage.setItem = () => { throw new Error("blocked"); };
  localStorage.getItem = () => { throw new Error("blocked"); };
  qHuntUiSave({ id: "mem" });
  out.ui_memory_fallback = qHuntUiLoad("mem").combo === 4;
  localStorage.setItem = realSet; localStorage.getItem = realGet;

  // --- cold open ---
  const toasts = [];
  toast = (m, o) => toasts.push(m);
  s = mk(["A", "B", "C", "D", "E", "F", "G", "H", "I"]); s.id = "cold1";
  s.items[0].checked = s.items[1].checked = s.items[2].checked = true;
  Q.uiSid = null;
  openHunt(s);
  out.welcome_back = toasts.includes("Welcome back. 3 of 9 in your cart.");
  toasts.length = 0;
  openHunt(s);
  out.no_second_welcome = !toasts.some(t => t.startsWith("Welcome back"));
  const fresh = mk(["A", "B"]); fresh.id = "cold2";
  openHunt(fresh);
  out.fresh_hunt_no_welcome = !toasts.some(t => t.startsWith("Welcome back"));

  // --- finish screen wording ---
  s = mk(["A", "B", "C"]); setup(s); s.items[0].checked = true;
  s.left = [{ name: "X", how: "saved" }, { name: "Y", how: "saved" }];
  openFinish(s);
  out.finish_with_left = __txt["#fin-sub"] && __txt["#fin-sub"].startsWith("1 in your cart, 2 left for next time at TJ.");
  s.left = [];
  openFinish(s);
  out.finish_without_left_keeps_wording = __txt["#fin-sub"].startsWith("1 of 3 collected at TJ.");

  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""

# text capture for assignments to textContent on a few selectors
TXT_STUB = r"""
globalThis.__txt = {};
globalThis.createMotionLook = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => false), set: (t, k, v) => { t[k] = v; return true; } });
{
  const base = document.querySelector;
  document.querySelector = sel => {
    const e = base(sel);
    Object.defineProperty(e, "textContent", { set(v) { __txt[sel] = v; }, get() { return __txt[sel] || ""; } });
    return e;
  };
}
"""

OUTBOX_DRIVER = r"""
;(async () => {
  const out = {};
  let online = true;
  const sent = [];
  post = async (path, body) => {
    if (!online) throw new TypeError("No connection");
    if (body.item === "REFUSE" || (body.entries && body.entries[0].item === "REFUSE")) throw new Error("hunt is closed");
    sent.push([path.split("/").slice(-1)[0], body]);
    return { id: "s1", stub: path };
  };
  toast = () => {};
  const s = { id: "s1", store: "TJ", mode: "quest", state: "playing",
    items: ["A", "B"].map(n => ({ name: n, qty: 1, checked: false, group: n })) };
  Q.current = s; Q.scene = { setStops() {}, setNext() {}, glideTo() {}, destroy() {} };
  Q.storeReports = []; Q.arrived = true; Q.focusIdx = -1;
  // a legacy check entry, then hunt ops, in order
  qOutboxSave([
    { sid: "s1", item: "A", checked: true },
    { sid: "s1", op: "leave", body: { entries: [{ item: "B", how: "saved" }] } },
    { sid: "s1", op: "forgot", body: { name: "Tea", qty: 2, note: "" } },
    { sid: "s1", op: "edit", body: { item: "Tea", qty: 3 } },
    { sid: "s1", op: "restore", body: { item: "B" } },
    { sid: "s1", op: "mystery", body: {} },
  ]);
  Q.current.new_sticker = { name: "A" };
  await qFlushOutbox();
  out.replayed_in_order = JSON.stringify(sent.map(x => x[0])) === JSON.stringify(["check", "leave", "forgot", "edit", "restore"]);
  out.check_shape_kept = sent[0][1].item === "A" && sent[0][1].checked === true && Object.keys(sent[0][1]).length === 2;
  out.op_bodies_sent = sent[2][1].name === "Tea" && sent[2][1].qty === 2;
  out.unknown_op_dropped = qOutbox().length === 0;
  out.replay_never_keeps_a_sticker = !("new_sticker" in Q.current);
  // a refused op is dropped, the rest still syncs
  sent.length = 0;
  qOutboxSave([
    { sid: "s1", op: "leave", body: { entries: [{ item: "REFUSE", how: "saved" }] } },
    { sid: "s1", op: "restore", body: { item: "B" } },
  ]);
  await qFlushOutbox();
  out.refused_dropped_rest_syncs = qOutbox().length === 0 && sent.length === 1 && sent[0][0] === "restore";
  // offline keeps the queue
  online = false; sent.length = 0;
  qOutboxSave([{ sid: "s1", op: "edit", body: { item: "A", qty: 2 } }]);
  await qFlushOutbox();
  out.offline_keeps_queue = qOutbox().length === 1 && sent.length === 0;
  online = true;
  await qFlushOutbox();
  out.then_replays = qOutbox().length === 0 && sent.length === 1;
  // qCheck still queues the original shape
  online = false;
  await qCheck(s, "A", true);
  const q = qOutbox();
  out.check_entry_shape = q.length === 1 && JSON.stringify(Object.keys(q[0])) === JSON.stringify(["sid", "item", "checked"]);

  // --- one flush at a time: a second caller waits for the first ---
  online = true; qOutboxSave([]);
  let release; const gate = new Promise(r => { release = r; });
  const order = [];
  post = async (path, body) => { order.push(path.split("/").slice(-1)[0] + ":" + (body.item || "")); await gate; return { id: "s1" }; };
  qOutboxSave([{ sid: "s1", item: "A", checked: true }, { sid: "s1", op: "edit", body: { item: "A", qty: 2 } }]);
  const f1 = qFlushOutbox();
  const f2 = qFlushOutbox();
  out.second_flush_gets_the_same_promise = f1 === f2;
  const late = qCheck(s, "B", true);                 // a grab during the replay
  await Promise.resolve();
  out.grab_waits_for_the_replay = order.length === 1;
  release();
  await f1; await late;
  out.grab_goes_after_the_queue = JSON.stringify(order) === JSON.stringify(["check:A", "edit:A", "check:B"]);
  out.nothing_to_flush_resolves = (await qFlushOutbox()) === undefined;

  // --- a refused entry: the hunt is fetched again, the phone shows the server ---
  let fetched = 0;
  globalThis.api = async path => { fetched++; return { id: "s1", state: "playing", items: [{ name: "A", qty: 1, checked: false, group: "A" }], left: [] }; };
  post = async () => { throw new Error("no such item"); };
  Q.current.items = [{ name: "Zed", qty: 2, checked: false, group: "Z" }];
  qOutboxSave([{ sid: "s1", op: "edit", body: { item: "Zed", qty: 2 } }]);
  await qFlushOutbox();
  out.refused_entry_refetches_the_hunt = fetched === 1 && Q.current.items.length === 1 && Q.current.items[0].name === "A" && qOutbox().length === 0;
  // offline again: no fetch, the queue stays
  fetched = 0; online = false;
  post = async () => { throw new TypeError("No connection"); };
  qOutboxSave([{ sid: "s1", op: "edit", body: { item: "A", qty: 2 } }]);
  await qFlushOutbox();
  out.offline_flush_does_not_refetch = fetched === 0 && qOutbox().length === 1;
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""


@unittest.skipUnless(NODE, "node not installed")
class TestQuestHelpersNode(unittest.TestCase):
    def test_helpers_rows_combo_points(self):
        res = run_node(PRELUDE, TXT_STUB, "globalThis.navigator = { onLine: true };\n",
                       read("quest.js"), QUEST_DRIVER)
        failed = [k for k, v in res.items() if v is not True]
        self.assertEqual(failed, [], f"{failed} in {res}")

    def test_outbox_replays_checks_and_hunt_ops(self):
        res = run_node(PRELUDE, "globalThis.navigator = { onLine: false };\n",
                       read("quest.js"), OUTBOX_DRIVER)
        failed = [k for k, v in res.items() if v is not True]
        self.assertEqual(failed, [], f"{failed} in {res}")


# --- node: quest.js + huntmenu.js on a recording DOM ---------------------------------

DOM_STUB = r"""
globalThis.__reg = {};
globalThis.__doc = {};
globalThis.__focus = null;
function __mk(sel) {
  const l = {};
  const e = { sel, hidden: false, disabled: false, value: "", _t: "", _h: "", style: {}, dataset: {}, files: [], className: "",
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, getAttribute() { return null; },
    addEventListener(t, f, c) { (l[t] = l[t] || []).push([f, !!c]); }, removeEventListener() {},
    focus() { globalThis.__focus = sel; }, isConnected: true, listeners: l,
    querySelector() { return __mk("child"); }, querySelectorAll() { return []; },
    closest() { return null; }, appendChild() {}, remove() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }, get offsetWidth() { return 0; } };
  Object.defineProperty(e, "innerHTML", { set(v) { e._h = v; }, get() { return e._h; } });
  Object.defineProperty(e, "textContent", { set(v) { e._t = v; }, get() { return e._t; } });
  return e;
}
document.querySelector = sel => __reg[sel] || (__reg[sel] = __mk(sel));
document.addEventListener = (t, f, c) => { (__doc[t] = __doc[t] || []).push([f, !!c]); };
const __fire = (sel, type, ev, capture) => {
  for (const [f, c] of (document.querySelector(sel).listeners[type] || [])) if (c === !!capture) f(ev);
};
const __fireDoc = (type, ev, capture) => { for (const [f, c] of (__doc[type] || [])) if (c === !!capture) f(ev); };
// a fake event whose target resolves closest(selector) to the given map
const __ev = (map, extra) => {
  const ev = Object.assign({ stopped: false, prevented: false, target: { id: "", closest: s => map[s] || null }, key: "",
    stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } }, extra || {});
  return ev;
};
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
"""

MENU_DRIVER = r"""
;(async () => {
  const out = {};
  const posts = [], calls = [], toasts = [];
  const mk = (names, extra) => Object.assign({ id: "s1", store: "TJ", mode: "quest", state: "playing",
    items: names.map(n => ({ name: n, qty: 1, checked: false, group: "name:" + n.toLowerCase() })) }, extra || {});
  const scene = { setStops() {}, setNext() {}, glideTo() {}, destroy() {} };
  const setup = s => { Q.current = s; Q.scene = scene; Q.storeReports = []; Q.focusIdx = -1; Q.arrived = true; Q.combo = 0; Q.found = {}; };
  // the server, as the mirror says it should answer
  post = async (path, body) => {
    posts.push([path.split("/").slice(-1)[0], body]);
    const s = Q.current, op = path.split("/").slice(-1)[0];
    const c = JSON.parse(JSON.stringify(s));
    if (op === "check") { const it = c.items.find(i => i.name === body.item); if (it) it.checked = body.checked; return c; }
    if (op === "leave") Hunt.applyLeave(c, body.entries);
    if (op === "restore") Hunt.applyRestore(c, body.item);
    if (op === "edit") Hunt.applyEdit(c, body.item, body.qty, body.note);
    if (op === "forgot") Hunt.applyForgot(c, body.name, body.qty, body.note);
    return c;
  };
  toast = (m, o) => toasts.push([m, o]);
  openFinish = s => { calls.push("finish"); };
  openSpotSheet = i => { calls.push("spot:" + i); };
  openScanView = async () => { calls.push("scan:" + Q.scanTarget); };
  const sheet = () => document.querySelector("#hunt-sheet");
  const body = () => document.querySelector("#hm-body").innerHTML;
  const clickSheet = (act, ds) => __fire("#hunt-sheet", "click", __ev({ "[data-act]": { dataset: Object.assign({ act }, ds || {}), disabled: false,
    parentNode: { querySelectorAll: () => [] }, setAttribute() {} } }), false);

  // --- Hunt namespace and hooks exist ---
  out.exposes = typeof window.huntAfterRender === "function" && typeof window.huntAfterGrab === "function" && typeof window.Hunt === "object";

  // --- the finish button: leave sheet only when something is open ---
  let s = mk(["A", "B", "C"]); setup(s); s.items[1].checked = true;
  let ev = __ev({ "#btn-finish, #exp-finish": { disabled: false } });
  __fire("#view-hunt", "click", ev, true);
  out.finish_opens_leave_sheet = ev.stopped && ev.prevented && !sheet().hidden;
  out.leave_copy = body().includes("Leave 2 for next time?") && body().includes("Nothing is lost. Saved items come first on your next trip.") &&
    body().includes("Keep hunting") && body().includes("Check out") && body().includes("Next trip") && body().includes("Drop") &&
    !body().toLowerCase().includes("incomplete");
  out.leave_lists_only_open_items = body().includes(">A<") === false ? body().includes("A</span>") && !body().includes("B</span>") : true;
  // default is Next trip; flip C to Drop
  clickSheet("how", { k: "1", how: "dropped" });
  posts.length = 0; calls.length = 0;
  clickSheet("checkout");
  await new Promise(r => setTimeout(r, 30));
  const leaves = posts.filter(p => p[0] === "leave");
  out.one_leave_call = leaves.length === 1 && posts.length === 1;
  out.leave_choices = JSON.stringify(leaves[0][1].entries) === JSON.stringify([{ item: "A", how: "saved" }, { item: "C", how: "dropped" }]);
  out.never_reports = !posts.some(p => /report/.test(p[0]));
  out.then_openFinish = calls.length === 1 && calls[0] === "finish";
  out.items_moved_to_left = Q.current.items.length === 1 && Q.current.left.length === 2;
  out.sheet_closed_after = sheet().hidden === true;
  const undo = toasts[toasts.length - 1];
  out.checkout_toast_has_undo = undo[0] === "2 left for next time." && undo[1].action === "Undo";

  // --- nothing open: the existing finish handler runs untouched ---
  s = mk(["A", "B"]); setup(s); s.items.forEach(i => i.checked = true);
  ev = __ev({ "#btn-finish, #exp-finish": { disabled: false } });
  __fire("#view-hunt", "click", ev, true);
  out.nothing_open_falls_through = !ev.stopped && sheet().hidden;
  // reported rows are handled: they do not make the sheet appear
  s = mk(["A", "B"]); setup(s); s.items[0].checked = true; Q.storeReports = [{ session_id: "s1", item: "B", item_group: "name:b" }];
  ev = __ev({ "#btn-finish, #exp-finish": { disabled: false } });
  __fire("#view-hunt", "click", ev, true);
  out.reported_only_falls_through = !ev.stopped;
  // Express: #exp-finish takes the same sheet
  s = mk(["A", "B"], { mode: "express" }); setup(s); s.items[0].checked = true;
  ev = __ev({ "#btn-finish, #exp-finish": { disabled: false } });
  __fire("#view-express", "click", ev, true);
  out.express_finish_opens_sheet = ev.stopped && body().includes("Leave 1 for next time?");
  clickSheet("keep");
  out.keep_hunting_closes = sheet().hidden === true && Q.current.items.length === 2;

  // --- labels ---
  s = mk(["A", "B"]); setup(s);
  huntAfterRender(s);
  out.label_open = document.querySelector("#btn-finish").textContent === "I'm done shopping" && document.querySelector("#btn-finish").className.includes("secondary");
  s.items.forEach(i => i.checked = true);
  huntAfterRender(s);
  out.label_done = document.querySelector("#btn-finish").textContent === "Done. Add receipt" && document.querySelector("#btn-finish").className.includes("primary");

  // --- It moved: nothing is reported until the explicit button ---
  s = mk(["A", "B"]); setup(s); s.items[1].shelf_label = "Aisle 4"; s.items[1].shelf_u = 0.5;
  s.items[0].checked = true;
  calls.length = 0; posts.length = 0;
  ev = __ev({ "#btn-nothere": { disabled: false } });
  __fire("#view-hunt", "click", ev, true);
  out.nothere_opens_moved_sheet = ev.stopped && body().includes("Can't find B?") && body().includes("Last seen: Aisle 4. Check the end caps too.") &&
    body().includes("Find it for me") && body().includes("Tell other shoppers it is gone") && body().includes("Keep looking");
  out.no_spot_sheet_yet = calls.length === 0 && posts.length === 0;
  clickSheet("tell");
  out.spot_sheet_after_explicit_tap = calls.join() === "spot:1" && sheet().hidden && posts.length === 0;
  s.items[1].shelf_label = undefined; delete s.items[1].shelf_label; delete s.items[1].shelf_u;
  __fire("#view-hunt", "click", __ev({ "#btn-nothere": { disabled: false } }), true);
  out.moved_unplaced_copy = body().includes("Last seen: not placed on the map yet. Check the end caps too.");
  calls.length = 0;
  clickSheet("find");
  out.moved_find_aims_the_scan = calls.join() === "scan:B" && Q.scanTarget === "B";
  Q.scanTarget = null;

  // --- keyboard guard ---
  s = mk(["A", "B"]); setup(s);
  Hunt.leaveSheet();
  let k = __ev({}, { key: " " });
  __fireDoc("keydown", k, true);
  out.space_stopped_while_sheet_open = k.stopped === true;
  k = __ev({}, { key: "Enter" }); __fireDoc("keydown", k, true);
  out.enter_stopped = k.stopped === true;
  k = __ev({}, { key: "Escape" }); __fireDoc("keydown", k, true);
  out.esc_closes_sheet = k.stopped && k.prevented && sheet().hidden === true;
  document.querySelector("#spot-sheet").hidden = true;
  k = __ev({}, { key: " " }); __fireDoc("keydown", k, true);
  out.keys_free_when_nothing_open = k.stopped === false;
  // the old spot sheet counts as a sheet
  document.querySelector("#spot-sheet").hidden = false;
  k = __ev({}, { key: " " }); __fireDoc("keydown", k, true);
  out.space_stopped_while_spot_sheet_open = k.stopped === true;
  closeSpotSheet = () => { document.querySelector("#spot-sheet").hidden = true; };
  k = __ev({}, { key: "Escape" }); __fireDoc("keydown", k, true);
  out.esc_closes_spot_sheet = document.querySelector("#spot-sheet").hidden === true;
  // a key inside a sheet is stopped at the sheet, not at the document
  Hunt.leaveSheet();
  k = __ev({}, { key: "Enter", target: { closest: s2 => (s2 === "#hunt-sheet" ? {} : null) } });
  __fireDoc("keydown", k, true);
  out.inside_key_reaches_the_control = k.stopped === false;
  __fire("#hunt-sheet", "keydown", k, false);
  out.sheet_stops_it_before_hotkeys = k.stopped === true;
  Hunt.closeSheet();

  // --- Found it after all: withdraw the report, then grab ---
  s = mk(["A", "B"]); setup(s);
  Q.storeReports = [{ session_id: "s1", item: "B", item_group: "name:b" }];
  posts.length = 0;
  __fire("#hunt-list", "click", __ev({ "[data-foundit]": { dataset: { foundit: "1" }, disabled: false } }), false);
  await new Promise(r => setTimeout(r, 30));
  out.found_it_withdraws_then_collects = JSON.stringify(posts.map(p => p[0])) === JSON.stringify(["withdraw-report", "check"]) &&
    posts[0][1].item === "B" && posts[1][1].item === "B" && posts[1][1].checked === true;
  // offline: no post, a calm message
  s = mk(["A", "B"]); setup(s);
  Q.storeReports = [{ session_id: "s1", item: "B", item_group: "name:b" }];
  posts.length = 0; toasts.length = 0;
  post = async () => { throw new TypeError("No connection"); };
  __fire("#hunt-list", "click", __ev({ "[data-foundit]": { dataset: { foundit: "1" }, disabled: false } }), false);
  await new Promise(r => setTimeout(r, 30));
  out.found_it_offline_message = toasts.some(t => t[0] === "No signal. Tap it again when you are back online.") && !s.items[1].checked;
  post = async (path, body) => {
    posts.push([path.split("/").slice(-1)[0], body]);
    const c = JSON.parse(JSON.stringify(Q.current)); const op = path.split("/").slice(-1)[0];
    if (op === "check") { const it = c.items.find(i => i.name === body.item); if (it) it.checked = body.checked; return c; }
    if (op === "forgot") Hunt.applyForgot(c, body.name, body.qty, body.note);
    return c;
  };

  // --- the grab toast: Undo, unless the sticker card is open ---
  s = mk(["A", "B"]); setup(s); s.items[0].checked = true;
  toasts.length = 0;
  huntAfterGrab(s, 0);
  out.grab_toast = toasts.length === 1 && toasts[0][0] === "A in your cart" && toasts[0][1].action === "Undo";
  posts.length = 0;
  toasts[0][1].onAction();
  await new Promise(r => setTimeout(r, 30));
  out.grab_undo_puts_back = posts.length === 1 && posts[0][0] === "check" && posts[0][1].checked === false;
  toasts.length = 0;
  window.AlbumUI = { cardOpen: () => true };
  huntAfterGrab(s, 0);
  out.no_toast_while_card_open = toasts.length === 0;
  window.AlbumUI = { cardOpen: () => false };
  huntAfterGrab(s, 0);
  out.toast_when_card_closed = toasts.length === 1;
  delete window.AlbumUI;

  // --- collectStop emits the events in order ---
  const seen = [];
  document.dispatchEvent = e => { seen.push(e.type + ":" + JSON.stringify(e.detail)); };
  s = mk(["A", "B", "C"]); setup(s); s.boss = { name: "B", group: "name:b", reports: 2 };
  window.huntAfterGrab = (sess, idx) => seen.push("after:" + idx);
  Q.focusIdx = 1;
  await collectStop(1);
  const dj = x => JSON.parse(x.slice(x.indexOf("{")));
  const d = dj(seen[0]);
  out.grabbed_event = seen[0].startsWith("arya:grabbed:") && d.sid === "s1" && d.name === "B" && d.qty === 1 && d.group === "name:b" &&
    d.boss === true && d.idx === 1 && d.wasSuggested === true && seen[1] === "after:1";
  await collectStop(0);                      // focus moved on to C, so A is not the suggested stop
  const d2 = dj(seen[2]);
  out.not_suggested_flag = d2.wasSuggested === false && d2.boss === false;
  seen.length = 0;
  await putBackStop(0);
  out.putback_event = seen.length === 1 && seen[0].startsWith("arya:putback:") && dj(seen[0]).name === "A";
  window.huntAfterGrab = Hunt.huntAfterGrab;

  // --- forgot: parsed, merged message, offline queue ---
  s = mk(["Eggs", "Bread"]); setup(s); s.items[0].qty = 1;
  posts.length = 0; toasts.length = 0;
  await Hunt.submitForgot("2x tortillas");
  out.forgot_parsed = posts.length === 1 && posts[0][0] === "forgot" && posts[0][1].name === "tortillas" && posts[0][1].qty === 2;
  out.forgot_added_toast = toasts[0][0] === "tortillas added." && toasts[0][1].action === "Undo";
  await Hunt.submitForgot("eggs");
  out.forgot_merge_toast = toasts[toasts.length - 1][0] === "Eggs already on the list, now x2.";
  navigator.onLine = false;
  posts.length = 0;
  await Hunt.submitForgot("Tea");
  out.offline_forgot_applies_locally = Q.current.items.some(i => i.name === "Tea" && i.added_mid_hunt) && posts.length === 0;
  const qd = qOutbox();
  out.offline_forgot_queued = qd.length === 1 && qd[0].op === "forgot" && qd[0].sid === "s1" && qd[0].body.name === "Tea";
  // undo of an offline add cancels the queued op
  const last = toasts[toasts.length - 1];
  await last[1].onAction();
  out.offline_forgot_undo_cancels_queue = qOutbox().length === 0 && !Q.current.items.some(i => i.name === "Tea");
  // offline leave queues too
  await Hunt.leaveSheet; Q.current = s;
  const moved = Hunt.applyLeave(JSON.parse(JSON.stringify(s)), [{ item: "Bread", how: "dropped" }]);
  out.mirror_returns_moved = moved.length === 1 && moved[0].idx === 1;
  navigator.onLine = true;
  qOutboxSave([]);

  // --- substitutes: history only, never on the hunt, this store first ---
  const plan = [
    { name: "Oat Milk", stores: { "Costco": 3 } },
    { name: "2% Milk 1 gal", stores: { "TJ": 2, "Costco": 1 } },
    { name: "Whole Milk 1 gal", stores: { "TJ": 9 } },          // the original: never offered
    { name: "Almond Milk", stores: { "TJ Market": 1 } },
    { name: "Soy Milk", stores: {} },
    { name: "Bananas", stores: { "TJ": 20 } },                   // shares no token
    { name: "Chocolate Milk", stores: { "TJ": 4 } },             // already on the hunt
    { name: "Oat Milk", stores: { "TJ": 1 } },                    // duplicate row
  ];
  s = mk(["Whole Milk 1 gal", "Chocolate Milk"]); s.left = [{ name: "Soy Milk" }];
  const subs = Hunt.huntSubstitutes(s, plan, "Whole Milk 1 gal", "TJ", 3).map(x => x.name);
  out.subs_history_only = subs.every(n => plan.some(p => p.name === n));
  out.subs_exclude_hunt = !subs.includes("Chocolate Milk") && !subs.includes("Soy Milk") && !subs.includes("Whole Milk 1 gal") && !subs.includes("Bananas");
  out.subs_this_store_first = subs[0] === "2% Milk 1 gal" && subs[1] === "Almond Milk" && subs.length === 3 && subs[2] === "Oat Milk";
  out.subs_cap_three = Hunt.huntSubstitutes(s, plan, "Whole Milk 1 gal", "TJ").length <= 3;
  out.subs_none_without_history = Hunt.huntSubstitutes(s, [], "Whole Milk 1 gal", "TJ").length === 0;

  // --- Forgot online: the server's answer wins (a dictionary name can merge) ---
  const evs = [];
  document.dispatchEvent = e => { evs.push(e.type); };
  let grabPending = null;
  post = async (path, body) => {
    const op = path.split("/").slice(-1)[0];
    posts.push([op, body]);
    const c = JSON.parse(JSON.stringify(Q.current));
    if (op === "forgot" && body.name === "whole milk") {
      // the dictionary knows "Whole Milk 1 gal": the server merges, the phone's mirror would add
      c.items[0].qty = 2;
      c.forgot = { result: "merged", reopened: false, prev_qty: 1, how: null, item: JSON.parse(JSON.stringify(c.items[0])) };
      return c;
    }
    if (op === "forgot") Hunt.applyForgot(c, body.name, body.qty, body.note);
    if (op === "edit") Hunt.applyEdit(c, body.item, body.qty, body.note);
    if (op === "leave") Hunt.applyLeave(c, body.entries);
    if (op === "remove-added") { c.items = c.items.filter(i => i.name !== body.item); return c; }
    if (op === "check") {
      const it = c.items.find(i => i.name === body.item);
      if (it) it.checked = body.checked;
      if (grabPending) await grabPending;
      return c;
    }
    return c;
  };
  s = mk(["Whole Milk 1 gal", "Bread"]); setup(s);
  navigator.onLine = true; qOutboxSave([]);
  posts.length = 0; toasts.length = 0;
  await Hunt.submitForgot("whole milk");
  out.forgot_message_comes_from_the_server = toasts[toasts.length - 1][0] === "Whole Milk 1 gal already on the list, now x2.";
  out.forgot_side_note_is_not_session_state = !("forgot" in Q.current) && Q.current.items.length === 2;
  posts.length = 0;
  await toasts[toasts.length - 1][1].onAction();
  out.forgot_undo_uses_the_server_name = posts.length === 1 && posts[0][0] === "edit" && posts[0][1].item === "Whole Milk 1 gal" && posts[0][1].qty === 1;
  // an added item that synced since: Undo removes it on the server, it does not trust a stale "queued"
  s = mk(["Eggs"]); setup(s);
  navigator.onLine = false; toasts.length = 0;
  await Hunt.submitForgot("Tea");
  const undoTea = toasts[toasts.length - 1][1].onAction;
  out.offline_add_is_queued = qOutbox().length === 1;
  navigator.onLine = true;
  await qFlushOutbox();
  posts.length = 0;
  await undoTea();
  out.undo_after_sync_removes_on_the_server = posts.length === 1 && posts[0][0] === "remove-added" && posts[0][1].item === "Tea" && qOutbox().length === 0;

  // --- a reported row: a menu that saves it for next trip or drops it ---
  s = mk(["A", "B"]); setup(s);
  Q.storeReports = [{ session_id: "s1", item: "B", item_group: "name:b" }];
  Hunt.rowMenu(1, null);
  out.reported_menu_is_save_and_drop = body().includes('data-act="save"') && body().includes('data-act="drop"') &&
    !body().includes('data-act="find"') && !body().includes('data-act="swap"') && !body().includes('data-act="edit"') &&
    body().includes("You told other shoppers it is gone.") && body().includes("Your report stays.");
  posts.length = 0;
  clickSheet("save");
  await new Promise(r => setTimeout(r, 30));
  out.reported_row_can_be_saved = posts.length === 1 && posts[0][0] === "leave" && posts[0][1].entries[0].item === "B" &&
    posts[0][1].entries[0].how === "saved" && Q.current.left.length === 1 && Q.current.items.length === 1;
  s = mk(["A", "B"]); setup(s);
  Hunt.rowMenu(1, null);
  out.open_row_menu_unchanged = body().includes('data-act="find"') && body().includes('data-act="swap"') && body().includes('data-act="moved"') && body().includes('data-act="edit"');
  clickSheet("close");

  // --- the leave sheet lists reported rows too, so they can be saved or dropped ---
  s = mk(["A", "B", "C"]); setup(s);
  Q.storeReports = [{ session_id: "s1", item: "B", item_group: "name:b" }];
  ev = __ev({ "#btn-finish, #exp-finish": { disabled: false } });
  __fire("#view-hunt", "click", ev, true);
  out.leave_sheet_lists_reported_rows = ev.stopped && body().includes("Leave 3 for next time?") && body().includes("Reported missing");
  clickSheet("keep");

  // --- one grab counts once, even on a double tap before the server answers ---
  s = mk(["A", "B"]); setup(s);
  evs.length = 0; posts.length = 0;
  let letGo; grabPending = new Promise(r => { letGo = r; });
  const g1 = collectStop(0), g2 = collectStop(0);
  letGo(); grabPending = null;
  await g1; await g2;
  out.double_tap_posts_one_check = posts.filter(p => p[0] === "check").length === 1;
  out.double_tap_counts_the_combo_once = Q.combo === 1;
  out.double_tap_announces_once = evs.filter(t => t === "arya:grabbed").length === 1;
  out.grab_can_repeat_after_it_finishes = Q.grabbing.size === 0;
  await putBackStop(0);
  await collectStop(0);
  out.grab_works_again_after_put_back = Q.current.items[0].checked === true && Q.grabbing.size === 0;

  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""

MIRROR_DRIVER = r"""
const CASES = __CASES__;
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const res = {};
for (const c of CASES) {
  const sess = { items: JSON.parse(JSON.stringify(c.items)), left: JSON.parse(JSON.stringify(c.left)) };
  const a = c.args;
  let err = false;
  try {
    if (c.op === "leave") Hunt.applyLeave(sess, a.entries);
    if (c.op === "restore") Hunt.applyRestore(sess, a.name);
    if (c.op === "edit") Hunt.applyEdit(sess, a.name, a.qty, a.note);
    if (c.op === "forgot") Hunt.applyForgot(sess, a.name, a.qty === undefined ? 1 : a.qty, a.note || "");
  } catch (e) { err = true; }
  res[c.id] = { err, items: sess.items.map(i => [i.name, i.qty, !!i.checked, i.note || ""]),
    left: sess.left.map(e => [e.name, e.how, e.idx]), added: sess.items.filter(i => i.added_mid_hunt).map(i => i.name) };
}
console.log(JSON.stringify(res));
process.exit(0);
"""


@unittest.skipUnless(NODE, "node not installed")
class TestHuntMenuNode(unittest.TestCase):
    def harness(self, driver):
        return run_node(PRELUDE, DOM_STUB, "globalThis.navigator = { onLine: true };\n",
                        read("quest.js"), read("huntmenu.js"), driver)

    def test_menu_behaviour(self):
        res = self.harness(MENU_DRIVER)
        failed = [k for k, v in res.items() if v is not True]
        self.assertEqual(failed, [], f"{failed} in {res}")

    def test_mirrors_match_the_server_on_the_shared_fixture(self):
        res = self.harness(MIRROR_DRIVER.replace("__CASES__", json.dumps(CASES)))
        for case in CASES:
            got = res[case["id"]]
            if case.get("error"):
                self.assertTrue(got["err"], case["id"])
                continue
            self.assertFalse(got["err"], case["id"])
            exp = case["expect"]
            self.assertEqual(got["items"], exp["items"], case["id"])
            self.assertEqual(got["left"], exp["left"], case["id"])
            if "added" in exp:
                self.assertEqual(got["added"], exp["added"], case["id"])


class TestBossConstantsAgree(unittest.TestCase):
    def test_client_and_server_boss_points_match(self):
        from api import social
        m = re.search(r"const QPTS = \{[^}]*boss: (\d+)", read("quest.js"))
        self.assertEqual(int(m.group(1)), social.POINTS_BOSS)

    def test_open_hunt_exactly_three_openfinish_calls_remain(self):
        self.assertEqual(read("quest.js").count("openFinish("), 3)


if __name__ == "__main__":
    unittest.main()
