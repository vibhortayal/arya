"""Game: album. Stickers are minted server-side on every grab, cut from
the people-scrubbed frame the app already kept ($0, NO new model call).
Stock art is the fallback. Scripted SAM/Spark come from the shelf scan
tests (FakeScanClient); every route test uses that seam.
"""
import base64
import contextlib
import io
import os
import re
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest import mock

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from tests.test_shelf_scan import FakeScanClient, FRAME_W, FRAME_H  # noqa: E402

USER = "owner@example.com"


def frame_jpeg():
    """Grey shelf with one saturated product where SAM's in-cap
    "frozen pizza boxes" box is: (100,100)-(400,300)."""
    im = Image.new("RGB", (FRAME_W, FRAME_H), (120, 110, 100))
    d = ImageDraw.Draw(im)
    d.rectangle((100, 100, 400, 300), fill=(220, 40, 40))
    d.rectangle((140, 150, 360, 210), fill=(250, 230, 60))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=90)
    return buf.getvalue()


@contextlib.contextmanager
def as_user(name=USER):
    from api import state
    tok = state._current_user.set(name)
    try:
        yield
    finally:
        state._current_user.reset(tok)


class StickerCase(unittest.TestCase):
    ITEMS = ("Frozen Pizza", "Milk", "Oat Milk")

    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        FakeScanClient.calls = {"segment": [], "chat": []}
        from api import main, state
        main.MetaClient = FakeScanClient
        main._login_fails.clear()
        self.main = main
        self.c = TestClient(main.app)
        state._save("dictionary.json", {"entries": []})
        state._save("receipts.json", [])
        r = self.c.post("/auth/setup", json={"username": USER, "password": "long-password"})
        assert r.status_code == 200, r.text
        self.sid = self.new_session()

    def new_session(self, items=None, store="Corner Store"):
        r = self.c.post("/api/quest/sessions", json={
            "store": store, "mode": "quest",
            "items": [{"name": n} for n in (items or self.ITEMS)]})
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        assert self.c.post(f"/api/quest/sessions/{sid}/state",
                           json={"state": "playing"}).status_code == 200
        return sid

    def scan(self, sid=None, item="Frozen Pizza", jpeg=None):
        r = self.c.post(f"/api/quest/scan-shelf?session={sid or self.sid}&item={item}",
                        content=jpeg or frame_jpeg(),
                        headers={"Content-Type": "image/jpeg"})
        assert r.status_code == 200, r.text
        return r.json()

    def check(self, item, checked=True, sid=None):
        r = self.c.post(f"/api/quest/sessions/{sid or self.sid}/check",
                        json={"item": item, "checked": checked})
        assert r.status_code == 200, r.text
        return r.json()

    def stickers_file(self):
        with as_user():
            from api import state
            return state._load("stickers.json", {"stickers": [], "badges": {}})

    def media_dir(self):
        with as_user():
            from api import state
            return os.path.join(state.data_dir(), "sticker-media")

    def edit_frame(self, fn, store="Corner Store", item="Frozen Pizza"):
        with as_user():
            from api import quest, state
            frames = state._load("shelf_frames.json", {})
            rec = frames[quest._frame_key(store, item)]
            fn(rec)
            state._save("shelf_frames.json", frames)

    def reset_stickers(self):
        with as_user():
            from api import state
            state._save("stickers.json", {"stickers": [], "badges": {}})


