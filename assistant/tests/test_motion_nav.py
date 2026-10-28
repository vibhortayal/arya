"""Motion navigation (Discussion 33): gyro look-around for the hunt
and the step-advance experiment.

Two layers of pins:
- Shell contracts over the PWA text: the hunt carries the gyro
  button + the experiment chip (both hidden until the screen paints
  them), every SceneView driver implements the optional
  setLook/setProgress motion methods, the step flag defaults OFF,
  collects re-anchor, manual navigation holds step-advance.
- The pure motion math + controllers in scene.js, executed headless
  under node (skipped when node is absent): orientation mapping
  (heading -> yaw/pitch, pan fraction), the synthetic step series,
  and the permission-denied / null-sensor controller paths.
"""
import json, os, shutil, subprocess, tempfile, unittest

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")
NODE = shutil.which("node")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


class TestMotionShell(unittest.TestCase):
    def test_hunt_carries_motion_controls_hidden(self):
        html = read("index.html")
        hunt = html.split('id="view-hunt"')[1].split("</section>")[0]
        self.assertIn('id="btn-gyro"', hunt)
        self.assertIn("Look around with your phone", hunt)
        self.assertIn('id="btn-steps"', hunt)
        # Both start hidden; quest.js paints them per capability.
        gyro = hunt.split('id="btn-gyro"')[1].split(">")[0]
        steps = hunt.split('id="btn-steps"')[1].split(">")[0]
        self.assertIn("hidden", gyro)
        self.assertIn("hidden", steps)
        # The standard hunt is untouched underneath them.
        self.assertIn('id="btn-collect"', hunt)
        self.assertIn('id="scene-mount"', hunt)

    def test_every_driver_speaks_motion(self):
        scene = read("scene.js")
        for chunk_name in ("SceneDrivers.cloud", "SceneDrivers.aisle",
                           "SceneDrivers.strip"):
            chunk = scene.split(chunk_name)[1]
            self.assertIn("setLook", chunk, chunk_name)
            self.assertIn("setProgress", chunk, chunk_name)
        # The shared layer exists once — drivers do not fork it.
        self.assertEqual(scene.count("createMotionLook"), 2)  # def + comment-free use below
        self.assertIn("const MotionMath", scene)
        self.assertIn("createStepDetector", scene)
        self.assertIn("panFraction", scene)

    def test_step_flag_defaults_off_and_chip_is_demo_only(self):
        js = read("quest.js")
        self.assertIn('localStorage.getItem("arya-steps") === "1"', js)
        self.assertIn('localStorage.setItem("arya-steps", "1")', js)
        # The toggle chip shows only on the demo account.
        self.assertIn("function qStepsVisible()", js)
        self.assertIn("isDemo", js.split("function qStepsVisible()")[1].split("}")[0])
        self.assertIn('$("#btn-steps").hidden = !qStepsVisible()', js)
        # The devicemotion listener is only ever added under the flag.
        self.assertIn("const want = Q.stepsOn && huntOpen", js)

    def test_collect_reanchors_and_manual_nav_holds(self):
        js = read("quest.js")
        self.assertGreaterEqual(js.count("qStepAnchorTo("), 3)  # def + hunt collect + scan pop
        self.assertIn("qStepAnchorTo(name); // a collect is ground truth", js)
        # Hunt v2: list-row GRABs collect through collectStop too.
        self.assertIn("collectStop(Number(g.dataset.grab))", js)
        # Manual navigation pauses step-advance until the next collect.
        self.assertIn('$("#scene-mount").addEventListener("pointerdown"', js)
        self.assertGreaterEqual(js.count("Q.stepsHold = true"), 2)  # scene touch + driver switch
        self.assertIn("if (!Q.stepDet || Q.stepsHold", js)
        # A step can never walk past the stop it heads for.
        self.assertIn("MotionMath.advance(Q.stepU, nextU", js)

    def test_gyro_wiring_and_denied_path(self):
        js = read("quest.js")
        self.assertIn("createMotionLook(() => Q.scene", js)
        self.assertIn('if (!ok) toast("Phone look is not available', js)
        # Leaving the hunt stops the sensors.
        self.assertIn("stopHuntMotion()", js)
        self.assertIn('removeEventListener("devicemotion", qOnMotion)', js)

    def test_sw_cache_bumped(self):
        self.assertIn('CACHE = "arya-v36"', read("sw.js"))


PRELUDE = r"""
const __listeners = {};
globalThis.document = { currentScript: null, baseURI: "http://test/" };
globalThis.window = globalThis;
window.addEventListener = (t, fn) => { (__listeners[t] = __listeners[t] || []).push(fn); };
window.removeEventListener = (t, fn) => { const a = __listeners[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
globalThis.__fire = (t, e) => { (__listeners[t] || []).slice().forEach(f => f(e)); };
globalThis.__count = t => (__listeners[t] || []).length;
let __perm = "granted";
globalThis.__setPerm = v => { __perm = v; };
globalThis.DeviceOrientationEvent = class { static requestPermission() { return Promise.resolve(__perm); } };
"""

