"""Navigation-first hunt (Discussion 35 + 36): the hunt screen is
the store — full-screen portrait, an up-next overlay with the next
3 stops, route progress along the bottom, and the arrival pop with
the one big GRAB for the current stop. Express wears the same
frame without the game.

Shell pins cover the frame (full-viewport CSS, tab bar hidden
while hunting, pop/overlay markup, GRAB target size). Behavior is
pinned headless under node (skipped when node is absent): the
route strip and up-next present stops in route order with no scene
interaction, GRAB collects exactly the current stop, the walk
arrives after its interval, manual navigation holds it, and
leaving the frame stops it. Discussion 44 adds the any-order
driver: every stop collects from the rail or its marker, and
the hunt re-targets after each grab.
"""
import json, os, re, shutil, subprocess, tempfile, unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")
NODE = shutil.which("node")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


def section(html, start, end):
    return html.split(start)[1].split(end)[0]


class TestHuntFrameShell(unittest.TestCase):
    def test_hunt_is_full_screen_with_overlays(self):
        html, css = read("index.html"), read("styles.css")
        hunt = section(html, 'id="view-hunt"', 'id="view-express"')
        for el in ("scene-mount", "hunt-upnext", "hunt-pop", "pop-body",
                   "hunt-route", "hunt-count", "list-panel"):
            self.assertIn(f'id="{el}"', hunt)
        # Corner controls: pause, trip/list, finish — small, top-right.
        for el in ("btn-pause", "btn-listpanel", "btn-finish"):
            tag = re.search(rf'<button[^>]*id="{el}"[^>]*>', hunt)
            self.assertIsNotNone(tag, el)
            self.assertIn("cornerbtn", tag.group(0))
        # The tab bar is app chrome; it never lives inside the hunt,
        # and the frame CSS hides it while hunting.
        self.assertNotIn('id="tabs"', hunt)
        self.assertIn("#view-hunt.full", css)
        self.assertIn("position: fixed", css.split("#view-hunt.full")[1].split("}")[0])
        self.assertIn("body.hunting #tabs", css)
        # The scene fills the frame, not a 46vh box.
        self.assertIn(".full .cloud-wrap", css)
        self.assertIn("height: 100%", css.split(".full .cloud-wrap")[1].split("}")[0])

    def test_pop_carries_the_one_big_grab(self):
        html, css = read("index.html"), read("styles.css")
        hunt = section(html, 'id="view-hunt"', 'id="view-express"')
        pop = section(hunt, 'id="hunt-pop"', 'class="huntbottom"')
        self.assertIn('id="btn-collect"', pop)
        self.assertIn("grabbtn", pop)
        # Not here stays reachable, inside the pop, under the GRAB.
        self.assertIn('id="btn-nothere"', pop)
        self.assertLess(pop.index('id="btn-collect"'), pop.index('id="btn-nothere"'))
        grab = css.split(".grabbtn")[1].split("}")[0]
        self.assertIn("min-height: 60px", grab)  # >= the 56px brief

    def test_trip_panel_holds_rail_and_view_switch(self):
        html = read("index.html")
        hunt = section(html, 'id="view-hunt"', 'id="view-express"')
        panel = section(hunt, 'id="list-panel"', "</section>")
        self.assertIn('id="hunt-rail"', panel)
        self.assertIn('id="scene-toggle"', panel)
        self.assertIn('id="panel-items"', panel)

    def test_express_wears_the_same_frame(self):
        html = read("index.html")
        exp = section(html, 'id="view-express"', 'id="view-finish"')
        for el in ("exp-mount", "exp-upnext", "exp-pop", "exp-grab",
                   "exp-route", "exp-count", "exp-panel", "exp-items",
                   "exp-pause", "exp-finish", "exp-listbtn"):
            self.assertIn(f'id="{el}"', exp)
        self.assertIn("grabbtn", exp)
        css = read("styles.css")
        self.assertIn("#view-express.full", css)

    def test_any_order_surfaces_present(self):
        js = read("quest.js")
        for fn in ("qCurrentIndex", "qRetarget", "collectStop", "qTapStop"):
            self.assertIn(f"function {fn}(", js)
        # Every rail row in a hunt carries its own GRAB; marker
        # taps route through qTapStop, not just the current stop.
        self.assertIn('data-up-grab="${i}"', js)
        self.assertIn("onTapStop = idx => qTapStop(idx)", js)
        css = read("styles.css")
        self.assertIn(".up-grab", css)

    def test_walk_and_presentation_logic_present(self):
        js = read("quest.js")
        for fn in ("qRouteStripHtml", "qUpNextHtml", "qPopState",
                   "qWalkStart", "qWalkStop", "qFollowHold"):
            self.assertIn(f"function {fn}(", js)
        # Express advances faster than Quest.
        walk = js.split("const WALK_MS")[1].split("}")[0]
        self.assertIn("quest: 3200", walk)
        self.assertIn("express: 2000", walk)
        # The celebration hook has exactly one home: the collect path.
        self.assertIn("qOnCollected(name);", js)
        self.assertIn("function qOnCollected(name)", js)
        # The walk presents stops in route order from the session —
        # up-next is the next 3 unchecked, route strip is items order.
        self.assertIn("rows.length < 3", js)
        self.assertIn("sess.items.map((it, i)", js)