class TestCutout(StickerCase):
    def test_scan_then_grab_mints_a_cutout_and_the_check_carries_it_once(self):
        out = self.scan()
        self.assertEqual([p["item"] for p in out["pops"]], ["Frozen Pizza"])
        r = self.check("Frozen Pizza")
        ns = r["new_sticker"]
        self.assertTrue(ns["is_new"])
        st = ns["sticker"]
        self.assertEqual(st["image"], "cutout")
        self.assertEqual(st["name"], "Frozen Pizza")
        self.assertEqual(st["page"], "Frozen")
        self.assertTrue(st["image_url"].startswith(f"/api/quest/stickers/{st['id']}/image"))
        self.assertEqual(st["art"], "pizza.webp")
        self.assertTrue(st["is_new"])
        # The session dict still rides along unchanged.
        self.assertEqual(r["id"], self.sid)
        # The cutout bytes: webp with alpha, small, die-cut.
        img = self.c.get(st["image_url"])
        self.assertEqual(img.status_code, 200)
        self.assertEqual(img.headers["content-type"], "image/webp")
        self.assertIn("private", img.headers["cache-control"])
        self.assertIn("max-age=86400", img.headers["cache-control"])
        self.assertLess(len(img.content), 60 * 1024)
        im = Image.open(io.BytesIO(img.content))
        self.assertEqual(im.format, "WEBP")
        self.assertEqual(im.mode, "RGBA")
        self.assertLessEqual(max(im.size), 240)
        self.assertEqual(im.getpixel((0, 0))[3], 0)                      # corner clear
        self.assertEqual(im.getpixel((im.width // 2, im.height // 2))[3], 255)  # centre solid
        # A second grab of the same product is not a new sticker.
        again = self.check("Frozen Pizza")
        self.assertNotIn("new_sticker", again)
        self.assertEqual(len(self.stickers_file()["stickers"]), 1)

    def test_a_plain_grab_without_a_frame_mints_art(self):
        r = self.check("Milk")
        st = r["new_sticker"]["sticker"]
        self.assertEqual(st["image"], "art")
        self.assertIsNone(st["image_url"])
        self.assertEqual(st["art"], "milk.webp")
        self.assertEqual(st["page"], "Dairy")
        self.assertEqual(self.c.get(f"/api/quest/stickers/{st['id']}/image").status_code, 404)

    def test_the_source_frame_is_never_kept_by_the_album(self):
        self.scan()
        self.check("Frozen Pizza")
        raw = repr(self.stickers_file())
        self.assertNotIn("jpeg_b64", raw)
        self.assertNotIn("media_b64", raw)   # files on disk, not inline
        files = os.listdir(self.media_dir())
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].endswith(".webp"))

    def test_guards_fall_back_to_art(self):
        def old(rec):
            rec["seen_at"] = (datetime.now() - timedelta(seconds=601)).isoformat(timespec="seconds")

        def people(rec):
            rec["people_scrubbed"] = 2

        def region(rec):
            rec["grade"] = "region"

        def wide(rec):
            rec["box"] = [0.0, 0.0, 0.7, 0.7]          # 49% of the frame

        cases = {"older than 600 s": old, "people in the frame": people,
                 "region grade": region, "box over 35%": wide}
        for label, fn in cases.items():
            with self.subTest(label):
                self.reset_stickers()
                sid = self.new_session()
                self.scan(sid)
                self.edit_frame(fn)
                st = self.check("Frozen Pizza", sid=sid)["new_sticker"]["sticker"]
                self.assertEqual(st["image"], "art", label)

    def test_a_fresh_frame_just_inside_the_window_still_cuts(self):
        self.scan()
        self.edit_frame(lambda r: r.update(
            seen_at=(datetime.now() - timedelta(seconds=590)).isoformat(timespec="seconds")))
        self.assertEqual(self.check("Frozen Pizza")["new_sticker"]["sticker"]["image"], "cutout")

    def test_no_frame_at_all_is_art(self):
        # The frame is for another store: no photo for (this store, item).
        self.scan()
        sid = self.new_session(store="Other Store")
        st = self.check("Frozen Pizza", sid=sid)["new_sticker"]["sticker"]
        self.assertEqual(st["image"], "art")

    def test_stickers_never_fail_a_grab(self):
        with mock.patch("api.stickers.on_check", side_effect=RuntimeError("boom")):
            r = self.check("Milk")
        self.assertNotIn("new_sticker", r)
        self.assertTrue(any(i["checked"] for i in r["items"] if i["name"] == "Milk"))

    def test_no_model_call_is_made_by_the_sticker_path(self):
        self.scan()
        calls = (len(FakeScanClient.calls["segment"]), len(FakeScanClient.calls["chat"]))
        self.check("Frozen Pizza")
        self.assertEqual((len(FakeScanClient.calls["segment"]),
                          len(FakeScanClient.calls["chat"])), calls)

    def test_module_never_imports_meta_client(self):
        here = os.path.join(os.path.dirname(__file__), "..", "api")
        for mod in ("aisles.py", "stickers.py", "album.py", "album_routes.py"):
            with open(os.path.join(here, mod), encoding="utf-8") as fh:
                src = fh.read()
            self.assertIsNone(re.search(
                r"^\s*(from\s+\S*meta_client|import\s+\S*meta_client|from\s+api\s+import\s+.*meta_client)",
                src, re.M), mod)
            self.assertNotIn("MetaClient", src, mod)


class TestIdempotentAndRetract(StickerCase):
    def test_idempotent_by_key_across_sessions_with_art_to_cutout_upgrade(self):
        first = self.check("Frozen Pizza")["new_sticker"]["sticker"]   # no frame yet
        self.assertEqual(first["image"], "art")
        sid2 = self.new_session()
        self.scan(sid2)
        r = self.check("Frozen Pizza", sid=sid2)
        self.assertNotIn("new_sticker", r)             # a repeat find is not new
        rows = self.stickers_file()["stickers"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], first["id"])   # same id
        self.assertEqual(rows[0]["first_found_at"], first["first_found_at"])
        self.assertEqual(rows[0]["image"], "cutout")   # upgraded
        self.assertEqual(rows[0]["session_ids"], [self.sid, sid2])
        self.assertEqual(rows[0]["first_session_id"], self.sid)
        # found_count says how many hunts found it.
        got = self.c.get(f"/api/quest/stickers?session={sid2}").json()["stickers"]
        self.assertEqual(got[0]["found_count"], 2)

    def test_two_names_for_one_product_share_a_sticker(self):
        from api import state
        state._save("dictionary.json", {"entries": []})
        a = self.check("Milk")
        self.assertIn("new_sticker", a)
        sid2 = self.new_session(items=["milk"])
        b = self.check("milk", sid=sid2)
        self.assertNotIn("new_sticker", b)

    def test_put_back_retracts_in_the_same_session_and_deletes_media(self):
        self.scan()
        st = self.check("Frozen Pizza")["new_sticker"]["sticker"]
        files = os.listdir(self.media_dir())
        self.assertEqual(len(files), 1)
        r = self.check("Frozen Pizza", checked=False)
        self.assertNotIn("new_sticker", r)
        self.assertEqual(self.stickers_file()["stickers"], [])
        self.assertEqual(os.listdir(self.media_dir()), [])
        self.assertEqual(self.c.get(f"/api/quest/stickers/{st['id']}/image").status_code, 404)
        # Grab again: it is new again.
        self.scan()
        self.assertIn("new_sticker", self.check("Frozen Pizza"))

    def test_put_back_in_a_later_session_keeps_the_sticker(self):
        self.check("Milk")
        sid2 = self.new_session()
        self.check("Milk", sid=sid2)
        self.check("Milk", checked=False, sid=sid2)
        rows = self.stickers_file()["stickers"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["session_ids"], [self.sid])

    def test_put_back_in_a_done_session_keeps_the_sticker(self):
        from api import stickers
        with as_user():
            st = stickers.add_sticker("Milk", key="milk-key", session_id="s9")[0]
            sess = {"id": "s9", "state": "done", "store": "X",
                    "items": [{"name": "Milk", "group": "milk-key", "checked": False}]}
            stickers.on_check(sess, "Milk", False)
            self.assertEqual(len(stickers.all_stickers()), 1)
            sess["state"] = "playing"
            stickers.on_check(sess, "Milk", False)
            self.assertEqual(len(stickers.all_stickers()), 0)
            self.assertTrue(st["id"])

    def test_a_full_page_is_announced_but_not_recorded_while_the_grab_can_undo(self):
        from api import stickers
        names = ["Whole Milk", "Greek Yogurt", "Cheddar Cheese", "Butter",
                 "Cream Cheese", "Eggs", "Sour Cream", "Half and Half"]
        sess = {"id": "s7", "state": "playing", "store": "Corner Store",
                "items": [{"name": n, "group": "name:" + n.lower(), "checked": True}
                          for n in names]}
        with as_user():
            payloads = [stickers.on_check(sess, n, True) for n in names]
            self.assertTrue(all(p and p["page"] == "Dairy" for p in payloads))
            self.assertNotIn("page_badge", payloads[6])
            self.assertEqual(payloads[7]["page_badge"],
                             {"id": "Dairy", "name": "Dairy Royalty"})
            # The card may say the page is full, but nothing is recorded.
            self.assertEqual(stickers.badges(), {})
            stickers.on_check(sess, "Half and Half", False)
            self.assertEqual(len(stickers.all_stickers()), 7)
            self.assertEqual(stickers.badges(), {})
            from api import album
            self.assertEqual(album.settle_badges(), {})   # 7 of 8: no badge

    def test_the_page_badge_is_earned_when_the_hunt_closes_not_before(self):
        names = ["Whole Milk", "Greek Yogurt", "Cheddar Cheese", "Butter",
                 "Cream Cheese", "Eggs", "Sour Cream", "Half and Half"]
        sid = self.new_session(items=names)
        for n in names:
            r = self.check(n, sid=sid)
        self.assertEqual(r["new_sticker"]["page_badge"]["name"], "Dairy Royalty")
        self.assertEqual(self.stickers_file()["badges"], {})
        with as_user():
            from api import album, quest
            dairy = next(p for p in album.view()["pages"] if p["id"] == "Dairy")
            self.assertFalse(dairy["badge"]["earned"])
            self.assertEqual(dairy["badge"]["to_go"], 0)
            self.assertEqual(dairy["badge"]["text"], "Page full. Add your receipt to earn it.")
            self.assertEqual(album.summary()["pages_complete"], 0)
        # Undo the 8th grab: the page is at 7 and never read "earned".
        self.check("Half and Half", checked=False, sid=sid)
        self.assertEqual(self.stickers_file()["badges"], {})
        self.check("Half and Half", sid=sid)
        # The hunt closes with its receipt: now the badge is final.
        with as_user():
            quest.sample_receipt(sid)
            self.assertEqual(quest.get_session(sid)["state"], "done")
            self.assertEqual(album.summary()["pages_complete"], 1)
            dairy = next(p for p in album.view()["pages"] if p["id"] == "Dairy")
            self.assertTrue(dairy["badge"]["earned"])
        self.assertIn("Dairy", self.stickers_file()["badges"])
        # A closed hunt cannot undo, and the badge never un-earns.
        self.check("Half and Half", checked=False, sid=sid)
        self.assertIn("Dairy", self.stickers_file()["badges"])

    def test_offline_replay_in_order_mints_once(self):
        # grab, put back, grab: the outbox replays all three in order.
        self.scan()
        a = self.check("Frozen Pizza")
        b = self.check("Frozen Pizza", checked=False)
        self.scan()
        c = self.check("Frozen Pizza")
        flags = ["new_sticker" in x for x in (a, b, c)]
        self.assertEqual(flags, [True, False, True])
        self.assertEqual(len(self.stickers_file()["stickers"]), 1)


