"""Hunt v2 (owner-approved wireframes + the rebuild plan,
2026-10-28): the hunt is one scrolling column — HUD, view switch,
a contained store view with ONE target, the tools row, the
suggested-next card with the one big GRAB, then the one list in
flow, where every row GRABs and a collected row puts back in
place. Collecting the last item never jumps to Finish; Back is a
stack. Express wears no game chrome: a small strip view and the
list, where each row is the check.

Shell pins cover the layout contract (web/src/screens/Hunt.tsx,
Express.tsx and the stylesheets). The behaviour the old node
harnesses ran against pwa/quest.js (list rows in route order,
GRAB/put back in place, any-order collect, the marker tap, the walk
and the manual hold, no automatic route into Finish, the Back stack,
a finished hunt opening on its Score) runs under vitest in
web/src/screens/hunt/hunt.test.tsx; the browser run is
web/e2e/hunt.e2e.mjs.
"""
import unittest

from tests import frontend


def read(name):
    """A front-end file by its old pwa/ name (stylesheets from
    web/src/styles, scene.js and the other static files from pwa/)."""
    return frontend.read(name)


def src(rel):
    return frontend.src(rel)


def section(text, start, end):
    return text.split(start)[1].split(end)[0]


def hunt():
    return src("screens/Hunt.tsx")


def hunt_jsx():
    """The hunt screen's markup: from its return to the sheets."""
    return section(hunt(), "return (\n    <>\n      <div className=\"hunthud\">", "<ScanView")


class TestHuntFrameShell(unittest.TestCase):
    def test_hunt_is_one_scrolling_column(self):
        h, css = hunt(), read("styles.css")
        order = ['className="hunthud"', 'id="scene-mount"', 'className="scenecap"',
                 'className="hunt-tools"', 'id="hunt-pop"', 'id="hunt-list"',
                 'id="btn-finish"']
        idx = [h.index(k) for k in order]
        self.assertEqual(idx, sorted(idx), "column order")
        self.assertIn('className="storeview"', h)
        for el in ("hunt-store", "hunt-timer", "hunt-count", "btn-pause",
                   "pop-body", "btn-collect", "hunt-done-note", "hunt-rail"):
            self.assertIn(f'id="{el}"', h)
        # The summoned list panel and the overlays are gone: the list
        # lives in flow, once.
        for gone in ("list-panel", "btn-listpanel", "hunt-upnext",
                     "hunt-route", "panel-items", "huntbottom"):
            self.assertNotIn(gone, hunt())
        # The tab bar is app chrome; it hides while hunting. The
        # column scrolls — the frame is no longer a fixed overlay.
        self.assertIn("nav.setChrome(false);", hunt())
        self.assertIn('document.body.classList.add("hunting");', hunt())
        self.assertIn("body.hunting #tabs", css)
        self.assertNotIn("position: fixed", css.split("#view-hunt.full")[1].split("}")[0])

    def test_store_view_shows_one_target(self):
        css = read("styles.css")
        for sel in (".storeview .photo-dot:not(.next)",
                    ".storeview .scene-stop:not(.next)",
                    ".storeview .strip-card:not(.next)"):
            self.assertIn(sel + " { display: none; }", css)
        box = css.split(".storeview {")[1].split("}")[0]
        self.assertIn("overflow: hidden", box)
        self.assertIn("height: 44vh", box)

    def test_cloud_view_shows_one_target(self):
        js = read("scene.js")
        cloud = js.split("function cloudView(")[1]
        self.assertIn('host.closest(".storeview")', cloud)
        self.assertIn("m.visible = !oneTarget || i === nextIdx;", cloud)
        # A hidden marker cannot be tapped.
        self.assertIn("markerGroup.children.filter(m => m.visible)", cloud)

    def test_tools_row_and_next_card(self):
        h, css = hunt_jsx(), read("styles.css")
        tools = section(h, 'className="hunt-tools"', '<div id="wild-form"')
        for el in ("btn-scan", "btn-locate", "btn-nothere"):
            self.assertIn(f'id="{el}"', tools)
        pop = section(h, 'id="hunt-pop"', 'id="hunt-done-note"')
        self.assertIn('id="btn-collect"', pop)
        self.assertIn("grabbtn", pop)
        self.assertIn("Suggested next", hunt())
        grab = css.split(".grabbtn {")[1].split("}")[0]
        self.assertIn("min-height: 60px", grab)  # >= the 56px brief

    def test_express_has_no_game_chrome(self):
        exp = src("screens/Express.tsx")
        for el in ("exp-mount", "exp-items", "exp-count", "exp-pause",
                   "exp-finish", "exp-store", "exp-rail"):
            self.assertIn(f'id="{el}"', exp)
        for gone in ("exp-grab", "exp-route", "exp-panel", "exp-listbtn",
                     "exp-upnext", "celeb-layer", "scene-toggle", "grabbtn"):
            self.assertNotIn(gone, exp)
        # Each Express row is the check: the whole row is a button.
        self.assertIn('<button key={"r:" + it.name} type="button" data-exp-check={it.name} aria-pressed={!!it.checked}', exp)
        self.assertIn('className={"row listrow exprow"', exp)

    def test_any_order_surfaces_present(self):
        model, h = src("screens/hunt/model.ts"), hunt()
        for fn in ("qCurrentIndex", "qRetarget", "qNextIndex"):
            self.assertIn(f"export function {fn}(", model)
        for fn in ("async function collectStop(", "function tapStop(", "async function putBackStop("):
            self.assertIn(fn, h)
        self.assertIn("data-grab={i}", h)
        self.assertIn("data-putback={i}", h)
        self.assertIn("onTapStop={tapStop}", h)

    def test_finish_is_never_automatic(self):
        h = hunt()
        # Finish is reached only from the deliberate Done button (its
        # handler) and the leave sheet's checkout: two calls, no more.
        self.assertEqual(h.count('nav.show("finish"'), 2)
        on_finish = section(h, "function onFinish()", "\n  }")
        self.assertIn('nav.show("finish", { session: s });', on_finish)
        self.assertIn("onClick={onFinish}", h)
        self.assertIn("onCheckout={onCheckout}", h)
        collect = section(h, "async function collectStop(", "\n  }")
        self.assertNotIn("finish", collect)
        exp = src("screens/Express.tsx")
        self.assertEqual(exp.count('nav.show("finish", { session: sess })'), 1)
        self.assertIn('id="exp-finish"', exp)
        self.assertIn("onClick={finish}", exp)

    def test_walk_and_presentation_logic_present(self):
        h = hunt()
        for fn in ("export function walkStart(", "export function walkStop(", "export function followHold("):
            self.assertIn(fn, h)
        walk = h.split("const WALK_MS")[1].split("}")[0]
        self.assertIn("quest: 3200", walk)
        self.assertIn("express: 2000", walk)
        self.assertIn("qOnCollected(name);", h)
        self.assertIn("export function qOnCollected(name", src("screens/hunt/fx.ts"))

    def test_finished_session_opens_its_score(self):
        h = hunt()
        self.assertIn('if (s0.state === "done" || s0.state === "finished") { nav.show("score", { session: s0 }); return; }', h)


