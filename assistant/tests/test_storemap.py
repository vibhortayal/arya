"""Map my store (owner, 2026-10-28): the guided, crowd-built store map.

Pinned here: zone merging, segment status, the capture grade and its
one-line live hints (never a refusal), best-capture selection (duplicates dropped,
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


WALK = "Trader Joe's|tj-walk"   # the store the shipped walk was filmed in


class TestEngine(unittest.TestCase):
    def setUp(self):
        fresh_data()
        os.environ["ARYA_WALK_STORE_ID"] = "tj-walk"
        self.addCleanup(os.environ.pop, "ARYA_WALK_STORE_ID", None)
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

    def test_score_gives_a_live_hint_for_weak_captures(self):
        self.assertIsNone(self.sm.score_image(jpeg(1))["fix"])
        self.assertIn("blurry", self.sm.score_image(jpeg(kind="flat"))["fix"])
        self.assertIn("dark", self.sm.score_image(jpeg(kind="dark"))["fix"])
        self.assertIn("bright", self.sm.score_image(jpeg(kind="bright"))["fix"])
        # Fill shapes the score but never refuses a capture.
        low = self.sm.score_image(jpeg(1), shelf_fill=0.05)
        self.assertIsNone(low["fix"])
        self.assertLess(low["score"], self.sm.score_image(jpeg(1), shelf_fill=0.6)["score"])
        # An unrun shelf check is neutral, never a penalty.
        self.assertIsNone(self.sm.score_image(jpeg(1), shelf_fill=None)["fix"])

    def test_a_weak_shot_is_kept_as_a_partial_never_refused(self):
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        sid = "aisle-4:left"
        weak = self.sm.ingest("Corner Store", sid, jpeg(kind="flat"))
        self.assertTrue(weak["accepted"])
        self.assertTrue(weak["weak"])
        self.assertIn("blurry", weak["hint"])
        self.assertEqual(weak["status"], "aging")      # partial, ask later
        # A weak shot never counts toward the store being mapped.
        self.assertFalse(self.sm.view("Corner Store")["segments"][0]["located"])
        ok = self.sm.ingest("Corner Store", sid, jpeg(1))
        self.assertTrue(ok["accepted"])
        self.assertTrue(ok["best"])
        self.assertEqual(ok["status"], "mapped")
        v = self.sm.view("Corner Store")
        self.assertEqual((v["total"], v["coverage_pct"]), (1, 100))
        self.assertTrue(v["segments"][0]["located"])
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
        v = self.sm.view(WALK)
        self.assertGreater(v["total"], 10)
        self.assertEqual(v["counts"]["mapped"], 0)
        self.assertEqual(v["counts"]["aging"], v["total"])
        self.assertTrue(any(s["has_photo"] for s in v["segments"]))
        self.assertIsNotNone(v["next"])

    def test_walkthrough_frames_follow_the_path_not_the_frame_number(self):
        # 2026-10-29: the shipped frames are a thinned copy of the walk,
        # so the stop's path fraction picks the file (as the photo
        # driver does). The frame number left half the stops with no
        # picture and the rest with the wrong one.
        segs = self.sm.load_map(WALK)["segments"]
        self.assertEqual(segs["frozen-pizza:both"]["baseline"]["frame"], "f080.jpg")   # first seen at u 0.8894
        self.assertEqual(segs["canned-goods:both"]["baseline"]["frame"], "f029.jpg")   # u 0.3196
        v = self.sm.view(WALK)
        self.assertTrue(all(s["located"] for s in v["segments"]))

    def test_a_saved_map_takes_the_corrected_walk_frame(self):
        doc = self.sm.load_map(WALK)
        doc["segments"]["frozen-pizza:both"]["baseline"]["frame"] = None
        self.sm._save_map(doc)
        self.assertEqual(self.sm.load_map(WALK)["segments"]["frozen-pizza:both"]["baseline"]["frame"], "f080.jpg")

    def test_maps_are_per_location(self):
        # Owner 2026-10-29: a map only shows where it was made.
        self.sm.add_segment("Costco|c-1", "Aisle 4", "left")
        self.sm.ingest("Costco|c-1", "aisle-4:left", jpeg(1))
        self.assertEqual(self.sm.view("Costco|c-1")["total"], 1)
        self.assertEqual(self.sm.view("Costco|c-2")["total"], 0)
        self.assertEqual(self.sm.store_key("Costco|c-1"), "costco@c-1")
        self.assertEqual(self.sm.view("Costco|c-1")["store"], "Costco")

    def test_a_bare_name_means_my_one_store_of_that_chain(self):
        # A fresh account has the seed stores: one Trader Joe's (Chino Hills).
        self.assertEqual(self.sm.store_key("Trader Joe's"), "traderjoes@seed-trader-joes-91709")
        # A free-text store nobody has in My Stores stays chain-level.
        self.assertEqual(self.sm.store_key("Corner Store"), "cornerstore")

    def test_other_trader_joes_get_the_walk_only_as_a_typical_layout(self):
        mine = self.sm.view("Trader Joe's")          # Chino Hills, not the walk's store
        self.assertEqual((mine["total"], mine["typical"]), (0, "Trader Joe's"))
        walk = self.sm.view(WALK)
        self.assertGreater(walk["total"], 10)
        self.assertIsNone(walk["typical"])

    def test_the_walk_store_takes_over_the_old_chain_map(self):
        # Before 2026-10-29 the walk and its captures were saved under the chain.
        from api import state
        tok = state._current_user.set(None)
        try:
            doc = self.sm.load_map("Corner Store")    # any doc shape; re-key it
            doc.update(key="traderjoes", store="Trader Joe's",
                       segments=self.sm.walk_segments())
            doc["segments"]["pasta:both"]["captures"] = [{"id": "c1", "at": "2026-10-20T10:00:00", "by": "x", "score": 1.0}]
            self.sm._save_map(doc)
            self.sm._put_image("traderjoes", "c1", jpeg(4))
        finally:
            state._current_user.reset(tok)
        got = self.sm.load_map(WALK)
        self.assertEqual(got["key"], "traderjoes@tj-walk")
        self.assertEqual(len(got["segments"]["pasta:both"]["captures"]), 1)
        self.assertIsNotNone(self.sm.best_image(WALK, "pasta:both"))
        # Chino Hills does not inherit it.
        self.assertEqual(self.sm.view("Trader Joe's")["total"], 0)

    def test_no_store_has_the_walk_until_someone_says_which(self):
        # Owner 2026-10-29: the walk was not filmed on Argonaut; nobody
        # recorded where, so no store is mapped by it.
        os.environ.pop("ARYA_WALK_STORE_ID", None)
        from api import stores
        stores.create_store("Trader Joe's", "1 Argonaut Way", "Somewhere", "CA", "90000", "ana")
        self.assertIsNone(self.sm.walk_location())
        for ref in ("Trader Joe's", WALK):
            v = self.sm.view(ref)
            self.assertEqual((v["total"], v["typical"]), (0, "Trader Joe's"))

    def test_pictures_list_stays_keyed_by_chain(self):
        rows = {r["key"]: r for r in self.sm.stores_with_pictures()}
        self.assertTrue(rows["traderjoes"]["has_pictures"])
        # The walk's photos belong to one location; captures name theirs.
        self.assertEqual(rows["traderjoes"]["location"], "tj-walk")
        self.sm.add_segment("Trader Joe's|tj-9", "Aisle 4", "left")
        self.sm.ingest("Trader Joe's|tj-9", "aisle-4:left", jpeg(5))
        rows = {r["key"]: r for r in self.sm.stores_with_pictures()}
        self.assertIn("tj-9", rows["traderjoes"]["captured_at"])

    def test_a_label_with_no_picture_is_not_located(self):
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        self.assertFalse(self.sm.view("Corner Store")["segments"][0]["located"])


class FakeClient:
    people_fails = False
    calls = []
    shelf_sizes = []

    def __init__(self, *a, **k):
        pass

    def segment(self, image_bytes, prompt, media_type="image/jpeg"):
        FakeClient.calls.append(prompt)
        if prompt == "person" and FakeClient.people_fails:
            raise RuntimeError("SAM down")
        if prompt == "grocery shelf":
            # Live SAM returns one small box per shelf bay (27 on a real
            # walk frame; largest 12% of the frame, union 53%).
            FakeClient.shelf_sizes.append(len(image_bytes))
            return [{"box": [i * 20, 40, i * 20 + 18, 400], "w": 640, "h": 480,
                     "confidence": 0.8} for i in range(27)], {}, 0.0025
        return [], {}, 0.0025


class TestSplitAndRewards(unittest.TestCase):
    def setUp(self):
        fresh_data()
        from api import state, storemap
        self.sm = storemap
        state.set_current_user("ana")
        state.set_overlay(None)

    def test_split_is_ordered_idempotent_and_keeps_the_zone(self):
        self.sm.add_segment("Corner Store", "Aisle 4", "both")
        kids, made = self.sm.split_segment("Corner Store", "aisle-4:both", 3)
        self.assertTrue(made)
        self.assertEqual([k["label"] for k in kids], [
            "Aisle 4 \u00b7 front", "Aisle 4 \u00b7 middle", "Aisle 4 \u00b7 back"])
        self.assertTrue(all(k["zone"] == "aisle-4" for k in kids))
        again, made = self.sm.split_segment("Corner Store", "aisle-4:both", 2)
        self.assertFalse(made)
        self.assertEqual(len(again), 3)
        self.assertEqual(self.sm.split_segment("Corner Store", "aisle-4:both", 9)[1], False)

    def test_one_part_does_not_split_and_parts_are_capped(self):
        self.sm.add_segment("Corner Store", "Aisle 4", "both")
        kids, made = self.sm.split_segment("Corner Store", "aisle-4:both", 1)
        self.assertEqual((len(kids), made), (1, False))
        kids, _ = self.sm.split_segment("Corner Store", "aisle-4:both", 50)
        self.assertEqual(len(kids), self.sm.MAX_PARTS)

    def test_walk_prompt_lists_the_sections_in_order(self):
        self.sm.add_segment("Corner Store", "Aisle 4", "both")
        p = self.sm.next_prompt("Corner Store")
        self.assertTrue(p["splittable"])
        self.sm.split_segment("Corner Store", "aisle-4:both", 3)
        p = self.sm.next_prompt("Corner Store")
        self.assertEqual(p["kind"], "walk")
        self.assertEqual(p["parts"], ["aisle-4:both:1", "aisle-4:both:2", "aisle-4:both:3"])
        self.assertFalse(p["splittable"])

    def test_items_just_bought_pull_their_aisle_first(self):
        self.sm.add_segment("Corner Store", "Aisle 1", "left")
        self.sm.add_segment("Corner Store", "Aisle 2", "left")
        self.sm.note_sighting("Corner Store", "pasta", "Aisle 2")
        p = self.sm.next_prompt("Corner Store", hint_items=["Pasta"])
        self.assertEqual(p["segment"], "aisle-2:left")

    def test_rewards_titles_goal_and_no_penalty(self):
        for n in range(1, 5):
            self.sm.add_segment("Corner Store", f"Aisle {n}", "left")
        out = self.sm.ingest("Corner Store", "aisle-1:left", jpeg(1))
        rw = self.sm.award("Corner Store", out)
        self.assertEqual((rw["points"], rw["title"], rw["new_title"]), (10, "Scout", "Scout"))
        self.assertEqual(rw["store_pct"], [0, 25])
        self.assertEqual(rw["goal"], {"pct": 50, "sections_needed": 1})
        # the same view again is a small thank-you, never negative
        out = self.sm.ingest("Corner Store", "aisle-1:left", jpeg(1))
        rw = self.sm.award("Corner Store", out)
        self.assertEqual((rw["points"], rw["new_title"]), (3, None))
        self.assertEqual(rw["total_points"], 13)
        self.assertIsNone(self.sm.award("Corner Store", {"accepted": False}))


class TestRoutes(unittest.TestCase):
    def setUp(self):
        fresh_data()
        FakeClient.calls, FakeClient.people_fails = [], False
        FakeClient.shelf_sizes = []
        from api import main, state
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
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
        self.assertIn("grocery shelf", FakeClient.calls)
        # Many small bay boxes must not read as "too far": the capture
        # is accepted, and the fill check ran on the scrubbed JPEG.
        self.assertEqual(len(FakeClient.shelf_sizes), 1)
        v = self.c.get("/api/storemap", params={"store": self.store}).json()
        self.assertEqual(v["coverage_pct"], 100)
        self.assertIsNone(v["next"])
        photo = self.c.get("/api/storemap/photo",
                           params={"store": self.store, "segment": sid})
        self.assertEqual(photo.status_code, 200)
        self.assertEqual(photo.headers["content-type"], "image/jpeg")

    def test_weak_frame_is_still_accepted_and_scrubbed(self):
        sid = self.add()
        r = self.capture(sid, jpeg(kind="flat"))
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["accepted"])
        self.assertTrue(r.json()["weak"])
        self.assertIn("person", FakeClient.calls)

    def test_capture_returns_a_reward(self):
        sid = self.add()
        rw = self.capture(sid, jpeg(1)).json()["reward"]
        self.assertEqual(rw["points"], 10)
        self.assertEqual(rw["title"], "Scout")
        self.assertEqual(rw["store_pct"], [0, 100])
        self.assertTrue(rw["new_section"])

    def test_split_route_and_walk_fill_sections(self):
        sid = self.add("Aisle 9", "both")
        r = self.c.post("/api/storemap/split", json={
            "store": self.store, "segment": sid, "parts": 3}).json()
        self.assertTrue(r["created"])
        ids = [x["id"] for x in r["segments"]]
        self.assertEqual(ids, [f"{sid}:1", f"{sid}:2", f"{sid}:3"])
        again = self.c.post("/api/storemap/split", json={
            "store": self.store, "segment": sid, "parts": 5}).json()
        self.assertFalse(again["created"])
        self.assertEqual([x["id"] for x in again["segments"]], ids)
        for k, i in enumerate(ids):
            self.assertTrue(self.capture(i, jpeg(10 + k)).json()["accepted"])
        v = self.c.get("/api/storemap", params={"store": self.store}).json()
        self.assertEqual((v["total"], v["coverage_pct"]), (3, 100))

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
