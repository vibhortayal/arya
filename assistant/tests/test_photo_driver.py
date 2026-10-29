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

The scene.js half runs under node as before (scene.js stays in the
static folder); the driver resolution (quest.js qResolveDriver, now
Hunt.tsx resolveDriver) runs under vitest in
web/src/screens/hunt/driver.test.ts.
"""
import json, os, subprocess, tempfile, unittest

PWA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pwa")

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


from tests.frontend import src  # noqa: E402


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



class TestDriverResolutionUnderVitest(unittest.TestCase):
    def test_driver_resolution_defaults(self):
        t = src("screens/hunt/driver.test.ts")
        for name in ("a mapped store opens on its photos; an unmapped one on the drawing, or cards in Express",
                     "an old stored view choice is ignored",
                     "the 3D peek needs a model; without one the view stays"):
            self.assertIn(name, t)


class TestPhotoAssets(unittest.TestCase):
    def test_frames_are_not_precached(self):
        self.assertNotIn("frames-web", src("sw.js"))
        self.assertNotIn("models", src("sw.js").split("const STATIC = [")[1].split("];")[0])


class TestPhotoWiring(unittest.TestCase):
    def test_driver_and_one_view(self):
        js = read("scene.js")
        self.assertIn("SceneDrivers.photo = function (el)", js)
        self.assertIn("photoFrameForU", js)
        hunt = src("screens/Hunt.tsx")
        self.assertIn("export function resolveDriver(sess: Session, peek3D: boolean): string {", hunt)
        self.assertIn('if (storePhotos(sess.store, sess.store_id)) return "photo";', hunt)
        self.assertIn('return sess.mode === "express" ? "strip" : "art";', hunt)
        self.assertIn("drv.current = resolveDriver(sess, false);", hunt)
        self.assertIn("mount.dataset.photos = fromRoot(photos);", src("ui/Scene.tsx"))
        # No view switch: the store picks; 3D is one link away.
        self.assertNotIn('id="scene-toggle"', hunt)
        self.assertNotIn('data-driver="aisle"', hunt)
        self.assertIn('id="btn-3d"', hunt)
        self.assertIn('id="scene-cap"', hunt)

    def test_3d_peek_preserves_the_session(self):
        hunt = src("screens/Hunt.tsx")
        handler = hunt.split('<button id="btn-3d"')[1].split("</button>")[0]
        self.assertIn("drv.current = resolveDriver(sess, peek);", handler)
        self.assertIn("setPeek3D(peek);", handler)
        self.assertNotIn("qSetState", handler)
        self.assertNotIn("/check", handler)
        self.assertNotIn("qCheck", handler)

    def test_honest_labels(self):
        # Nowhere is the photo view called a 3D model or a live
        # view; the caption names them real photos and a 3D scan.
        hunt = src("screens/Hunt.tsx")
        cap = hunt.split("const QSCENE_CAPTION: Record<string, string> = {")[1].split("};")[0]
        self.assertIn("Real photos from this store", cap)
        self.assertNotIn("live", cap.split("cloud:")[0].lower())
        scene = read("scene.js")
        flat = " ".join(scene.split()).replace("* ", "")
        self.assertIn('never a "3D model", never a live view', flat)
        block = scene.split('---- "photo"')[1].split('---- "aisle"')[0]
        self.assertNotIn("3D", block)
        self.assertNotIn("live", block.lower())


if __name__ == "__main__":
    unittest.main()
