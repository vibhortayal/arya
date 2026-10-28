"""Rewards (owner, 2026-10-28): mobile first, no lives, no game
over, no pressure — dopamine on every grab and after the hunt.
Points mirror the server rule (test_points.py) and only add; the
Quest HUD shows points, not a clock; sound and buzz are opt-in;
reduced motion drops the movement. Behavior runs headless under
node: milestones fire once as they are crossed, the full haul
bursts, a put back never takes points from the record of grabs,
and Express stays quiet."""
import json, os, subprocess, tempfile, unittest

from tests.test_hunt_nav import NODE, PRELUDE, read

DRIVER = r"""
;(async () => {
  const out = {};
  const shown = [];
  qShowMilestone = t => shown.push(t);
  let bursts = 0; qConfetti = () => { bursts++; };
  const mk = (n, mode) => ({ id: "s1", store: "TJ", mode: mode || "quest", state: "playing",
    items: Array.from({ length: n }, (_, i) => ({ name: "I" + i, qty: 1, checked: false, group: "g" + i })) });
  const scene = () => ({ setStops() {}, setNext() {}, glideTo() {}, destroy() {} });
  let s = mk(8);
  Q.current = s; Q.scene = scene(); Q.storeReports = []; Q.focusIdx = -1; Q.arrived = true;
  Q.lastGrabAt = 0;
  for (let i = 0; i < 8; i++) { await collectStop(i); Q.lastGrabAt = 0; }
  out.milestones_in_order = JSON.stringify(shown.slice(0, 2)) === JSON.stringify(["Halfway there!", "One to go!"]);
  out.full_haul_bursts_once = bursts === 1 && shown[shown.length - 1] === "All collected! Full haul!";
  out.points_full = qHaulPoints(s, false) === 105 && qHaulPoints(s, true) === 155;
  await putBackStop(7);
  out.put_back_points_follow = qHaulPoints(s, false) === 70;
  // a hot streak: three quick grabs
  shown.length = 0;
  s = mk(12); Q.current = s; Q.lastGrabAt = 0; Q.combo = 0;
  await collectStop(0); await collectStop(1); await collectStop(2);
  out.hot_streak_quiet = shown.length === 0;
  // Express never celebrates
  shown.length = 0; bursts = 0;
  const e = mk(2, "express"); Q.current = e;
  qRewardGrab(e, 0);
  out.express_quiet = shown.length === 0 && bursts === 0;
  // sound is off unless the player turns it on
  out.sound_default_off = QFX.on === false;
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""


class TestRewardsShell(unittest.TestCase):
    def test_no_lives_no_clock_on_the_quest_hud(self):
        html = read("index.html")
        hud = html.split('id="view-hunt"')[1].split('id="scene-mount"')[0]
        self.assertIn('id="hunt-timer" hidden', hud)
        self.assertIn('id="hunt-pts"', hud)
        tools = html.split('class="hunt-tools"')[1].split("</div>")[0]
        self.assertIn('id="btn-sound"', tools)
        js = read("quest.js").lower()
        for word in ("game over", "lives left", "lose a life", "you lose", "time's up"):
            self.assertNotIn(word, js)

    def test_haul_banks_with_the_receipt(self):
        js = read("quest.js")
        haul = js.split("function qHaulHtml(")[1].split("\n}")[0]
        self.assertIn("Haul banked ✓", haul)
        self.assertIn("that's when the haul banks", haul)
        self.assertIn("qHaulHtml(sess, profile, attached)", js)

    def test_reduced_motion_and_theme(self):
        css = read("styles.css")
        tail = css.split("/* Rewards (owner, 2026-10-28)")[1]
        self.assertIn("prefers-reduced-motion: reduce", tail)
        self.assertIn('matchMedia("(prefers-reduced-motion: reduce)")', read("quest.js"))

    def test_level_shows_on_today_and_profile(self):
        app = read("app.js")
        self.assertIn('api("/api/quest/profile").then(paintLevelChip)', app)
        self.assertIn('id="today-level"', read("index.html"))
        self.assertIn("Level · ${profile.points || 0} pts", app)


@unittest.skipUnless(NODE, "node not installed")
class TestRewardsNode(unittest.TestCase):
    def test_rewards_behavior(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "harness.js")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(PRELUDE)
                fh.write(read("quest.js"))
                fh.write(DRIVER)
            out = subprocess.run([NODE, path], capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        res = json.loads(out.stdout.strip().splitlines()[-1])
        self.assertNotIn("error", res, res.get("error"))
        failed = [k for k, v in res.items() if v is not True]
        self.assertEqual(failed, [], f"{failed} in {res}")


if __name__ == "__main__":
    unittest.main()


class TestFindItForMe(unittest.TestCase):
    def test_button_on_the_next_card_aims_the_scan(self):
        html = read("index.html")
        pop = html.split('id="hunt-pop"')[1].split('id="hunt-done-note"')[0]
        self.assertIn('id="btn-findit"', pop)
        self.assertIn("Find it for me", pop)
        js = read("quest.js")
        self.assertIn("Q.scanTarget = sess.items[idx].name;", js)
        self.assertIn("&item=${encodeURIComponent(Q.scanTarget)}", js)
        self.assertIn("Found it! ${Q.scanTarget} is highlighted", js)

    def test_fresh_photo_on_the_card_and_the_privacy_line(self):
        html = read("index.html")
        pop = html.split('id="hunt-pop"')[1].split('id="hunt-done-note"')[0]
        self.assertIn('id="hunt-fresh"', pop)
        self.assertIn("We never keep pictures of people, only products", html)
        js = read("quest.js")
        self.assertIn("/api/quest/shelf-photo?store=", js)
        self.assertIn("People are blurred out; we only keep products.", js)


class TestPlanAHunt(unittest.TestCase):
    """Owner, 2026-10-28: pick the store first, then move items from
    the Arya list into the quest; planning is the same list."""

    def test_store_first_then_items(self):
        js = read("quest.js")
        new_hunt = js.split('$("#btn-new-hunt").addEventListener')[1].split("});")[0]
        self.assertIn('questShow("view-store")', new_hunt)
        self.assertIn('api("/api/quest/plan")', new_hunt)
        # Tap-to-advance (owner phone pass, 2026-10-28): picking a
        # store starts the plan — the Choose items button is gone.
        pick = js.split("function qPickStore()")[1].split("\n}")[0]
        self.assertIn("renderPlan()", pick)
        self.assertIn('questShow("view-newlist")', pick)
        for handler in ('closest("[data-pick]")', 'closest("[data-histstore]")'):
            body = js.split(handler)[1].split("\n});")[0]
            self.assertIn("qPickStore();", body)
        html = read("index.html")
        self.assertIn("Where are you shopping?", html)
        self.assertIn('id="nl-plan"', html)
        self.assertNotIn('id="st-next"', html)
        self.assertNotIn("Choose items", html)

    def test_buckets_and_list_management(self):
        js = read("quest.js")
        for label in ("Usually bought here", "New on your list", "Usually from ${st}",
                      "Often bought here, not on your list"):
            self.assertIn(label, js)
        rm = js.split('const b = ev.target.closest("[data-planrm]")')[1].split("\n});")[0]
        self.assertIn('post("/api/list/remove"', rm)
        self.assertIn('action: "Undo"', rm)
        self.assertIn('post("/api/list/add", { item_id: itemId })', rm)
        nxt = js.split('$("#nl-next").addEventListener')[1].split("\n});")[0]
        self.assertIn('post("/api/list/add", { name: r.name })', nxt)

    def test_clean_list_skips_check_my_list(self):
        js = read("quest.js")
        opt = js.split("async function qOptimizeDraft()")[1].split("\n}")[0]
        self.assertIn("!rep.merged.length && !rep.corrected.length && !rep.questions.length", opt)
        self.assertIn('questShow("view-mode")', opt)