PRELUDE = r"""
function __el() {
  return {
    hidden: false, disabled: false, value: "", textContent: "", innerHTML: "",
    style: {}, dataset: {}, files: [],
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return __el(); }, querySelectorAll() { return []; },
    closest() { return null; }
  };
}
globalThis.document = {
  currentScript: null, baseURI: "http://test/", body: __el(),
  querySelector() { return __el(); },
  querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {}
};
globalThis.window = globalThis;
window.addEventListener = () => {}; window.removeEventListener = () => {}; window.scrollTo = () => {};
globalThis.localStorage = { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.$ = s => document.querySelector(s);
globalThis.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
globalThis.qtyFmt = q => { const n = Number(q); return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10); };
globalThis.CHECK_SVG = "<svg></svg>";
globalThis.empty = t => `<p class="empty">${t}</p>`;
globalThis.row = () => "";
globalThis.money = n => "$" + n;
globalThis.fmtShort = s => s;
globalThis.refresh = () => {};
globalThis.showErr = e => { throw e; };
globalThis.toast = () => {};
const __posts = [];
globalThis.__posts = __posts;
globalThis.post = async (path, body) => {
  __posts.push([path, body]);
  const s = Q.current;
  if (path.endsWith("/check") && s) {
    const it = s.items.find(i => i.name === body.item);
    if (it) it.checked = body.checked;
    return s;
  }
  if (path.endsWith("/state") && s) { s.state = body.state; return s; }
  return {};
};
globalThis.api = async path => {
  if (path === "/api/quest/receipts") return { receipts: [] };
  if (path === "/api/quest/sessions") return { sessions: Q.sessions || [] };
  return {};
};
globalThis.createSceneView = () => ({ setStops() {}, setNext() {}, glideTo() {}, destroy() {}, onTapStop: null });
"""