class TestManualAndReads(StickerCase):
    def test_manual_add_is_idempotent_and_validated(self):
        r = self.c.post("/api/quest/stickers", json={"name": "  Dark Chocolate Bar "})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["is_new"])
        st = body["sticker"]
        self.assertEqual(st["name"], "Dark Chocolate Bar")
        self.assertEqual(st["image"], "art")
        self.assertEqual(self.stickers_file()["stickers"][0]["source"], "manual")
        again = self.c.post("/api/quest/stickers", json={"name": "dark chocolate bar"}).json()
        self.assertFalse(again["is_new"])
        self.assertEqual(again["sticker"]["id"], st["id"])
        self.assertEqual(self.c.post("/api/quest/stickers", json={"name": "   "}).status_code, 400)
        self.assertEqual(self.c.post("/api/quest/stickers", json={}).status_code, 400)
        self.assertEqual(self.c.post("/api/quest/stickers", json=["x"]).status_code, 400)
        long = self.c.post("/api/quest/stickers", json={"name": "x" * 200}).json()
        self.assertEqual(len(long["sticker"]["name"]), 80)

    def test_stickers_new_lists_only_first_in_session_items(self):
        self.check("Milk")
        self.check("Oat Milk")
        new = self.c.get(f"/api/quest/stickers/new?session={self.sid}").json()["new"]
        self.assertEqual(sorted(n["name"] for n in new), ["Milk", "Oat Milk"])
        for n in new:
            self.assertTrue(n["sticker_id"].startswith("stk-"))
            self.assertTrue(n["key"])
        sid2 = self.new_session()
        self.check("Milk", sid=sid2)
        self.assertEqual(self.c.get(f"/api/quest/stickers/new?session={sid2}").json()["new"], [])
        # A put back retracts it from the list.
        self.check("Oat Milk", checked=False)
        new = self.c.get(f"/api/quest/stickers/new?session={self.sid}").json()["new"]
        self.assertEqual([n["name"] for n in new], ["Milk"])

    def test_stickers_for_session_one_per_grabbed_item_in_order(self):
        self.check("Oat Milk")
        self.check("Milk")
        got = self.c.get(f"/api/quest/stickers?session={self.sid}").json()["stickers"]
        self.assertEqual([s["name"] for s in got], ["Milk", "Oat Milk"])  # item order
        self.assertTrue(all(s["is_new"] for s in got))
        for s in got:
            for k in ("id", "name", "key", "page", "aisle", "store",
                      "first_found_at", "found_count", "image", "image_url", "art", "typed"):
                self.assertIn(k, s)
        self.assertNotIn("price", " ".join(got[0].keys()))

    def test_unknown_session_is_404(self):
        self.assertEqual(self.c.get("/api/quest/stickers?session=nope").status_code, 404)
        self.assertEqual(self.c.get("/api/quest/stickers/new?session=nope").status_code, 404)
        self.assertEqual(self.c.get("/api/quest/stickers").status_code, 404)

    def test_image_route_rejects_odd_ids(self):
        for bad in ("..%2Fstickers", "nope", "stk-0000000000"):
            self.assertEqual(self.c.get(f"/api/quest/stickers/{bad}/image").status_code, 404, bad)

    def test_typed_flag_marks_unresolved_names(self):
        st = self.check("Milk")["new_sticker"]["sticker"]
        self.assertTrue(st["typed"])   # no dictionary entry: a typed name

    def test_a_finished_session_gets_art_stickers_never_new(self):
        with as_user():
            from api import quest
            quest.check_item(self.sid, "Milk", True)   # a grab that skipped the route
        self.assertEqual(self.c.post(f"/api/quest/sessions/{self.sid}/state",
                                     json={"state": "finished"}).status_code, 200)
        got = self.c.get(f"/api/quest/stickers?session={self.sid}").json()["stickers"]
        self.assertEqual([s["name"] for s in got], ["Milk"])
        self.assertNotIn("is_new", got[0])
        self.assertEqual(self.c.get(f"/api/quest/stickers/new?session={self.sid}").json()["new"], [])


