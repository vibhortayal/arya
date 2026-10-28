"""Hunt v2 (owner-approved wireframes + the rebuild plan,
2026-10-28): the hunt is one scrolling column — HUD, view switch,
a contained store view with ONE target, the tools row, the
suggested-next card with the one big GRAB, then the one list in
flow, where every row GRABs and a collected row puts back in
place. Collecting the last item never jumps to Finish; Back is a
stack. Express wears no game chrome: a small strip view and the
list, where each row is the check.

Shell pins cover the layout contract (markup + CSS tokens).
Behavior is pinned headless under node (skipped when node is
absent): list rows in route order, GRAB/put-back in place, the
walk and manual-navigation hold (Discussion 35/36/44 carry over
unchanged), no automatic route into Finish, the Back stack, and
the resume route for a finished hunt.
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
    def hunt(self):
        return section(read("index.html"), 'id="view-hunt"', 'id="view-express"')

    def test_hunt_is_one_scrolling_column(self):
        hunt, css = self.hunt(), read("styles.css")
        order = ["hunthud", 'id="scene-toggle"', 'id="scene-mount"',
                 'class="hunt-tools"', 'id="hunt-pop"', 'id="hunt-list"',
                 'id="btn-finish"']
        idx = [hunt.index(k) for k in order]
        self.assertEqual(idx, sorted(idx), "column order")
        self.assertIn('class="storeview"', hunt)
        for el in ("hunt-store", "hunt-timer", "hunt-count", "btn-pause",
                   "pop-body", "btn-collect", "hunt-done-note", "hunt-rail"):
            self.assertIn(f'id="{el}"', hunt)
        # The summoned list panel and the overlays are gone: the list
        # lives in flow, once.
        for gone in ("list-panel", "btn-listpanel", "hunt-upnext",
                     "hunt-route", "panel-items", "huntbottom"):
            self.assertNotIn(gone, hunt)
        # The tab bar is app chrome; it hides while hunting. The
        # column scrolls — the frame is no longer a fixed overlay.
        self.assertNotIn('id="tabs"', hunt)
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

    def test_tools_row_and_next_card(self):
        hunt, css = self.hunt(), read("styles.css")
        tools = section(hunt, 'class="hunt-tools"', "</div>")
        for el in ("btn-scan", "btn-locate", "btn-nothere"):
            self.assertIn(f'id="{el}"', tools)
        pop = section(hunt, 'id="hunt-pop"', 'id="hunt-done-note"')
        self.assertIn('id="btn-collect"', pop)
        self.assertIn("grabbtn", pop)
        self.assertIn("Suggested next", pop)
        grab = css.split(".grabbtn {")[1].split("}")[0]
        self.assertIn("min-height: 60px", grab)  # >= the 56px brief

    def test_express_has_no_game_chrome(self):
        html = read("index.html")
        exp = section(html, 'id="view-express"', 'id="view-finish"')
        for el in ("exp-mount", "exp-items", "exp-count", "exp-pause",
                   "exp-finish", "exp-store", "exp-rail"):
            self.assertIn(f'id="{el}"', exp)
        for gone in ("exp-grab", "exp-route", "exp-panel", "exp-listbtn",
                     "exp-upnext", "celeb-layer", "scene-toggle", "grabbtn"):
            self.assertNotIn(gone, exp)
        js = read("quest.js")
        # Each Express row is the check: the whole row is a button.
        row = js.split("function qExpListHtml(")[1].split("\n}")[0]
        self.assertIn('<button type="button" class="row listrow exprow', row)
        self.assertIn('data-exp-check="${esc(it.name)}"', row)

    def test_any_order_surfaces_present(self):
        js = read("quest.js")
        for fn in ("qCurrentIndex", "qRetarget", "collectStop", "qTapStop",
                   "putBackStop", "qHuntListHtml"):
            self.assertIn(f"function {fn}(", js)
        self.assertIn('data-grab="${i}"', js)
        self.assertIn('data-putback="${i}"', js)
        self.assertIn("onTapStop = idx => qTapStop(idx)", js)

    def test_finish_is_never_automatic(self):
        js = read("quest.js")
        # openFinish is reached only from the two deliberate Finish
        # buttons: its definition plus exactly two calls.
        self.assertEqual(js.count("openFinish("), 3)
        self.assertIn('$("#btn-finish").addEventListener("click", () => {\n'
                      '  // The hunt stays open', js)
        self.assertIn('$("#exp-finish").addEventListener("click", () => {\n'
                      '  if (Q.current) openFinish(Q.current);', js)

    def test_walk_and_presentation_logic_present(self):
        js = read("quest.js")
        for fn in ("qPopState", "qWalkStart", "qWalkStop", "qFollowHold"):
            self.assertIn(f"function {fn}(", js)
        walk = js.split("const WALK_MS")[1].split("}")[0]
        self.assertIn("quest: 3200", walk)
        self.assertIn("express: 2000", walk)
        self.assertIn("qOnCollected(name);", js)
        self.assertIn("function qOnCollected(name)", js)


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
globalThis.__html = {};
document.querySelector = sel => {
  const e = __el();
  Object.defineProperty(e, "innerHTML", { set(v) { __html[sel] = v; }, get() { return __html[sel] || ""; } });
  return e;
};
"""

