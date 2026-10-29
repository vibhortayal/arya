"""Shelf Scan (Discussion 37): SAM-from-list + Spark verify.

Endpoint tests run with stubbed SAM/Spark clients scripted from the
feasibility spike's measured outcomes (~/workspace/arya-3d/
shelf-scan/REPORT.md): the frozen-pizza pop, the cookies top-3
rescue (best box is bread, the second is cookies), the pasta-sauce
rejection, the olive-oil region-grade pop, cheese silence. The
three spike fixes are pinned: top-3 verify, the box-area cap
(over-cap ignored while an in-cap box exists; region grade when
only over-cap exists), and the phrasing bank.

Client behavior runs under vitest (web/src/screens/hunt/scan.test.tsx,
the port of the old node harness): the live sampling policy (diff threshold, ~1 s hold,
3 s settle floor, 2 s continued-change ceiling, stale-pop clear),
pop overlay replacement, and stop releasing the camera.
"""
import io, json, os, re, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

FRAME_W, FRAME_H = 1600, 900


from tests.frontend import read, src  # noqa: E402


def _box(x1, y1, x2, y2, conf):
    return {"box": [x1, y1, x2, y2], "w": FRAME_W, "h": FRAME_H,
            "confidence": conf}


# SAM answers by prompt, scripted from the spike (see docstring).
SEGMENTS = {
    # A wall-sized box outranks the real one — the area cap must
    # drop it while an in-cap box exists.
    "frozen pizza boxes": [_box(0, 0, 1600, 800, 0.99),
                           _box(100, 100, 400, 300, 0.90)],
    "jars of pasta sauce on a shelf": [_box(200, 200, 500, 400, 0.90),
                                       _box(600, 200, 900, 400, 0.80)],
    # Best box is bread; the cookies are the second box.
    "boxes of cookies on a shelf": [_box(0, 0, 300, 200, 0.95),
                                    _box(500, 100, 800, 300, 0.80)],
    # The only box is a whole shelf row: 58% of frame area.
    "rows of oil and vinegar bottles on a shelf": [_box(0, 0, 1200, 700, 0.90)],
}
VERDICTS = {  # per item, in call order; the last one repeats
    "Frozen Pizza": ["YES"],
    "Pasta Sauce": ["NO: mayonnaise"],
    "Cookies": ["NO: bread", "YES"],
    "Olive Oil": ["YES"],
}


class FakeScanClient:
    calls = {"segment": [], "chat": []}

    def __init__(self, *a, **k):
        pass

    def segment(self, image_bytes, prompt, media_type="image/jpeg"):
        FakeScanClient.calls["segment"].append(prompt)
        return list(SEGMENTS.get(prompt, [])), {"images_processed": 1}, 0.0025

    def chat(self, messages, mode="standard", personal=False, **k):
        text = messages[0]["content"][0]["text"]
        item = re.search(r"item: (.+?)\.", text).group(1)
        FakeScanClient.calls["chat"].append(item)
        script = VERDICTS[item]
        idx = min(FakeScanClient.calls["chat"].count(item) - 1, len(script) - 1)
        return script[idx], {"input_tokens": 10, "cached_tokens": 0,
                             "output_tokens": 2}, 0.001


def jpeg_bytes():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (FRAME_W, FRAME_H), (120, 110, 100)).save(buf, "JPEG")
    return buf.getvalue()


