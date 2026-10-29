"""Zero-entry teach (owner, 2026-10-28: "no user is going to enter
data"). Pinned here: a frame with NO segment named gets its section
from the reader and lands in a found-or-created both-sides segment;
repeats merge; the scrub runs before the read and fails closed; an
unreadable or shelf-less frame keeps nothing; inferred items become
sightings; the confirm card's discard retracts only the teacher's
own fresh sections; the demo teaches only its sandbox.
"""
import io, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def jpeg(seed=1, w=640, h=480):
    rng = np.random.default_rng(seed)
    a = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, "JPEG", quality=90)
    return buf.getvalue()


class FakeTeachClient:
    """SAM for the scrub + shelf fill; chat() is the section reader,
    answering from a script the test sets."""
    people_fails = False
    reads = []          # raw model answers, popped in order
    seen_images = 0

    def __init__(self, *a, **k):
        pass

    def segment(self, image_bytes, prompt, media_type="image/jpeg"):
        if prompt == "person" and FakeTeachClient.people_fails:
            raise RuntimeError("SAM down")
        if prompt == "grocery shelf":
            return [{"box": [i * 20, 40, i * 20 + 18, 400], "w": 640,
                     "h": 480, "confidence": 0.8} for i in range(27)], {}, 0.0025
        return [], {}, 0.0025

    def chat(self, messages, mode="standard", **k):
        FakeTeachClient.seen_images += 1
        return FakeTeachClient.reads.pop(0), {}, 0.004


class TestReadParsing(unittest.TestCase):
    def test_parse_variants(self):
        from api import mapread
        self.assertEqual(mapread.parse_read('{"label": "Aisle 4", "items": ["Pasta"]}'),
                         {"label": "Aisle 4", "items": ["Pasta"]})
        fenced = mapread.parse_read('Sure!\n```json\n{"label": "Frozen", "items": []}\n```')
        self.assertEqual(fenced["label"], "Frozen")
        self.assertEqual(mapread.parse_read('{"label": "", "items": []}')["label"], "")
        with self.assertRaises(ValueError):
            mapread.parse_read("no json here")

    def test_parse_clamps_and_dedupes(self):
        from api import mapread
        out = mapread.parse_read('{"label": "%s", "items": ["Milk", "milk", "Eggs"]}'
                                 % ("x" * 90))
        self.assertEqual(len(out["label"]), 60)
        self.assertEqual(out["items"], ["Milk", "Eggs"])


