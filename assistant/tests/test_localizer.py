"""Where am I? — the localizer integration (Job: position anchor).

The matcher (api/localizer.py) is Wonder's spike code vendored
verbatim; these tests pin the app around it: the locate endpoint
with a stubbed matcher (found / low-confidence / no-index /
guards; the demo household may use the door), the shipped index
artifact (loads; a real-matcher check on two held-out frames
when cv2 and the spike's held-out set are present), and the
client (Cloud-rung button, the anchor jump in a node harness).
"""
import io, json, os, subprocess, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

try:
    import cv2  # noqa: E402,F401
    HAVE_CV2 = True
except Exception:
    HAVE_CV2 = False

NODE = None
for cand in ("/opt/node24/bin/node", "/usr/local/bin/node", "/usr/bin/node"):
    if os.path.exists(cand):
        NODE = cand
        break

HELDOUT = os.environ.get("ARYA_LOCALIZER_HELDOUT", "")


def read(name):
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", "pwa", name), encoding="utf-8") as fh:
        return fh.read()


def jpeg_bytes(w=2000, h=1000):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (120, 90, 40)).save(buf, "JPEG")
    return buf.getvalue()


class StubMeta:
    """main.MetaClient stand-in (session creation shelf-matches
    Trader Joe's items; the stub answers no model matches)."""

    def __init__(self, *a, **k):
        pass

    def chat(self, *a, **k):
        return (json.dumps({"matches": {}}),
                {"input_tokens": 1, "cached_tokens": 0,
                 "output_tokens": 1}, 0.0)


class FakeMatcher:
    result = {"estimated_u": 0.30, "confidence": 0.85, "candidates": []}
    calls = []
    widths = []

    @classmethod
    def reset(cls):
        cls.calls, cls.widths = [], []

    @classmethod
    def run(cls, image_path, index_path):
        from PIL import Image
        cls.calls.append(index_path)
        with Image.open(image_path) as im:
            cls.widths.append(im.width)
        return dict(cls.result)


class TestLocateRoute(unittest.TestCase):
    def setUp(self):
        from api import locate, main
        self.tmp = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = self.tmp
        main.MetaClient = StubMeta
        self.locate = locate
        self._orig_matcher = locate._run_matcher
        FakeMatcher.reset()
        FakeMatcher.result = {"estimated_u": 0.30, "confidence": 0.85,
                              "candidates": []}
        locate._run_matcher = lambda p, i: FakeMatcher.run(p, i)
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "hunter",
                                             "password": "hunter-pass"})
        assert r.status_code == 200, r.text
        r = self.c.post("/api/quest/sessions", json={
            "store": "Trader Joe's",
            "items": ["Pasta Sauce", "Frozen Ravioli"], "mode": "quest"})
        assert r.status_code == 200, r.text
        self.sid = r.json()["id"]
        r = self.c.post("/api/quest/sessions", json={
            "store": "Corner Store", "items": ["Milk"], "mode": "quest"})
        assert r.status_code == 200, r.text
        self.other_sid = r.json()["id"]

    def tearDown(self):
        self.locate._run_matcher = self._orig_matcher

    def post(self, sid, body=None, ctype="image/jpeg"):
        return self.c.post(f"/api/quest/locate?session={sid}",
                           content=jpeg_bytes() if body is None else body,
                           headers={"Content-Type": ctype})

    def test_found(self):
        out = self.post(self.sid).json()
        self.assertEqual(out, {"found": True, "u": 0.30, "confidence": 0.85})
        # The query was resized to the index frames' width first.
        self.assertEqual(FakeMatcher.widths, [1036])
        self.assertTrue(FakeMatcher.calls[0].endswith("localizer-index.npz"))

    def test_low_confidence_gate(self):
        FakeMatcher.result = {"estimated_u": 0.30, "confidence": 0.30,
                              "candidates": []}
        out = self.post(self.sid).json()
        self.assertFalse(out["found"])
        self.assertEqual(out["reason"], "low_confidence")

    def test_no_estimate_is_low_confidence(self):
        FakeMatcher.result = {"estimated_u": None, "confidence": 0.0,
                              "candidates": []}
        out = self.post(self.sid).json()
        self.assertEqual(out["reason"], "low_confidence")

    def test_no_index_store_never_calls_the_matcher(self):
        out = self.post(self.other_sid).json()
        self.assertEqual(out, {"found": False, "reason": "no_index"})
        self.assertEqual(FakeMatcher.calls, [])

    def test_guards(self):
        self.assertEqual(self.post("nope").status_code, 404)
        self.assertEqual(self.post(self.sid, b"junk",
                                   "text/plain").status_code, 415)
        self.assertEqual(self.post(self.sid, b"").status_code, 400)
        self.assertEqual(self.post(self.sid, b"not a photo").status_code, 400)