class TestScanEndpoint(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        FakeScanClient.calls = {"segment": [], "chat": []}
        from api import main, state
        from api import deps
        deps.MetaClient = FakeScanClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        state._save("dictionary.json", {"entries": []})
        state._save("receipts.json", [])
        r = self.c.post("/auth/setup", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text
        r = self.c.post("/api/quest/sessions", json={
            "store": "Corner Store", "mode": "quest",
            "items": [{"name": n} for n in
                      ("Frozen Pizza", "Pasta Sauce", "Cookies",
                       "Olive Oil", "Cheese")]})
        assert r.status_code == 200, r.text
        self.sid = r.json()["id"]

    def scan(self, sid=None):
        return self.c.post(f"/api/quest/scan-shelf?session={sid or self.sid}",
                           content=jpeg_bytes(),
                           headers={"Content-Type": "image/jpeg"})

    def test_verified_pops_with_the_three_fixes(self):
        r = self.scan()
        assert r.status_code == 200, r.text
        out = r.json()
        pops = {p["item"]: p for p in out["pops"]}
        # Item-grade pop on the IN-CAP box despite the bigger,
        # higher-confidence wall box (area cap).
        self.assertEqual(pops["Frozen Pizza"]["box"],
                         [0.0625, 0.1111, 0.25, 0.3333])
        self.assertEqual(pops["Frozen Pizza"]["grade"], "item")
        # Top-3 rescue: the best box verified NO (bread), the
        # second box is the pop.
        self.assertEqual(pops["Cookies"]["box"],
                         [0.3125, 0.1111, 0.5, 0.3333])
        self.assertEqual(pops["Cookies"]["grade"], "item")
        # Only an over-cap box exists: it pops, graded region.
        self.assertEqual(pops["Olive Oil"]["grade"], "region")
        self.assertEqual(pops["Olive Oil"]["box"], [0.0, 0.0, 0.75, 0.7778])
        # Rejected crops and zero-box items are not_found, in order.
        self.assertEqual(out["not_found"], ["Pasta Sauce", "Cheese"])
        # Cookies took exactly two verifies; cheese burned its
        # whole phrasing bank (4) and never reached verify.
        self.assertEqual(FakeScanClient.calls["chat"].count("Cookies"), 2)
        self.assertNotIn("Cheese", FakeScanClient.calls["chat"])
        cheese_prompts = [p for p in FakeScanClient.calls["segment"]
                          if "cheese" in p]
        self.assertEqual(len(cheese_prompts), 4)

    def test_collected_items_are_not_scanned(self):
        r = self.c.post(f"/api/quest/sessions/{self.sid}/check",
                        json={"item": "Cookies", "checked": True})
        assert r.status_code == 200, r.text
        out = self.scan().json()
        names = [p["item"] for p in out["pops"]] + out["not_found"]
        self.assertNotIn("Cookies", names)
        self.assertNotIn("boxes of cookies on a shelf",
                         FakeScanClient.calls["segment"])

    def test_find_it_for_me_scans_only_the_target(self):
        # Owner, 2026-10-28: aimed at one item — one item's calls.
        r = self.c.post(f"/api/quest/scan-shelf?session={self.sid}&item=Cookies",
                        content=jpeg_bytes(), headers={"Content-Type": "image/jpeg"})
        assert r.status_code == 200, r.text
        out = r.json()
        self.assertEqual([p["item"] for p in out["pops"]], ["Cookies"])
        self.assertEqual(out["not_found"], [])
        from api import shelfscan
        aimed = [p for p in FakeScanClient.calls["segment"]
                 if p not in shelfscan.PEOPLE_PROMPTS]
        self.assertTrue(aimed and all("cookie" in p for p in aimed), aimed)
        # A target not left on the list answers not found, no calls.
        FakeScanClient.calls = {"segment": [], "chat": []}
        r = self.c.post(f"/api/quest/scan-shelf?session={self.sid}&item=Milk",
                        content=jpeg_bytes(), headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.json(), {"pops": [], "not_found": ["Milk"]})
        self.assertEqual(FakeScanClient.calls["segment"], [])

    def test_pops_feed_the_map_and_the_frame_is_dropped(self):
        self.scan()
        sightings = self.quest_file()["sightings"]
        self.assertEqual(sorted(x["item"] for x in sightings),
                         ["Cookies", "Frozen Pizza", "Olive Oil"])
        for x in sightings:
            self.assertEqual(x["store"], "Corner Store")
            self.assertEqual(set(x), {"store", "item", "item_group", "shelf_label",
                                      "grade", "seen_at", "session_id"})
        # The scrub ran (SAM asked for people) before any frame was kept,
        # and no raw image file lands in the data dir.
        self.assertIn("person", FakeScanClient.calls["segment"])
        for root, _d, files in os.walk(os.environ["ARYA_DATA_DIR"]):
            for f in files:
                self.assertFalse(f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")), f)
        r = self.c.get("/api/quest/shelf-photo",
                       params={"store": "Corner Store", "item": "Cookies"})
        self.assertEqual(r.status_code, 200, r.text)
        rec = r.json()
        self.assertTrue(rec["image"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(len(rec["box"]), 4)
        self.assertEqual(rec["people_scrubbed"], 0)
        self.assertEqual(self.c.get("/api/quest/shelf-photo", params={
            "store": "Corner Store", "item": "Cheese"}).status_code, 404)

    def test_no_frame_is_kept_when_the_scrub_fails(self):
        orig = FakeScanClient.segment
        def segment(self, image_bytes, prompt, media_type="image/jpeg"):
            if prompt == "person":
                raise RuntimeError("SAM down")
            return orig(self, image_bytes, prompt, media_type)
        FakeScanClient.segment = segment
        try:
            self.assertEqual(self.scan().status_code, 200)
        finally:
            FakeScanClient.segment = orig
        self.assertEqual(self.c.get("/api/quest/shelf-photo", params={
            "store": "Corner Store", "item": "Cookies"}).status_code, 404)

    def quest_file(self):
        for root, _d, files in os.walk(os.environ["ARYA_DATA_DIR"]):
            if "quest.json" in files:
                with open(os.path.join(root, "quest.json")) as fh:
                    return json.load(fh)
        self.fail("no quest.json")

    def test_session_and_media_guards(self):
        self.assertEqual(self.scan(sid="nope").status_code, 404)
        r = self.c.post(f"/api/quest/scan-shelf?session={self.sid}",
                        content=b"not an image",
                        headers={"Content-Type": "text/plain"})
        self.assertEqual(r.status_code, 415)


class TestScanDemoCarveOut(unittest.TestCase):
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
        deps.MetaClient = FakeScanClient
        c = TestClient(main.app)
        c.post("/auth/demo")
        # The demo household is read-only for other doors...
        self.assertEqual(c.post("/decode/pdf", content=b"x").status_code, 403)
        # ...but the scan door is live for it: the request reaches
        # the route and fails only on the unknown session.
        r = c.post("/api/quest/scan-shelf?session=nope",
                   content=jpeg_bytes(),
                   headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 404)


class TestPhrasingBank(unittest.TestCase):
    def test_bank_and_fallback(self):
        from api import shelfscan
        # The measured olive-oil winner leads its entry.
        self.assertEqual(shelfscan.phrasings_for("Olive Oil")[0],
                         "rows of oil and vinegar bottles on a shelf")
        # "Pasta Sauce" hits the sauce entry, not the pasta one.
        self.assertIn("jars of pasta sauce",
                      shelfscan.phrasings_for("Pasta Sauce")[0])
        self.assertIn("bags of dried pasta",
                      shelfscan.phrasings_for("Pasta")[0])
        # Unknown items get the descriptive general fallback.
        fb = shelfscan.phrasings_for("Dragon Fruit")
        self.assertEqual(fb[0], "dragon fruit on a grocery shelf")
        self.assertEqual(fb[-1], "grocery products")
        self.assertEqual(shelfscan.AREA_CAP, 0.35)
        self.assertEqual(shelfscan.TOP_N, 3)


class TestScanShell(unittest.TestCase):
    """Over the React scan view (web/src/screens/hunt/Scan.tsx, the port
    of quest.js openScanView .. closeScan) and the hunt."""

    def test_scan_chrome_in_hunt_absent_elsewhere(self):
        scan, hunt = src("screens/hunt/Scan.tsx"), src("screens/Hunt.tsx")
        for el in ("scan-photo", "scan-overlay", "scan-video",
                   "scan-img", "scan-boxes", "scan-status", "scan-stop",
                   "scan-usephoto", "scan-last", "scan-close"):
            self.assertIn(f'id="{el}"', scan)
        self.assertIn('capture="environment"', scan)
        self.assertIn('id="btn-scan"', hunt)
        self.assertIn("<ScanView ", hunt)
        self.assertNotIn('id="btn-scan"', src("screens/Express.tsx"))

    def test_scan_gated_to_the_strip_rung(self):
        js = src("screens/hunt/Scan.tsx")
        self.assertIn('id="btn-scan" className="btn toolbtn" type="button" hidden={driverName !== "strip"}',
                      src("screens/Hunt.tsx"))
        self.assertIn("getUserMedia", js)
        self.assertIn("wakeLock", js)
        self.assertIn("/api/quest/scan-shelf?session=", js)
        self.assertIn("export function createScanSampler()", js)
        # Copy discipline: the lag is shown, "real-time" is never claimed.
        self.assertIn("Live scan", js)
        self.assertIn("Last scan", js)
        self.assertNotIn("real-time", js.lower())
        self.assertIn(".scanoverlay", read("styles.css"))
        self.assertIn(".scanpop", read("styles.css"))

    def test_no_pop_copy_is_exact(self):
        self.assertIn(
            'export const SCAN_NO_POP = "Nothing from your list spotted here — '
            "that doesn't mean it isn't here. Keep looking.\";", src("screens/hunt/Scan.tsx"))


class TestScanUnderVitest(unittest.TestCase):
    """The old node harness over quest.js (sampler, pops, status copy,
    camera life) runs in web/src/screens/hunt/scan.test.tsx."""

    def test_harness_checks_are_ported(self):
        t = src("screens/hunt/scan.test.tsx")
        for name in ("a calm scene never sends",
                     "a change, then a hold of about 1 s, sends at the hold mark; a second settle waits 3 s",
                     "continued change sends at most once in 2 s, and only after a first send",
                     "stale pops clear on a clearly moved view, once per move",
                     "pops render and replace; the status copy is exact",
                     "live start takes the camera and a wake lock; closing releases both"):
            self.assertIn(name, t)


class TestPeopleScrub(unittest.TestCase):
    def test_people_are_pixelated_and_products_untouched(self):
        from PIL import Image
        from api import shelfscan
        img = Image.new("RGB", (400, 300), (200, 200, 200))
        # A sharp checkerboard where the "person" stands, another on
        # the shelf: only the person's one may lose its detail.
        for x in range(400):
            for y in range(300):
                if (x // 2 + y // 2) % 2 and (40 <= x < 140 or 260 <= x < 360):
                    img.putpixel((x, y), (0, 0, 0))
        buf = io.BytesIO(); img.save(buf, "PNG")

        class C:
            def segment(self, b, prompt, media_type="image/jpeg"):
                if prompt == "person":
                    return [{"box": [40, 0, 140, 300], "confidence": .9}], {}, 0
                return [], {}, 0
        out, n = shelfscan.scrub_people(buf.getvalue(), C(), "image/png")
        self.assertEqual(n, 1)
        kept = Image.open(io.BytesIO(out)).convert("L")
        def spread(x0, x1):
            px = [kept.getpixel((x, y)) for x in range(x0, x1) for y in range(60, 240)]
            return max(px) - min(px)
        self.assertLess(spread(60, 120), 60)     # the person: mush
        self.assertGreater(spread(280, 340), 120)  # the shelf: sharp

    def test_scrub_fails_closed(self):
        from api import shelfscan
        class C:
            def segment(self, *a, **k):
                raise RuntimeError("down")
        self.assertEqual(shelfscan.scrub_people(jpeg_bytes(), C()), (None, 0))


class TestScrubWalkFrames(unittest.TestCase):
    def test_rewrites_in_place_skips_done_and_fails_closed(self):
        from PIL import Image
        from harness import scrub_walk_frames
        d = tempfile.mkdtemp()
        for n in ("f001.jpg", "f002.jpg"):
            Image.new("RGB", (160, 90), (9, 9, 9)).save(os.path.join(d, n), "JPEG")
        before = open(os.path.join(d, "f002.jpg"), "rb").read()

        class C:
            calls = 0
            def segment(self, b, prompt, media_type="image/jpeg"):
                C.calls += 1
                if C.calls > 2:  # f002's scrub fails
                    raise RuntimeError("down")
                return ([{"box": [0, 0, 80, 90]}] if prompt == "person" else []), {}, 0
        rc = scrub_walk_frames.main([], client=C(), frames_dir=d)
        self.assertEqual(rc, 1)
        log = json.load(open(os.path.join(d, "scrub.json")))
        self.assertEqual(log, {"f001.jpg": 1})
        self.assertEqual(open(os.path.join(d, "f002.jpg"), "rb").read(), before)
        self.assertEqual(Image.open(os.path.join(d, "f001.jpg")).size, (160, 90))
        C.calls = -100  # a re-run only touches what is left
        self.assertEqual(scrub_walk_frames.main([], client=C(), frames_dir=d), 0)
        self.assertEqual(set(json.load(open(os.path.join(d, "scrub.json")))),
                         {"f001.jpg", "f002.jpg"})
