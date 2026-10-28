"""Map my store (owner, 2026-10-28): the guided, crowd-built store map.

Pinned here: zone merging, segment status, the capture grade and its
one-line retake fixes, best-capture selection (duplicates dropped,
freshness counts), prompts that follow the shopper's focus and the
stale flags, merging many accounts into one map, the walkthrough seed,
and the capture route (people scrub fails closed, a weak frame costs
no model call, the demo sandbox never touches the shared map).
"""
import io, os, tempfile, unittest
from datetime import datetime, timedelta

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def jpeg(seed=1, w=640, h=480, kind="sharp"):
    rng = np.random.default_rng(seed)
    if kind == "sharp":
        a = rng.integers(0, 255, (h, w, 3), dtype=np.uint8)
    elif kind == "flat":
        a = np.full((h, w, 3), 128, dtype=np.uint8)
    elif kind == "dark":
        a = rng.integers(0, 40, (h, w, 3), dtype=np.uint8)
    elif kind == "bright":
        a = rng.integers(220, 255, (h, w, 3), dtype=np.uint8)
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, "JPEG", quality=90)
    return buf.getvalue()


def fresh_data():
    os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()


class TestZones(unittest.TestCase):
    def test_zone_key_merges_aisle_spellings(self):
        from api import storemap as sm
        self.assertEqual(sm.zone_key("Aisle 4"), "aisle-4")
        self.assertEqual(sm.zone_key("aisle #4 - Pasta"), "aisle-4")
        self.assertEqual(sm.zone_key("Frozen Pizza Shelf"),
                         sm.zone_key("frozen pizza"))
        self.assertEqual(sm.store_key("Trader Joe's"), sm.store_key("trader joes"))


