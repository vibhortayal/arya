"""Photo-walk driver (Discussion 43) — the mapped default.

The photo-walk prototype becomes a real SceneView driver:
frames crossfade by path fraction, the session is untouched
(presentation only). These tests pin: the frame-for-u mapping
against the prototype's stop table (node), the driver
resolution defaults (mapped -> photo, unmapped -> strip, a
stored player choice wins, legacy cloud-default sessions open
in photo), the switch-preserves-session rule, the shipped
asset tier (90 frames, under the ~20 MB guide, never
precached), and the honest labels (photos, never a "3D model"
or a live view).
"""
import json, os, subprocess, tempfile, unittest

PWA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pwa")
FRAMES = os.path.join(PWA, "models", "trader-joes", "frames-web")

NODE = None
for cand in ("/opt/node24/bin/node", "/usr/local/bin/node", "/usr/bin/node"):
    if os.path.exists(cand):
        NODE = cand
        break

# The prototype's stop table (arya-3d/photo-walk/stops.json):
# the frame each stop's path fraction must land on.
STOPS = [(0.0, 0), (0.0244, 2), (0.0559, 5), (0.0789, 7),
         (0.2107, 19), (0.2658, 24), (0.3196, 28), (0.3685, 33),
         (0.4374, 39), (0.4788, 43), (0.5675, 51), (0.6569, 58),
         (0.791, 70), (0.8628, 77), (0.8894, 79), (0.9078, 81),
         (0.9421, 84), (0.9784, 87)]


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


SCENE_PRELUDE = r"""
globalThis.document = {
  currentScript: null, baseURI: "http://test/",
  addEventListener() {}, removeEventListener() {}
};
globalThis.window = globalThis;
globalThis.esc = s => String(s ?? "");
"""

SCENE_DRIVER = r"""
;(async () => {
  const out = {};
  const stops = %s;
  out.mapping = stops.every(([u, f]) => photoFrameForU(u) === f);
  out.edges = photoFrameForU(0) === 0 && photoFrameForU(1) === 89 &&
              photoFrameForU(-0.5) === 0 && photoFrameForU(2) === 89 &&
              photoFrameForU(null) === 0;
  out.registered = typeof SceneDrivers.photo === "function" &&
                   typeof SceneDrivers.cloud === "function" &&
                   typeof SceneDrivers.strip === "function";
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
""" % json.dumps(STOPS)

QUEST_PRELUDE = r"""
"use strict";
function __el() {
  return {
    style: {}, dataset: {}, files: [], srcObject: null,
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
  createElement() { return { width: 0, height: 0, getContext() { return null; } }; },
  addEventListener() {}, removeEventListener() {}
};
globalThis.window = globalThis;
window.addEventListener = () => {}; window.removeEventListener = () => {}; window.scrollTo = () => {};
globalThis.localStorage = { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { onLine: true } });
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
globalThis.post = async () => ({});
globalThis.api = async () => ({});
globalThis.createSceneView = () => ({ setStops() {}, setNext() {}, glideTo() {}, setProgress() {}, destroy() {}, onTapStop: null });
"""

