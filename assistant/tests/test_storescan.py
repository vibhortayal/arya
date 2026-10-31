"""Guided store scan (owner, 2026-10-29): pan, never tap; Arya reads
signs, items and (opt-in) prices; people are ignored and never kept.
Pinned here: the scrub runs first and fails closed; a frame mostly of
people pauses and is never read or kept; the read only ever sees the
scrubbed frame; outlines are SAM's boxes as fractions; unsure prices
are dropped and prices need the opt-in; the daily frame cap holds.
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


class FakeScanClient:
    people = []           # person boxes SAM "finds"
    people_fails = False
    reads = []
    read_images = []
    prompts = []

    def __init__(self, *a, **k):
        pass

    def segment(self, image_bytes, prompt, media_type="image/jpeg"):
        FakeScanClient.prompts.append(prompt)
        if prompt == "person":
            if FakeScanClient.people_fails:
                raise RuntimeError("SAM down")
            return [{"box": b} for b in FakeScanClient.people], {}, 0.0025
        if prompt == "grocery shelf":
            return [{"box": [0, 100, 640, 200]}, {"box": [0, 220, 320, 300]}], {}, 0.0025
        if prompt == "aisle sign":
            return [{"box": [160, 0, 480, 48]}], {}, 0.0025
        return [], {}, 0.0025

    def chat(self, messages, mode="standard", **k):
        url = messages[1]["content"][1]["image_url"]["url"]
        FakeScanClient.read_images.append(url)
        FakeScanClient.prompts.append("chat")
        return FakeScanClient.reads.pop(0), {}, 0.004


READ = ('{"label": "Aisle 4", "sign": "Aisle 4 Dairy", "items": ["Milk", "Eggs"], '
        '"prices": [{"item": "Eggs", "price": 3.49, "sure": true}, '
        '{"item": "Milk", "price": 2.1, "sure": false}]}')


class TestParse(unittest.TestCase):
    def test_unsure_and_unnamed_prices_are_dropped(self):
        from api import storescan
        out = storescan.parse_read(READ, prices=True)
        self.assertEqual(out["prices"], [{"item": "Eggs", "price": 3.49}])
        self.assertEqual(out["sign"], "Aisle 4 Dairy")
        bad = storescan.parse_read('{"label": "Dairy", "prices": [{"item": "", "price": 1, "sure": true}, '
                                   '{"item": "Milk", "price": "free", "sure": true}]}', prices=True)
        self.assertEqual(bad["prices"], [])

    def test_prices_need_the_opt_in(self):
        from api import storescan
        self.assertEqual(storescan.parse_read(READ, prices=False)["prices"], [])
        self.assertIn("always []", storescan.prompt(False))
        self.assertIn("Never guess a price", storescan.prompt(True))

    def test_boxes_become_fractions(self):
        from api import storescan
        self.assertEqual(storescan.norm_boxes([{"box": [0, 120, 320, 480]}], 640, 480),
                         [[0.0, 0.25, 0.5, 1.0]])


class TestScanRoute(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        os.environ.pop("ARYA_SCAN_DAILY_FRAMES", None)
        FakeScanClient.people, FakeScanClient.people_fails = [], False
        FakeScanClient.reads, FakeScanClient.read_images, FakeScanClient.prompts = [], [], []
        from api import main, deps
        deps.MetaClient = FakeScanClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com", "password": "long-password"})
        assert r.status_code == 200, r.text

    def scan(self, data, prices=False):
        params = {"store": "New Store|s-1"}
        if prices:
            params["prices"] = "1"
        return self.c.post("/api/storemap/scan", params=params, content=data,
                           headers={"Content-Type": "image/jpeg"})

    def total(self):
        return self.c.get("/api/storemap", params={"store": "New Store|s-1"}).json()["total"]

    def test_a_frame_lands_with_its_outlines(self):
        FakeScanClient.reads = [READ]
        out = self.scan(jpeg(1)).json()
        self.assertTrue(out["kept"])
        self.assertEqual((out["label"], out["sign"]), ("Aisle 4", "Aisle 4 Dairy"))
        self.assertEqual(out["boxes"]["shelf"][0], [0.0, 0.2083, 1.0, 0.4167])
        self.assertEqual(out["boxes"]["sign"], [[0.25, 0.0, 0.75, 0.1]])
        self.assertEqual(out["prices"], [])           # no opt-in
        self.assertEqual(self.total(), 1)
        # People are scrubbed before the read; the read never sees them.
        self.assertLess(FakeScanClient.prompts.index("person"), FakeScanClient.prompts.index("chat"))

    def test_an_aisle_sign_sizes_the_store(self):
        FakeScanClient.reads = [READ.replace('"Aisle 4 Dairy"', '"Aisle 12 Dairy"')]
        self.scan(jpeg(1))
        v = self.c.get("/api/storemap", params={"store": "New Store|s-1"}).json()
        self.assertEqual((v["aisles"], v["expected"], v["seen"]), (12, 18, 1))
        self.assertEqual(v["coverage_pct"], 6)

    def test_the_read_sees_only_the_scrubbed_frame(self):
        import base64
        FakeScanClient.people = [[100, 100, 300, 300]]
        FakeScanClient.reads = [READ]
        raw = jpeg(2, w=1600, h=1200)
        self.scan(raw)
        seen = base64.b64decode(FakeScanClient.read_images[0].split(",", 1)[1])
        self.assertNotEqual(seen, raw)
        self.assertLessEqual(max(Image.open(io.BytesIO(seen)).size), 960)

    def test_scrub_failure_reads_and_keeps_nothing(self):
        FakeScanClient.people_fails = True
        FakeScanClient.reads = [READ]
        self.assertEqual(self.scan(jpeg(1)).status_code, 503)
        self.assertEqual(FakeScanClient.read_images, [])
        self.assertEqual(self.total(), 0)

    def test_a_frame_full_of_people_pauses(self):
        FakeScanClient.people = [[0, 0, 640, 480]]
        FakeScanClient.reads = [READ]
        out = self.scan(jpeg(1)).json()
        self.assertEqual(out["paused"], "people")
        self.assertFalse(out["kept"])
        self.assertEqual(FakeScanClient.read_images, [])
        self.assertEqual(self.total(), 0)

    def test_a_frame_with_no_shelf_keeps_nothing(self):
        FakeScanClient.reads = ['{"label": "", "sign": "", "items": [], "prices": []}']
        out = self.scan(jpeg(1)).json()
        self.assertFalse(out["kept"])
        self.assertEqual(self.total(), 0)

    def test_sure_prices_are_kept_with_the_opt_in(self):
        from api import auth, state, storescan  # noqa: F401
        FakeScanClient.reads = [READ]
        out = self.scan(jpeg(1), prices=True).json()
        self.assertEqual(out["prices"], [{"item": "Eggs", "price": 3.49}])

    def test_the_daily_cap_holds(self):
        os.environ["ARYA_SCAN_DAILY_FRAMES"] = "2"
        self.addCleanup(os.environ.pop, "ARYA_SCAN_DAILY_FRAMES", None)
        FakeScanClient.reads = [READ, READ, READ]
        self.assertEqual(self.scan(jpeg(1)).json()["frames_left"], 1)
        self.assertEqual(self.scan(jpeg(2)).json()["frames_left"], 0)
        r = self.scan(jpeg(3))
        self.assertEqual(r.status_code, 429)
        self.assertEqual(len(FakeScanClient.read_images), 2)


if __name__ == "__main__":
    unittest.main()