class TestHuntBehaviourUnderVitest(unittest.TestCase):
    """The old DRIVER and DRIVER_ANYORDER node harnesses, ported."""

    def test_vitest_covers_the_harness_checks(self):
        t = src("screens/hunt/hunt.test.tsx")
        for name in ("rows in route order; GRAB on open rows, put back on collected rows",
                     "a paused hunt disables GRAB",
                     "grab stop 4 while 1 is current: only D checks, and the hunt aims past it",
                     "sequential play with the big GRAB is unchanged",
                     "put back: the same row, the count follows, no new walk",
                     "a marker tap presents a stop; a second tap grabs it; a checked stop is a no-op",
                     "Express keeps first-uncollected semantics",
                     "Done with all collected opens Finish; the last GRAB does not",
                     "a finished or closed hunt on the rail opens its Score",
                     "Express: rows toggle in any order, all checked stays on the run",
                     "travel, arrive, the manual hold, and leaving stops the walk",
                     "the hunt screen stops the walk when it closes"):
            self.assertIn(name, t)


class TestHuntMenuPins(unittest.TestCase):
    """Hunt slice (2026-10-28): the frame keeps its contract while the
    menu sits beside it. The behaviour lives in test_hunt_menu.py."""

    def test_menu_is_a_separate_module_and_the_frame_ids_survive(self):
        h = hunt()
        self.assertIn('import { HuntMenu, openItems, type MenuState } from "./hunt/HuntMenu";', h)
        for el in ("btn-finish", "btn-nothere", "btn-collect", "hunt-list"):
            self.assertIn(f'id="{el}"', h)
        self.assertIn('id="exp-finish"', src("screens/Express.tsx"))

    def test_model_stays_free_of_the_menu(self):
        model = src("screens/hunt/model.ts")
        self.assertNotIn("HuntMenu", model)
        self.assertNotIn("./menu", model)

    def test_combo_is_a_count_not_a_clock(self):
        fx = src("screens/hunt/fx.ts")
        self.assertIn("export function qComboAfter(", fx)
        for f in (fx, hunt(), src("screens/hunt/model.ts")):
            self.assertNotIn("COMBO_WINDOW", f)
            self.assertNotIn("45000", f)


if __name__ == "__main__":
    unittest.main()