DRIVER = r"""
;(async () => {
  const out = {};
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  let l = MotionMath.look(10, 90, 350, 90);
  out.yaw_wrap_left = near(l.yaw, 20 * Math.PI / 180) && near(l.pitch, 0);
  l = MotionMath.look(330, 90, 350, 90);
  out.yaw_wrap_right = near(l.yaw, -20 * Math.PI / 180);
  l = MotionMath.look(355, 90, 5, 90);
  out.yaw_wrap_seam = near(l.yaw, -10 * Math.PI / 180);
  l = MotionMath.look(350, 120, 350, 90);
  out.pitch_up = near(l.pitch, 30 * Math.PI / 180);
  l = MotionMath.look(350, 175, 350, 90);
  out.pitch_clamp = near(l.pitch, 0.55);
  l = MotionMath.look(160, 90, 350, 90);
  out.yaw_clamp = near(l.yaw, 1.15);
  l = MotionMath.look(170, 90, 350, 90);
  out.yaw_seam_180 = near(l.yaw, -1.15);
  out.look_null = MotionMath.look(null, 90, 350, 90) === null;
  out.pan = MotionMath.pan(1.15) === 1 && MotionMath.pan(-1.15) === -1 && MotionMath.pan(0) === 0;
  out.pan_fraction = MotionMath.panFraction(1.15) === 0 && MotionMath.panFraction(-1.15) === 1 && MotionMath.panFraction(0) === 0.5;
  out.seg_step = near(MotionMath.segmentStepU(0, 0.4), 0.05) && near(MotionMath.segmentStepU(0.3, 0.3), 0);
  out.advance_cap = near(MotionMath.advance(0.38, 0.4, 0.05), 0.4) && near(MotionMath.advance(0.1, 0.4, 0.05), 0.15);
  let steps = 0;
  const det = createStepDetector(() => { steps++; });
  for (let t = 0; t <= 900; t += 100) det.push(0, 0, 9.8, t);
  out.seated_zero = steps === 0;
  for (let k = 0; k < 5; k++) {
    const T = 1000 + k * 1000;
    det.push(0, 0, 9.8, T); det.push(0, 0, 13.8, T + 150); det.push(0, 0, 9.4, T + 300);
  }
  out.five_strides = steps === 5;
  det.push(0, 0, 13.8, 6100); det.push(0, 0, 9.4, 6200);
  det.push(0, 0, 13.8, 6300); det.push(0, 0, 9.4, 6350);
  out.refractory = steps === 6;
  __setPerm("denied");
  const callsD = [];
  const drvD = { setLook(y, p) { callsD.push([y, p]); } };
  const ctlD = createMotionLook(() => drvD, null);
  out.denied_start = (await ctlD.start()) === false;
  out.denied_no_listener = __count("deviceorientation") === 0 && callsD.length === 0;
  __setPerm("granted");
  const calls = [];
  let unavail = false;
  const drv = { setLook(y, p) { calls.push([y, p]); } };
  const ctl = createMotionLook(() => drv, null);
  ctl.onUnavailable = () => { unavail = true; };
  out.granted_start = (await ctl.start()) === true && ctl.on === true;
  __fire("deviceorientation", { alpha: 350, beta: 90, gamma: 0 });
  out.baseline_silent = calls.length === 0;
  __fire("deviceorientation", { alpha: 10, beta: 90, gamma: 0 });
  out.turn_maps = calls.length === 1 && near(calls[0][0], 20 * Math.PI / 180) && near(calls[0][1], 0);
  __fire("deviceorientation", { alpha: null, beta: null, gamma: null });
  out.null_retires = unavail === true && ctl.on === false && __count("deviceorientation") === 0;
  const calls2 = [];
  const drv2 = { setLook(y, p) { calls2.push([y, p]); } };
  const ctl2 = createMotionLook(() => drv2, null);
  await ctl2.start();
  __fire("deviceorientation", { alpha: 100, beta: 90, gamma: 0 });
  __fire("deviceorientation", { alpha: 130, beta: 90, gamma: 0 });
  ctl2.stop();
  const last = calls2[calls2.length - 1];
  out.stop_resets = ctl2.on === false && last[0] === 0 && last[1] === 0;
  console.log(JSON.stringify(out));
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); });
"""


@unittest.skipUnless(NODE, "node not available")
class TestMotionMathNode(unittest.TestCase):
    def run_harness(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "harness.js")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(PRELUDE)
                fh.write(read("scene.js"))
                fh.write(DRIVER)
            out = subprocess.run([NODE, path], capture_output=True,
                                 text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout.strip().splitlines()[-1])

    def test_orientation_and_step_math(self):
        res = self.run_harness()
        self.assertNotIn("error", res, res.get("error"))
        failed = [k for k, v in res.items() if v is not True]
        self.assertEqual(failed, [], f"harness checks failed: {failed} in {res}")


if __name__ == "__main__":
    unittest.main()