QUEST_DRIVER = r"""
;(async () => {
  const out = {};
  const TJ = "Trader Joe's", CS = "Corner Store";
  localStorage.removeItem("arya-scene-driver");
  out.mapped_default = qResolveDriver(TJ, null) === "photo";
  out.legacy_cloud_opens_photo = qResolveDriver(TJ, "cloud") === "photo";
  out.recorded_strip_is_default_not_choice = qResolveDriver(TJ, "strip") === "photo";
  out.session_aisle_kept = qResolveDriver(TJ, "aisle") === "aisle";
  out.unmapped_default = qResolveDriver(CS, null) === "strip";
  out.unmapped_session = qResolveDriver(CS, "strip") === "strip";
  localStorage.setItem("arya-scene-driver", "strip");
  out.stored_strip_wins = qResolveDriver(TJ, "cloud") === "strip";
  localStorage.setItem("arya-scene-driver", "cloud");
  out.stored_choice_wins = qResolveDriver(TJ, "photo") === "cloud";
  out.stored_cloud_unmapped_falls_back = qResolveDriver(CS, null) === "strip";
  localStorage.setItem("arya-scene-driver", "photo");
  out.stored_photo_unmapped_falls_back = qResolveDriver(CS, null) === "strip";
  localStorage.removeItem("arya-scene-driver");
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""


def run_node(prelude, source_name, driver):
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "harness.js")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(prelude)
            fh.write(read(source_name))
            fh.write(driver)
        out = subprocess.run([NODE, path], capture_output=True,
                             text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    res = json.loads(out.stdout.strip().splitlines()[-1])
    assert "error" not in res, res.get("error")
    failed = [k for k, v in res.items() if v is not True]
    assert not failed, f"checks failed: {failed} in {res}"
    return res


@unittest.skipUnless(NODE, "node not available")
class TestPhotoMappingNode(unittest.TestCase):
    def test_frame_for_u_matches_the_prototype_stops(self):
        run_node(SCENE_PRELUDE, "scene.js", SCENE_DRIVER)

    def test_driver_resolution_defaults(self):
        run_node(QUEST_PRELUDE, "quest.js", QUEST_DRIVER)


class TestPhotoAssets(unittest.TestCase):
    def test_frames_ship_complete_and_under_the_guide(self):
        files = sorted(os.listdir(FRAMES))
        self.assertEqual(len(files), 90)
        self.assertEqual(files[0], "f001.jpg")
        self.assertEqual(files[-1], "f090.jpg")
        total = sum(os.path.getsize(os.path.join(FRAMES, f)) for f in files)
        self.assertLess(total, 20_000_000)
        # The rolling window that paints first (-1/+4) stays at
        # the prototype's ~1.3 MB initial load.
        first = sum(os.path.getsize(os.path.join(FRAMES, f))
                    for f in files[:5])
        self.assertLess(first, 1_400_000)

    def test_frames_are_not_precached(self):
        self.assertNotIn("frames-web", read("sw.js"))


class TestPhotoWiring(unittest.TestCase):
    def test_driver_and_toggle(self):
        js = read("scene.js")
        self.assertIn("SceneDrivers.photo = function (el)", js)
        self.assertIn("photoFrameForU", js)
        q = read("quest.js")
        self.assertIn('qStorePhotos(Q.draft.store) ? "photo" : Q.driverName', q)
        self.assertIn("mount.dataset.photos", q)
        self.assertIn("qResolveDriver(sess.store, sess.driver)", q)
        html = read("index.html")
        toggle = html.split('id="scene-toggle"')[1].split("</div>")[0]
        self.assertIn('data-driver="photo"', toggle)
        self.assertIn(">Photos</button>", toggle)
        self.assertIn('data-driver="cloud"', toggle)

    def test_switch_preserves_the_session(self):
        q = read("quest.js")
        handler = q.split('$("#scene-toggle").addEventListener')[1]
        handler = handler.split("addEventListener")[0]
        self.assertIn("mountScene();", handler)
        self.assertIn("renderHunt();", handler)
        self.assertNotIn("qSetState", handler)
        self.assertNotIn("/check", handler)

    def test_honest_labels(self):
        # Nowhere is the photo view called a 3D model or a live
        # view; the map note names it a photo walk.
        q = read("quest.js")
        self.assertIn("unlock its photo walk and 3D view", q)
        scene = read("scene.js")
        flat = " ".join(scene.split()).replace("* ", "")
        self.assertIn('never a "3D model", never a live view', flat)
        block = scene.split('---- "photo"')[1].split('---- "aisle"')[0]
        self.assertNotIn("3D", block)
        self.assertNotIn("live", block.lower())


if __name__ == "__main__":
    unittest.main()
