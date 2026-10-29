"""Where am I? — the localizer integration (Job: position anchor).

The matcher (api/localizer.py) is Wonder's spike code vendored
verbatim; these tests pin the app around it: the locate endpoint
with a stubbed matcher (found / low-confidence / no-index /
guards; the demo household may use the door), the shipped index
artifact (loads; a real-matcher check on two held-out frames
when cv2 and the spike's held-out set are present), and the
client (Cloud-rung button in web/src/screens/Hunt.tsx; the anchor
jump runs under vitest in web/src/screens/hunt/motion.test.ts).
"""
import io, json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

try:
    import cv2  # noqa: E402,F401
    HAVE_CV2 = True
except Exception:
    HAVE_CV2 = False

HELDOUT = os.environ.get("ARYA_LOCALIZER_HELDOUT", "")


from tests.frontend import src  # noqa: E402


def jpeg_bytes(w=2000, h=1000):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (120, 90, 40)).save(buf, "JPEG")
    return buf.getvalue()


class StubMeta:
    """deps.MetaClient stand-in (session creation shelf-matches
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
        from api import deps
        self.tmp = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = self.tmp
        deps.MetaClient = StubMeta
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
        from api import deps
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
        hunt = src("screens/Hunt.tsx")
        self.assertIn('<button id="btn-locate"', hunt)
        self.assertIn('<input id="locate-photo"', hunt)
        self.assertIn("Where am I?", hunt)
        self.assertNotIn('id="btn-locate"', src("screens/Express.tsx"))

    def test_client_contract(self):
        js = src("screens/Hunt.tsx")
        self.assertIn('id="btn-locate" className="btn toolbtn" type="button" '
                      'hidden={!(driverName === "cloud" || driverName === "photo")}', js)
        self.assertIn("export function anchorToU(u: number, walkStart: (idx: number) => void): number {",
                      src("screens/hunt/motion.ts"))
        self.assertIn("const idx = anchorToU(out.u, walkStart);", js)
        self.assertIn("/api/quest/locate?session=", js)
        self.assertIn("Placed you at", js)
        self.assertIn("Couldn't place that photo — keep following the route.", js)


class TestAnchorUnderVitest(unittest.TestCase):
    """The old node harness over quest.js qAnchorToU, ported."""

    def test_anchor_checks_are_ported(self):
        t = src("screens/hunt/motion.test.ts")
        for name in ("the anchor jumps the view, snaps to the nearest stop and resumes following",
                     "anchored at a stop already in the basket: the next open stop ahead"):
            self.assertIn(name, t)


if __name__ == "__main__":
    unittest.main()