class TestIsolationAndSandbox(StickerCase):
    def test_account_isolation(self):
        st = self.check("Milk")["new_sticker"]["sticker"]
        c2 = TestClient(self.main.app)
        r = c2.post("/auth/register", json={"username": "other@example.com",
                                            "password": "long-password"})
        if r.status_code != 200:
            self.skipTest(f"second account not available here: {r.status_code}")
        self.assertEqual(c2.get("/api/quest/album").json()["total"], 0)
        self.assertEqual(c2.get(f"/api/quest/stickers/{st['id']}/image").status_code, 404)
        self.assertEqual(self.c.get("/api/quest/album").json()["total"], 1)

    def test_demo_sandbox_writes_nothing_to_disk_and_caps_inline(self):
        from api import state, stickers
        base = os.environ["ARYA_DATA_DIR"]
        before = sorted(os.listdir(base))
        overlay = {}
        webp = stickers.cut_product(frame_jpeg(), [100 / 1600, 100 / 900, 400 / 1600, 300 / 900], "item")
        self.assertTrue(webp)
        tok = state._overlay.set(overlay)
        try:
            for i in range(14):
                stickers.add_sticker(f"Item {i}", key=f"name:item {i}", webp=webp)
            rows = state._load("stickers.json", None)["stickers"]
            self.assertEqual(sum(1 for r in rows if r["image"] == "cutout"), 12)
            self.assertEqual(sum(1 for r in rows if r["image"] == "art"), 2)
            first = rows[0]
            self.assertEqual(first["media"], "inline")
            self.assertEqual(stickers.media_bytes(first["id"]), webp)
            self.assertNotIn("media_b64", str(stickers.public(first)))
        finally:
            state._overlay.reset(tok)
        self.assertEqual(sorted(os.listdir(base)), before)
        self.assertFalse(os.path.exists(os.path.join(base, "sticker-media")))
        self.assertFalse(os.path.exists(os.path.join(base, "stickers.json")))

    def test_demo_visitor_route_flow_touches_no_disk(self):
        import importlib.util
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(os.path.dirname(__file__), "..", "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        c = TestClient(self.main.app)
        c.post("/auth/demo")

        def disk():
            out = {}
            for root, _d, files in os.walk(base):
                for f in files:
                    if f in ("sessions.json", "cost-ledger.jsonl"):
                        continue
                    with open(os.path.join(root, f), "rb") as fh:
                        out[os.path.join(root, f)] = fh.read()
            return out
        before = disk()
        sess = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest", "driver": "strip",
            "items": ["Whole Milk 1 gal"]}).json()
        sid = sess["id"]
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        r = c.post(f"/api/quest/sessions/{sid}/check", json={"item": "Whole Milk 1 gal"})
        self.assertEqual(r.status_code, 200)
        self.assertIn("new_sticker", r.json())
        self.assertEqual(c.get("/api/quest/album").status_code, 200)
        self.assertEqual(c.post("/api/quest/stickers", json={"name": "Hummus"}).status_code, 200)
        self.assertEqual(disk(), before)