class TestTeachRoutes(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        FakeTeachClient.people_fails = False
        FakeTeachClient.reads = []
        FakeTeachClient.seen_images = 0
        from api import main
        from api import deps
        deps.MetaClient = FakeTeachClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text
        self.store = "New Store"

    def teach(self, data, store=None):
        return self.c.post("/api/storemap/teach", params={
            "store": store or self.store, "kind": "walk"}, content=data,
            headers={"Content-Type": "image/jpeg"})

    def view(self, store=None):
        return self.c.get("/api/storemap",
                          params={"store": store or self.store}).json()

    def test_walk_frame_names_and_creates_its_section(self):
        FakeTeachClient.reads = ['{"label": "Frozen", "items": ["Peas", "Ice cream"]}']
        r = self.teach(jpeg(1))
        self.assertEqual(r.status_code, 200, r.text)
        out = r.json()
        self.assertEqual(out["label"], "Frozen")
        self.assertTrue(out["created"])
        self.assertTrue(out["accepted"])
        v = self.view()
        self.assertEqual(v["total"], 1)
        seg = v["segments"][0]
        self.assertEqual(seg["side"], "both")
        self.assertEqual(seg["status"], "mapped")
        self.assertEqual(seg["items"], 2)      # sightings were noted

    def test_second_frame_same_section_merges(self):
        FakeTeachClient.reads = ['{"label": "Frozen", "items": []}',
                                 '{"label": "frozen", "items": []}']
        self.teach(jpeg(1))
        out = self.teach(jpeg(2)).json()
        self.assertFalse(out["created"])
        v = self.view()
        self.assertEqual(v["total"], 1)
        self.assertEqual(v["segments"][0]["captures"], 2)

    def test_two_sections_from_one_walk(self):
        FakeTeachClient.reads = ['{"label": "Produce", "items": ["Apples"]}',
                                 '{"label": "Bakery", "items": ["Sourdough"]}']
        self.teach(jpeg(1))
        self.teach(jpeg(2))
        v = self.view()
        self.assertEqual(v["total"], 2)
        self.assertEqual(v["coverage_pct"], 100)

    def test_scrub_failure_keeps_nothing_and_never_reads(self):
        FakeTeachClient.people_fails = True
        FakeTeachClient.reads = ['{"label": "Frozen", "items": []}']
        r = self.teach(jpeg(1))
        self.assertEqual(r.status_code, 503)
        self.assertEqual(FakeTeachClient.seen_images, 0)   # read never ran
        self.assertEqual(self.view()["total"], 0)

    def test_shelfless_frame_and_bad_json_keep_nothing(self):
        FakeTeachClient.reads = ['{"label": "", "items": []}']
        self.assertEqual(self.teach(jpeg(1)).status_code, 422)
        FakeTeachClient.reads = ["the shelves are nice today"]
        self.assertEqual(self.teach(jpeg(1)).status_code, 422)
        self.assertEqual(self.view()["total"], 0)

    def test_discard_retracts_only_the_teachers_own(self):
        FakeTeachClient.reads = ['{"label": "Frozen", "items": []}']
        seg = self.teach(jpeg(1)).json()["segment"]
        r = self.c.post("/api/storemap/discard",
                        json={"store": self.store, "segment": seg})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.view()["total"], 0)
        r = self.c.post("/api/storemap/discard",
                        json={"store": self.store, "segment": seg})
        self.assertEqual(r.status_code, 404)

    def test_discard_refuses_a_section_others_built_on(self):
        from api import state, storemap
        FakeTeachClient.reads = ['{"label": "Frozen", "items": []}']
        seg = self.teach(jpeg(1)).json()["segment"]
        # Another account's capture lands in the same section.
        tok = state._current_user.set("other@example.com")
        try:
            storemap.ingest(self.store, seg, jpeg(7), kind="photo")
        finally:
            state._current_user.reset(tok)
        r = self.c.post("/api/storemap/discard",
                        json={"store": self.store, "segment": seg})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.view()["total"], 1)

    def test_discard_refuses_the_walkthrough_baseline(self):
        os.environ["ARYA_WALK_STORE_ID"] = "tj-argonaut"  # the walk's own store
        self.addCleanup(os.environ.pop, "ARYA_WALK_STORE_ID", None)
        v = self.view("Trader Joe's|tj-argonaut")
        self.assertTrue(v["total"])
        seg = v["segments"][0]["id"]
        r = self.c.post("/api/storemap/discard",
                        json={"store": "Trader Joe's|tj-argonaut", "segment": seg})
        self.assertEqual(r.status_code, 400)

    def test_demo_teaches_only_its_sandbox(self):
        FakeTeachClient.reads = ['{"label": "Frozen", "items": []}',
                                 '{"label": "Frozen", "items": []}']
        demo = TestClient(self.c.app)
        self.assertEqual(demo.post("/auth/demo").status_code, 200)
        r = demo.post("/api/storemap/teach", params={
            "store": "Sandbox Store", "kind": "walk"}, content=jpeg(3),
            headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 200, r.text)
        mine = demo.get("/api/storemap",
                        params={"store": "Sandbox Store"}).json()
        self.assertEqual(mine["total"], 1)
        self.assertEqual(self.view("Sandbox Store")["total"], 0)


if __name__ == "__main__":
    unittest.main()