DRIVER = r"""
;(async () => {
  const out = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mkSess = (names, mode) => ({
    id: "s1", store: "Trader Joe's", mode: mode || "quest", state: "playing",
    items: names.map(n => ({ name: n, qty: 1, checked: false, group: "name:" + n.toLowerCase() }))
  });
  const calls = { finish: 0, hunt: 0, score: 0, express: 0, refresh: [] , glide: 0 };
  openFinish = () => { calls.finish++; };
  openScore = () => { calls.score++; };
  openHunt = () => { calls.hunt++; };
  openExpress = () => { calls.express++; };
  refresh = v => { calls.refresh.push(v); };
  const scene = () => ({ setStops() {}, setNext() {}, glideTo() { calls.glide++; }, destroy() {} });
  // --- the one list: route order, one action per row ---
  let sess = mkSess(["A", "B", "C", "D"]);
  Q.current = sess; Q.scene = scene(); Q.storeReports = []; Q.focusIdx = -1; Q.arrived = true;
  sess.items[0].checked = true;
  let html = qHuntListHtml(sess);
  const iA = html.indexOf(">A<"), iB = html.indexOf(">B<"), iD = html.indexOf(">D<");
  out.list_route_order = iA >= 0 && iA < iB && iB < iD;
  out.list_put_back_on_collected = html.includes('data-putback="0"') && !html.includes('data-grab="0"');
  out.list_grab_on_open = html.includes('data-grab="1"') && html.includes('data-grab="3"');
  sess.state = "paused";
  out.list_grab_disabled_when_paused = /data-grab="1" disabled/.test(qHuntListHtml(sess));
  sess.state = "playing";
  // --- pop states (Discussion 35 carry-over) ---
  Q.arrived = false;
  out.pop_traveling_hidden = qPopState(sess) === "hidden";
  Q.arrived = true;
  out.pop_arrived_stop = qPopState(sess) === "stop";
  sess.state = "not_started";
  out.pop_ready = qPopState(sess) === "ready";
  sess.state = "playing";
  // --- GRAB collects exactly the current stop ---
  __posts.length = 0;
  sess = mkSess(["A", "B"]);
  Q.current = sess; Q.scene = scene(); Q.followHold = false; Q.arrived = true; Q.focusIdx = -1;
  await collectCurrent();
  let checks = __posts.filter(p => p[0].endsWith("/check"));
  out.grab_first = checks.length === 1 && checks[0][1].item === "A" && checks[0][1].checked === true && sess.items[1].checked === false;
  // --- the last collect sits at N/N: no jump to Finish ---
  await collectCurrent();
  out.all_collected = sess.items.every(i => i.checked) && qPopState(sess) === "done";
  out.no_auto_finish = calls.finish === 0;
  out.done_note_shown = __html["#hunt-done-note"] === undefined; // hidden flag set, not innerHTML
  // --- put back: same row, counts follow, the walk does not restart ---
  __posts.length = 0;
  const glides = calls.glide;
  await putBackStop(0);
  checks = __posts.filter(p => p[0].endsWith("/check"));
  out.put_back_unchecks = checks.length === 1 && checks[0][1].item === "A" && checks[0][1].checked === false;
  out.put_back_reaims = qCurrentIndex(sess) === 0 && qPopState(sess) !== "done";
  out.put_back_no_walk_restart = calls.glide === glides;
  out.put_back_counts = qProgress(sess).done === 1;
  // --- walk + manual hold (Discussion 35/36) ---
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
  Q.arrived = false;
  qWalkStart(0);
  paintHuntFrame("view-score");
  out.frame_exit_stops_walk = Q.walkTimer === null;
  // --- Express: rows toggle in any order; all checked is a toast ---
  __posts.length = 0;
  const es = mkSess(["X", "Y"], "express");
  Q.current = es; Q.expScene = scene();
  await qExpToggle(es.items[1]);
  await qExpToggle(es.items[0]);
  checks = __posts.filter(p => p[0].endsWith("/check"));
  out.exp_any_order = checks.length === 2 && checks[0][1].item === "Y" && checks[1][1].item === "X";
  out.exp_rows_are_checks = /data-exp-check="X"/.test(qExpListHtml(es)) && /aria-pressed="true"/.test(qExpListHtml(es));
  out.exp_no_auto_finish = calls.finish === 0;
  // --- Back is a stack: Finish's Back re-opens the live hunt ---
  Q.current = mkSess(["A"]);
  Q.stack = ["view-hunt", "view-finish"];
  questBack();
  out.back_finish_to_hunt = calls.hunt === 1;
  Q.current = mkSess(["A"], "express");
  Q.stack = ["view-express", "view-finish"];
  questBack();
  out.back_finish_to_run = calls.express === 1;
  Q.stack = ["view-hunt"];
  questBack();
  out.back_hunt_to_today = calls.refresh.includes("view-home");
  // --- resume route: a finished hunt opens on its Score ---
  const fin = mkSess(["A"]); fin.state = "finished";
  qOpenSession(fin);
  const dn = mkSess(["A"]); dn.state = "done";
  qOpenSession(dn);
  out.finished_opens_score = calls.score === 2 && calls.finish === 0;
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
  // --- the list offers a GRAB on every stop still open ---
  const lh = qHuntListHtml(sess);
  out.list_grabs = lh.includes('data-grab="4"') && lh.includes('data-grab="0"')
    && lh.includes('data-grab="1"') && !lh.includes('data-grab="3"')
    && lh.includes('data-putback="3"');
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
  // --- Express keeps first-uncollected semantics ---
  const es = mkSess(["X", "Y"], "express");
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