class TestCutProduct(unittest.TestCase):
    BOX = [100 / 1600, 100 / 900, 400 / 1600, 300 / 900]

    def test_a_good_crop_makes_a_small_webp_with_a_clear_corner(self):
        from api import stickers
        out = stickers.cut_product(frame_jpeg(), self.BOX, "item")
        self.assertIsNotNone(out)
        im = Image.open(io.BytesIO(out))
        self.assertEqual(im.mode, "RGBA")
        self.assertLessEqual(max(im.size), 240)
        self.assertLess(len(out), 60 * 1024)
        self.assertEqual(im.getpixel((0, 0))[3], 0)
        self.assertEqual(im.getpixel((im.width - 1, im.height - 1))[3], 0)
        self.assertEqual(im.getpixel((im.width // 2, im.height // 2))[3], 255)

    def test_the_die_cut_border_is_white(self):
        from api import stickers
        im = Image.open(io.BytesIO(stickers.cut_product(frame_jpeg(), self.BOX))).convert("RGBA")
        # Walk in from the left edge of the middle row: the first opaque
        # pixel is the white border, then the red product.
        y = im.height // 2
        row = [im.getpixel((x, y)) for x in range(im.width)]
        first = next(p for p in row if p[3] > 250)
        self.assertGreater(min(first[:3]), 235)
        self.assertEqual(sorted(range(3), key=lambda i: row[im.width // 2][i])[-1], 0)  # red centre

    def test_none_for_tiny_crop_bad_bytes_big_box_and_cv2_error(self):
        from api import stickers
        jpeg = frame_jpeg()
        self.assertIsNone(stickers.cut_product(jpeg, [0.1, 0.1, 0.11, 0.11]))      # < 40 px
        self.assertIsNone(stickers.cut_product(b"not an image", self.BOX))
        self.assertIsNone(stickers.cut_product(jpeg, [0.0, 0.0, 0.7, 0.7]))        # > 35%
        self.assertIsNone(stickers.cut_product(jpeg, [0.5, 0.5, 0.4, 0.4]))        # inverted
        self.assertIsNone(stickers.cut_product(jpeg, None))
        with mock.patch("cv2.grabCut", side_effect=RuntimeError("cv2 exploded")):
            self.assertIsNone(stickers.cut_product(jpeg, self.BOX))

    def test_a_flat_product_falls_back_to_a_rounded_box(self):
        # A uniform patch: GrabCut finds nothing believable, the
        # coverage guard swaps in the rounded rectangle.
        from api import stickers
        im = Image.new("RGB", (800, 450), (120, 120, 120))
        buf = io.BytesIO()
        im.save(buf, "JPEG")
        out = stickers.cut_product(buf.getvalue(), [0.2, 0.2, 0.5, 0.6])
        self.assertIsNotNone(out)
        s = Image.open(io.BytesIO(out))
        self.assertEqual(s.getpixel((s.width // 2, s.height // 2))[3], 255)
        self.assertEqual(s.getpixel((0, 0))[3], 0)


class TestBackfillAndPages(StickerCase):
    def test_backfill_is_idempotent_and_never_new(self):
        from api import quest, stickers
        with as_user():
            sess = quest.get_session(self.sid)
            quest.check_item(self.sid, "Milk", True)
            quest.set_state(self.sid, "finished")
            # a done session needs a receipt in real life; set it directly
            def done(s):
                s["state"] = "done"
            quest._mutate(self.sid, done)
            self.assertEqual(stickers.backfill_from_sessions(), 1)
            self.assertEqual(stickers.backfill_from_sessions(), 0)
            rows = stickers.all_stickers()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["source"], "backfill")
            self.assertEqual(stickers.new_in_session(self.sid), [])
            self.assertTrue(sess)


if __name__ == "__main__":
    unittest.main()