class TestLocateDemoCarveOut(unittest.TestCase):
    def test_demo_passes_the_readonly_gate(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(os.path.dirname(__file__), "..",
                                     "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        from api import main
        c = TestClient(main.app)
        c.post("/auth/demo")
        # The demo household is read-only for other doors...
        self.assertEqual(c.post("/decode/pdf", content=b"x").status_code, 403)
        # ...but locate is live for it: the request reaches the
        # route and fails only on the unknown session.
        r = c.post("/api/quest/locate?session=nope", content=jpeg_bytes(),
                   headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 404)


class TestIndexArtifact(unittest.TestCase):
    def test_artifact_and_manifest(self):
        from api import localizer
        path = localizer.DEFAULT_INDEX_PATH
        self.assertTrue(os.path.exists(path),
                        "index artifact ships in the repo")
        mpath = os.path.join(os.path.dirname(path), "localizer-manifest.json")
        with open(mpath, encoding="utf-8") as fh:
            manifest = json.load(fh)
        self.assertEqual(manifest["frames"], 90)
        self.assertLess(os.path.getsize(path), 25_000_000)

    @unittest.skipUnless(HAVE_CV2, "cv2 unavailable in this test env")
    def test_artifact_loads(self):
        from api import localizer
        data = localizer._load_index(localizer.DEFAULT_INDEX_PATH)
        self.assertEqual(len(data["frames"]), 90)
        self.assertEqual(int(data["descriptors"].shape[0]),
                         int(data["offsets"][-1]))

    @unittest.skipUnless(HAVE_CV2 and os.path.isdir(HELDOUT),
                         "needs cv2 and the spike held-out set")
    def test_real_matcher_two_heldout_frames(self):
        from api import locate
        manifest = json.load(open(os.path.join(HELDOUT, "manifest.json")))
        for entry in (manifest[0], manifest[22]):
            path = os.path.join(HELDOUT, os.path.basename(entry["file"]))
            with open(path, "rb") as fh:
                out = locate.locate(fh.read(), {"store": "Trader Joe's"})
            self.assertTrue(out["found"], out)
            self.assertLessEqual(abs(out["u"] - entry["true_u"]), 0.03,
                                 f"{entry['file']}: {out} vs {entry['true_u']}")


class TestLocateShell(unittest.TestCase):
    def test_button_and_input_live_in_the_hunt_only(self):
        html = read("index.html")
        hunt = html.split('id="view-hunt"')[1].split('id="view-express"')[0]
        self.assertIn('id="btn-locate"', hunt)
        self.assertIn('id="locate-photo"', hunt)
        self.assertIn("Where am I?", hunt)
        express = html.split('id="view-express"')[1].split('id="view-finish"')[0]
        self.assertNotIn('id="btn-locate"', express)

    def test_client_contract(self):
        js = read("quest.js")
        self.assertIn('$("#btn-locate").hidden = !(Q.driverName === "cloud" '
                      '|| Q.driverName === "photo");', js)
        self.assertIn("function qAnchorToU(u)", js)
        self.assertIn("/api/quest/locate?session=", js)
        self.assertIn("Placed you at", js)
        self.assertIn("Couldn't place that photo — keep following the route.", js)


PRELUDE = r"""
"use strict";
const vm = require("vm");
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

DRIVER = r"""
;(async () => {
  const out = {};
  const sess = {
    id: "s1", store: "Trader Joe's", mode: "quest", state: "playing",
    started_at: Date.now(), items: [
      { name: "A", qty: 1, checked: false }, { name: "B", qty: 1, checked: false },
      { name: "C", qty: 1, checked: false }, { name: "D", qty: 1, checked: false }],
    stops: [
      { item: "A", shelfLabel: "Start Shelf", shelf_u: 0.0 },
      { item: "B", shelfLabel: "Mid Shelf", shelf_u: 0.3 },
      { item: "C", shelfLabel: "Pasta Shelf", shelf_u: 0.6 },
      { item: "D", shelfLabel: "End Shelf", shelf_u: 1.0 }]
  };
  Q.current = sess;
  const rec = { progress: null, glides: [] };
  Q.scene = { setStops() {}, setNext() {}, destroy() {},
              setProgress(u) { rec.progress = u; },
              glideTo(i, s) { rec.glides.push([i, s]); } };
  Q.followHold = true;                     // the user had grabbed control
  const idx = qAnchorToU(0.58);
  out.nearest_stop = idx === 2;
  out.position_jumped = rec.progress === 0.58;
  out.follow_resumed = Q.followHold === false && Q.walkTarget === 2;
  out.glides_to_anchor_stop = rec.glides.length === 1 && rec.glides[0][0] === 2;
  out.step_rebased = Q.stepU === 0.58 && Q.stepAnchorU === 0.58 && Q.stepsHold === false;
  // Anchored at a stop already in the basket: present the next
  // uncollected stop ahead of it.
  sess.items[2].checked = true;
  rec.glides = [];
  qAnchorToU(0.58);
  out.collected_anchor_moves_ahead = Q.walkTarget === 3 && rec.glides[0][0] === 3;
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""


@unittest.skipUnless(NODE, "node not available")
class TestAnchorNode(unittest.TestCase):
    def test_anchor_jump_and_resume(self):
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