class TestEngine(unittest.TestCase):
    def setUp(self):
        fresh_data()
        from api import state, storemap
        self.sm = storemap
        state.set_current_user("ana")
        state.set_overlay(None)

    def test_add_segment_is_idempotent_and_validated(self):
        seg, created = self.sm.add_segment("Corner Store", "Aisle 4", "left")
        self.assertTrue(created)
        _, again = self.sm.add_segment("Corner Store", "aisle #4", "left")
        self.assertFalse(again)
        _, other_side = self.sm.add_segment("Corner Store", "Aisle 4", "right")
        self.assertTrue(other_side)
        with self.assertRaises(ValueError):
            self.sm.add_segment("Corner Store", "  ", "left")
        with self.assertRaises(ValueError):
            self.sm.add_segment("Corner Store", "Aisle 5", "up")

    def test_score_refuses_weak_captures_with_a_fix(self):
        self.assertIsNone(self.sm.score_image(jpeg(1))["fix"])
        self.assertIn("blurry", self.sm.score_image(jpeg(kind="flat"))["fix"])
        self.assertIn("dark", self.sm.score_image(jpeg(kind="dark"))["fix"])
        self.assertIn("bright", self.sm.score_image(jpeg(kind="bright"))["fix"])
        self.assertIn("closer", self.sm.score_image(jpeg(1), shelf_fill=0.05)["fix"])
        # An unrun shelf check is neutral, never a penalty.
        self.assertIsNone(self.sm.score_image(jpeg(1), shelf_fill=None)["fix"])

    def test_ingest_maps_a_segment_and_refuses_a_blurry_one(self):
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        sid = "aisle-4:left"
        bad = self.sm.ingest("Corner Store", sid, jpeg(kind="flat"))
        self.assertFalse(bad["accepted"])
        self.assertIn("blurry", bad["fix"])
        self.assertEqual(self.sm.view("Corner Store")["counts"]["unmapped"], 1)
        ok = self.sm.ingest("Corner Store", sid, jpeg(1))
        self.assertTrue(ok["accepted"])
        self.assertTrue(ok["best"])
        self.assertEqual(ok["status"], "mapped")
        v = self.sm.view("Corner Store")
        self.assertEqual((v["total"], v["coverage_pct"]), (1, 100))
        self.assertIsNotNone(self.sm.best_image("Corner Store", sid))

    def test_duplicates_are_dropped_and_only_the_best_few_kept(self):
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        sid = "aisle-4:left"
        self.sm.ingest("Corner Store", sid, jpeg(1))
        dup = self.sm.ingest("Corner Store", sid, jpeg(1))
        self.assertTrue(dup["duplicate"])
        for seed in (2, 3, 4, 5):
            self.sm.ingest("Corner Store", sid, jpeg(seed))
        doc = self.sm.load_map("Corner Store")
        self.assertEqual(len(doc["segments"][sid]["captures"]),
                         self.sm.KEEP_PER_SEGMENT)
        blobs = self.sm._image_blobs()[doc["key"]]
        self.assertEqual(len(blobs), self.sm.KEEP_PER_SEGMENT)

    def test_freshness_beats_an_old_equal_capture(self):
        now = datetime.now()
        old = {"id": "o", "at": (now - timedelta(days=90)).isoformat(),
               "score": 0.9, "dhash": "0" * 16}
        new = {"id": "n", "at": now.isoformat(), "score": 0.7,
               "dhash": "f" * 16}
        best = self.sm.select_best([old, new], keep=1, now=now)
        self.assertEqual(best[0]["id"], "n")

    def test_status_ages_and_stale_flag_clears_on_a_new_capture(self):
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        sid = "aisle-4:left"
        self.sm.ingest("Corner Store", sid, jpeg(1))
        doc = self.sm.load_map("Corner Store")
        doc["segments"][sid]["captures"][0]["at"] = (
            datetime.now() - timedelta(days=100)).isoformat(timespec="seconds")
        self.sm._save_map(doc)
        self.assertEqual(self.sm.view("Corner Store")["segments"][0]["status"],
                         "aging")
        task = self.sm.flag_outdated("Corner Store", seg_id=sid)
        self.assertEqual(task["prompt"]["kind"], "photo")
        self.assertEqual(self.sm.view("Corner Store")["segments"][0]["status"],
                         "stale")
        res = self.sm.ingest("Corner Store", sid, jpeg(9))
        self.assertEqual(res["status"], "mapped")

    def test_not_found_finds_the_segment_where_the_item_was_seen(self):
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        self.sm.add_segment("Corner Store", "Aisle 5", "left")
        self.sm.note_sighting("Corner Store", "Frozen Pizza", "Aisle 5 shelf")
        task = self.sm.flag_outdated("Corner Store", item="Frozen Pizza",
                                     reason="not_found")
        self.assertEqual(task["segment"], "aisle-5:left")
        self.assertIn("Frozen Pizza", task["prompt"]["why"])
        # Unknown item: parked, and the prompt asks which aisle.
        lost = self.sm.flag_outdated("Corner Store", item="Tahini")
        self.assertIsNone(lost["segment"])
        self.assertEqual(self.sm.view("Corner Store")["unplaced"], ["tahini"])

    def test_prompts_follow_stale_then_focus_then_walks(self):
        for label, side in (("Aisle 1", "left"), ("Aisle 1", "right"),
                            ("Aisle 2", "left")):
            self.sm.add_segment("Corner Store", label, side)
        # Nothing mapped, no focus: Aisle 1 has two empty sides, one walk.
        p = self.sm.next_prompt("Corner Store", focus=["aisle-1:left"])
        self.assertEqual((p["kind"], p["segment"]), ("walk", "aisle-1:left"))
        # Focus on one aisle: the prompt stays inside it.
        p = self.sm.next_prompt("Corner Store", focus=["aisle-2:left"])
        self.assertEqual(p["segment"], "aisle-2:left")
        self.assertEqual(p["kind"], "photo")
        self.assertTrue(all(isinstance(s, str) for s in p["steps"]))
        # A stale flag outranks empty segments.
        self.sm.ingest("Corner Store", "aisle-2:left", jpeg(2))
        self.sm.flag_outdated("Corner Store", seg_id="aisle-2:left")
        self.assertEqual(self.sm.next_prompt("Corner Store")["segment"],
                         "aisle-2:left")
        # Everything mapped: nothing to ask.
        self.sm.ingest("Corner Store", "aisle-2:left", jpeg(7))
        for sid in ("aisle-1:left", "aisle-1:right"):
            self.sm.ingest("Corner Store", sid, jpeg(hash(sid) % 1000))
        self.assertIsNone(self.sm.next_prompt("Corner Store"))

    def test_many_accounts_merge_into_one_map(self):
        from api import state
        self.sm.add_segment("Corner Store", "Aisle 1", "left")
        self.sm.ingest("Corner Store", "aisle-1:left", jpeg(1))
        state.set_current_user("ben")
        self.sm.add_segment("Corner Store", "Aisle 2", "left")
        self.sm.ingest("Corner Store", "aisle-2:left", jpeg(2))
        v = self.sm.view("Corner Store")
        self.assertEqual((v["total"], v["counts"]["mapped"]), (2, 2))
        by = {c["by"] for s in self.sm.load_map("Corner Store")["segments"].values()
              for c in s["captures"]}
        self.assertEqual(len(by), 2)
        self.assertFalse({"ana", "ben"} & by)   # hashed, never the username

    def test_focus_is_per_account(self):
        from api import state
        self.sm.add_segment("Corner Store", "Aisle 1", "left")
        self.sm.set_focus("Corner Store", ["aisle-1:left", "nope"])
        self.assertEqual(self.sm.get_focus("Corner Store"), ["aisle-1:left"])
        state.set_current_user("ben")
        self.assertEqual(self.sm.get_focus("Corner Store"), [])

    def test_demo_sandbox_never_writes_the_shared_map(self):
        from api import state
        state.set_overlay({})
        try:
            self.sm.add_segment("Corner Store", "Aisle 9", "left")
            self.sm.ingest("Corner Store", "aisle-9:left", jpeg(3))
            self.assertEqual(self.sm.view("Corner Store")["total"], 1)
        finally:
            state.set_overlay(None)
        self.assertEqual(self.sm.view("Corner Store")["total"], 0)

    def test_walkthrough_seeds_trader_joes_as_aging_with_photos(self):
        v = self.sm.view("Trader Joe's")
        self.assertGreater(v["total"], 10)
        self.assertEqual(v["counts"]["mapped"], 0)
        self.assertEqual(v["counts"]["aging"], v["total"])
        self.assertTrue(any(s["has_photo"] for s in v["segments"]))
        self.assertIsNotNone(v["next"])