DRIVER = r"""
;(async () => {
  const out = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mkSess = (names, mode) => ({
    id: "s1", store: "Trader Joe's", mode: mode || "quest", state: "playing",
    items: names.map(n => ({ name: n, qty: 1, checked: false, group: "name:" + n.toLowerCase() }))
  });
  let sess = mkSess(["A", "B", "C", "D"]);
  sess.items[0].checked = true;
  const strip = qRouteStripHtml(sess, false);
  const order = [...strip.matchAll(/rstop (done|current|ahead)/g)].map(m => m[1]);
  out.strip_order = JSON.stringify(order) === JSON.stringify(["done", "current", "ahead", "ahead"]);
  out.strip_labels = strip.includes("✓") && strip.includes(">2<") && strip.includes(">4<");
  sess = mkSess(["A", "B", "C", "D", "E"]);
  sess.items[0].checked = true;
  sess.items[1].shelf_label = "Pasta Sauce Shelf";
  const up = qUpNextHtml(sess);
  const iB = up.indexOf("B"), iC = up.indexOf("C"), iD = up.indexOf("D");
  out.upnext_order = iB >= 0 && iB < iC && iC < iD && !up.includes(">E<");
  out.upnext_first_big = up.includes('up-row first') && up.indexOf("up-row first") < iC;
  out.upnext_shelf = up.includes("Pasta Sauce Shelf");
  Q.arrived = false;
  out.pop_traveling_hidden = qPopState(sess) === "hidden";
  Q.arrived = true;
  out.pop_arrived_stop = qPopState(sess) === "stop";
  sess.state = "not_started";
  out.pop_ready = qPopState(sess) === "ready";
  sess.state = "playing";
  sess.items.forEach(i => { i.checked = true; });
  out.pop_done = qPopState(sess) === "done";
  __posts.length = 0;
  sess = mkSess(["A", "B"]);
  Q.current = sess; Q.scene = { setStops() {}, setNext() {}, glideTo() {}, destroy() {} };
  Q.storeReports = []; Q.followHold = false; Q.arrived = true;
  await collectCurrent();
  let checks = __posts.filter(p => p[0].endsWith("/check"));
  out.grab_first = checks.length === 1 && checks[0][1].item === "A" && checks[0][1].checked === true && sess.items[1].checked === false;
  await collectCurrent();
  checks = __posts.filter(p => p[0].endsWith("/check"));
  out.grab_second = checks.length === 2 && checks[1][1].item === "B";
  WALK_MS.quest = 25;
  sess = mkSess(["A", "B"]);
  Q.current = sess; Q.followHold = false; Q.arrived = false;
  qWalkStart(0);
  out.walk_traveling = Q.arrived === false;
  await sleep(70);
  out.walk_arrived = Q.arrived === true;
  Q.followHold = false; Q.arrived = false;
  qWalkStart(0);
  qFollowHold();
  out.hold_arrives_now = Q.arrived === true && Q.walkTimer === null;
  await sleep(50);
  out.hold_stays = Q.arrived === true;
  Q.arrived = false;
  qWalkStart(0);
  paintHuntFrame("view-score");
  out.frame_exit_stops_walk = Q.walkTimer === null;
  __posts.length = 0;
  const es = mkSess(["X", "Y"], "express");
  Q.current = es; Q.expScene = { setStops() {}, setNext() {}, glideTo() {}, destroy() {} };
  await qExpGrab();
  checks = __posts.filter(p => p[0].endsWith("/check"));
  out.exp_grab_current = checks.length === 1 && checks[0][1].item === "X" && checks[0][1].checked === true;
  await qExpToggle(es.items[1]);
  checks = __posts.filter(p => p[0].endsWith("/check"));
  out.exp_dot_any_order = checks.length === 2 && checks[1][1].item === "Y";
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""


DRIVER_ANYORDER = r"""
;(async () => {
  const out = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mkSess = (names, mode) => ({
    id: "s1", store: "Trader Joe's", mode: mode || "quest", state: "playing",
    items: names.map(n => ({ name: n, qty: 1, checked: false, group: "name:" + n.toLowerCase() }))
  });
  const checks = () => __posts.filter(p => p[0].endsWith("/check")).map(p => p[1].item);
  const fresh = s => {
    qWalkStop();
    Q.current = s; Q.scene = { setStops() {}, setNext() {}, glideTo() {}, destroy() {} };
    Q.storeReports = []; Q.followHold = false; Q.focusIdx = -1; Q.arrived = true;
  };
  // --- collect stop 4 while current is 1: re-targets past it ---
  __posts.length = 0;
  let sess = mkSess(["A", "B", "C", "D", "E"]);
  fresh(sess);
  out.starts_at_first = qCurrentIndex(sess) === 0;
  await collectStop(3);
  out.grab4_checks = JSON.stringify(checks()) === JSON.stringify(["D"]);
  out.grab4_only = sess.items[3].checked && !sess.items[0].checked && !sess.items[4].checked;
  out.grab4_retargets = qCurrentIndex(sess) === 4 && Q.focusIdx === 4;
  // --- the rail shows what remains, wrapping to the route start ---
  const up = qUpNextHtml(sess);
  const iE = up.indexOf(">E<"), iA = up.indexOf(">A<"), iB = up.indexOf(">B<");
  out.rail_wrap_order = iE >= 0 && iE < iA && iA < iB;
  out.rail_grabs = up.includes('data-up-grab="4"') && up.includes('data-up-grab="0"')
    && up.includes('data-up-grab="1"') && !up.includes('data-up-grab="2"');
  // --- collecting the last stop wraps current to the first left ---
  await collectStop(4);
  out.wrap_to_first = qCurrentIndex(sess) === 0;
  // --- earlier stops out of order; completion still detected ---
  await collectStop(2);
  out.after_c_current = qCurrentIndex(sess) === 0;
  await collectStop(0);
  out.after_a_current = qCurrentIndex(sess) === 1;
  await collectStop(1);
  out.all_checked = sess.items.every(i => i.checked);
  out.complete_detected = qNextIndex(sess) === -1 && qCurrentIndex(sess) === -1
    && qPopState(sess) === "done";
  // --- sequential play is unchanged ---
  __posts.length = 0;
  sess = mkSess(["A", "B", "C"]);
  fresh(sess);
  await collectCurrent();
  const seq1 = qCurrentIndex(sess) === 1;
  await collectCurrent();
  out.sequential = seq1 && qCurrentIndex(sess) === 2
    && JSON.stringify(checks()) === JSON.stringify(["A", "B"]);
  // --- a checked stop cannot be collected again ---
  __posts.length = 0;
  await collectStop(0);
  out.no_recheck = __posts.filter(p => p[0].endsWith("/check")).length === 0;
  // --- marker tap presents another stop; tapping it again grabs ---
  sess = mkSess(["A", "B", "C", "D"]);
  fresh(sess);
  Q.followHold = true; // a real tap lands after the scene touch held the walk
  __posts.length = 0;
  qTapStop(2);
  out.tap_presents = Q.focusIdx === 2 && qCurrentIndex(sess) === 2
    && __posts.filter(p => p[0].endsWith("/check")).length === 0;
  qTapStop(2);
  await sleep(10);
  out.tap_again_grabs = sess.items[2].checked === true && qCurrentIndex(sess) === 3;
  qTapStop(2);
  out.tap_checked_noop = qCurrentIndex(sess) === 3;
  // --- Express rail rows carry no GRAB; express current unchanged ---
  const es = mkSess(["X", "Y"], "express");
  const eup = qUpNextHtml(es);
  out.express_rail_plain = !eup.includes("data-up-grab");
  out.express_current_first = qCurrentIndex(es) === 0;
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""


@unittest.skipUnless(NODE, "node not available")
class TestHuntNavNode(unittest.TestCase):
    def test_any_order_collect(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "harness.js")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(PRELUDE)
                fh.write(read("quest.js"))
                fh.write(DRIVER_ANYORDER)
            out = subprocess.run([NODE, path], capture_output=True,
                                 text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        res = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertNotIn("error", res, res.get("error"))
        failed = [k for k, v in res.items() if v is not True]
        self.assertEqual(failed, [], f"harness checks failed: {failed} in {res}")

    def test_navigation_behavior(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "harness.js")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(PRELUDE)
                fh.write(read("quest.js"))
                fh.write(DRIVER)
            out = subprocess.run([NODE, path], capture_output=True,
                                 text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        res = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertNotIn("error", res, res.get("error"))
        failed = [k for k, v in res.items() if v is not True]
        self.assertEqual(failed, [], f"harness checks failed: {failed} in {res}")


if __name__ == "__main__":
    unittest.main()