class FakeClient:
    people_fails = False
    calls = []

    def __init__(self, *a, **k):
        pass

    def segment(self, image_bytes, prompt, media_type="image/jpeg"):
        FakeClient.calls.append(prompt)
        if prompt == "person" and FakeClient.people_fails:
            raise RuntimeError("SAM down")
        if prompt == "grocery shelf":
            return [{"box": [0, 0, 480, 360], "w": 640, "h": 480,
                     "confidence": 0.9}], {}, 0.0025
        return [], {}, 0.0025


class TestRoutes(unittest.TestCase):
    def setUp(self):
        fresh_data()
        FakeClient.calls, FakeClient.people_fails = [], False
        from api import main, state
        main.MetaClient = FakeClient
        main._login_fails.clear()
        self.c = TestClient(main.app)
        state._save("dictionary.json", {"entries": []})
        state._save("receipts.json", [])
        r = self.c.post("/auth/setup", json={"username": "owner@example.com",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text
        self.store = "Corner Store"

    def add(self, label="Aisle 4", side="left"):
        r = self.c.post("/api/storemap/segments",
                        json={"store": self.store, "label": label, "side": side})
        assert r.status_code == 200, r.text
        return r.json()["segment"]

    def capture(self, sid, data):
        return self.c.post("/api/storemap/capture", params={
            "store": self.store, "segment": sid}, content=data,
            headers={"Content-Type": "image/jpeg"})

    def test_guided_flow_end_to_end(self):
        sid = self.add()
        v = self.c.get("/api/storemap", params={"store": self.store}).json()
        self.assertEqual(v["next"]["segment"], sid)
        r = self.capture(sid, jpeg(1))
        self.assertEqual(r.status_code, 200, r.text)
        out = r.json()
        self.assertTrue(out["accepted"])
        self.assertIn("person", FakeClient.calls)       # scrub ran first
        v = self.c.get("/api/storemap", params={"store": self.store}).json()
        self.assertEqual(v["coverage_pct"], 100)
        self.assertIsNone(v["next"])
        photo = self.c.get("/api/storemap/photo",
                           params={"store": self.store, "segment": sid})
        self.assertEqual(photo.status_code, 200)
        self.assertEqual(photo.headers["content-type"], "image/jpeg")

    def test_weak_frame_is_refused_before_any_model_call(self):
        sid = self.add()
        r = self.capture(sid, jpeg(kind="flat"))
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["accepted"])
        self.assertIn("blurry", r.json()["fix"])
        self.assertEqual(FakeClient.calls, [])

    def test_nothing_is_kept_when_the_people_scrub_fails(self):
        sid = self.add()
        FakeClient.people_fails = True
        r = self.capture(sid, jpeg(1))
        self.assertEqual(r.status_code, 503)
        v = self.c.get("/api/storemap", params={"store": self.store}).json()
        self.assertEqual(v["counts"]["unmapped"], 1)

    def test_unknown_segment_and_non_image(self):
        self.assertEqual(self.capture("nope:left", jpeg(1)).status_code, 404)
        sid = self.add()
        r = self.c.post("/api/storemap/capture", params={
            "store": self.store, "segment": sid}, content=b"x",
            headers={"Content-Type": "text/plain"})
        self.assertEqual(r.status_code, 415)

    def test_outdated_tap_returns_the_capture_to_ask_for(self):
        sid = self.add()
        self.capture(sid, jpeg(1))
        r = self.c.post("/api/storemap/outdated",
                        json={"store": self.store, "segment": sid})
        self.assertEqual(r.json()["segment"], sid)
        nxt = self.c.get("/api/storemap/next",
                         params={"store": self.store}).json()["prompt"]
        self.assertEqual(nxt["segment"], sid)

    def test_not_here_report_flags_the_map_and_asks_for_a_photo(self):
        sid = self.add("Aisle 5", "left")
        s = self.c.post("/api/quest/sessions", json={
            "store": self.store, "mode": "quest",
            "items": [{"name": "Frozen Pizza"}]}).json()
        from api import storemap
        storemap.note_sighting(self.store, "Frozen Pizza", "Aisle 5")
        r = self.c.post(f"/api/quest/sessions/{s['id']}/report-missing",
                        json={"item": "Frozen Pizza", "kind": "empty_shelf"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["map_task"]["segment"], sid)
        v = self.c.get("/api/storemap", params={"store": self.store}).json()
        self.assertEqual(v["segments"][0]["status"], "stale")

    def test_store_is_required_and_bad_side_is_400(self):
        self.assertEqual(self.c.get("/api/storemap").status_code, 400)
        r = self.c.post("/api/storemap/segments",
                        json={"store": self.store, "label": "A", "side": "up"})
        self.assertEqual(r.status_code, 400)


if __name__ == "__main__":
    unittest.main()
