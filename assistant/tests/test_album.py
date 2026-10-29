"""Game: album. Pages by aisle, Other finds, the seasonal page, page
badges, backfill, community chapters, the real First Mapper, Receipt
Keeper, and the level unlock ladder. All deterministic, $0, no model."""
import io
import os
import tempfile
import unittest
from datetime import date
from unittest import mock

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from tests import test_stickers as ts  # noqa: E402

NOV = date(2026, 12, 1)       # outside the Halloween window
OCT = date(2026, 10, 28)      # inside it


def fresh(user=None):
    os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
    from api import state
    state.set_current_user(user)
    state.set_overlay(None)


def state_reset():
    from api import state
    state.set_current_user(None)


def jpeg(seed=1, w=640, h=480):
    a = np.random.default_rng(seed).integers(0, 255, (h, w, 3), dtype=np.uint8)
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, "JPEG", quality=90)
    return buf.getvalue()


def add(name, **kw):
    from api import stickers
    return stickers.add_sticker(name, key="name:" + name.lower(), **kw)[0]


def page(view, pid):
    return next((p for p in view["pages"] if p["id"] == pid), None)


class TestPages(unittest.TestCase):
    def setUp(self):
        fresh()
        from api import album
        self.album = album

    def test_empty_album(self):
        v = self.album.view(today=NOV)
        self.assertEqual(v["total"], 0)
        self.assertEqual(v["pages"], [])      # no teaser outside the season
        self.assertIsInstance(v["chapters"], list)

    def test_one_page_per_aisle_with_stickers_in_aisle_order(self):
        for n in ("Whole Milk", "Bananas", "Sourdough", "Hummus", "Granola",
                  "Ice Cream", "Paper Towels"):
            add(n)
        v = self.album.view(today=NOV)
        self.assertEqual([p["id"] for p in v["pages"]],
                         ["Produce", "Bakery", "Deli", "Dairy", "Pantry", "Frozen", "Household"])
        for p in v["pages"]:
            self.assertEqual(p["size"], 8)
            self.assertEqual(p["count"], 1)
            self.assertEqual(p["kind"], "aisle")
            self.assertTrue(p["started"])
            self.assertEqual(len(p["stickers"]), 1)
            self.assertEqual(p["badge"]["to_go"], 7)
            self.assertFalse(p["badge"]["earned"])
        self.assertEqual(v["total"], 7)

    def test_badge_text_counts_down_and_is_calm(self):
        for n in ("Whole Milk", "Greek Yogurt", "Butter"):
            add(n)
        b = page(self.album.view(today=NOV), "Dairy")["badge"]
        self.assertEqual(b["name"], "Dairy Royalty")
        self.assertEqual(b["text"], "5 to go. No rush.")
        self.assertEqual(b["to_go"], 5)
        self.assertIsNone(b["earned_at"])

    def test_badge_at_eight_and_never_revoked(self):
        names = ["Whole Milk", "Greek Yogurt", "Cheddar Cheese", "Butter",
                 "Cream Cheese", "Eggs", "Sour Cream", "Half and Half"]
        for n in names[:7]:
            add(n)
        self.assertFalse(page(self.album.view(today=NOV), "Dairy")["badge"]["earned"])
        add(names[7])
        b = page(self.album.view(today=NOV), "Dairy")["badge"]
        self.assertTrue(b["earned"])
        self.assertTrue(b["earned_at"])
        self.assertEqual(b["to_go"], 0)
        # Drop one sticker: the page is short again, the badge stays.
        from api import state, stickers
        data = state._load("stickers.json", None)
        data["stickers"].pop()
        state._save("stickers.json", data)
        p = page(self.album.view(today=NOV), "Dairy")
        self.assertEqual(p["count"], 7)
        self.assertTrue(p["badge"]["earned"])
        self.assertEqual(p["badge"]["earned_at"], b["earned_at"])
        self.assertIn("Dairy", stickers.badges())

    def test_more_than_eight_keeps_one_page_the_client_chunks(self):
        for i in range(11):
            add(f"Cheese {i}")
        p = page(self.album.view(today=NOV), "Dairy")
        self.assertEqual((p["count"], p["size"]), (11, 8))
        self.assertEqual(len(p["stickers"]), 11)

    def test_other_finds_for_unknown_and_typed_names(self):
        add("Durian")
        add("Mystery Thing")
        v = self.album.view(today=NOV)
        o = page(v, "Other finds")
        self.assertEqual(o["kind"], "other")
        self.assertEqual(o["count"], 2)
        self.assertEqual(o["size"], 4)            # max(4, count)
        self.assertIsNone(o["badge"])
        for i in range(5):
            add(f"Durian Thing {i}")
        self.assertEqual(page(self.album.view(today=NOV), "Other finds")["size"], 7)

    def test_an_item_moves_page_when_the_map_improves(self):
        add("Durian")
        self.assertEqual(page(self.album.view(today=NOV), "Other finds")["count"], 1)
        better = aisles_index_with(("Produce", ["durian"]))
        with mock.patch("api.aisles._INDEX", better):
            v = self.album.view(today=NOV)
        self.assertEqual(page(v, "Produce")["count"], 1)
        self.assertIsNone(page(v, "Other finds"))

    def test_the_shelf_label_places_only_a_name_the_map_does_not_know(self):
        from api import stickers
        stickers.add_sticker("Durian", key="name:durian", shelf_label="Frozen")
        stickers.add_sticker("Bananas", key="name:bananas", shelf_label="Frozen")
        v = self.album.view(today=NOV)
        self.assertEqual([s["name"] for s in page(v, "Frozen")["stickers"]], ["Durian"])
        self.assertEqual([s["name"] for s in page(v, "Produce")["stickers"]], ["Bananas"])

    def test_a_product_lands_on_the_same_page_whatever_shelf_first_found_it(self):
        from api import stickers
        stickers.add_sticker("Brie", key="g-brie", shelf_label="Cheese & Dip Shelf")
        stickers.add_sticker("Sharp Cheddar", key="g-ched", shelf_label="Cheese & Dip Shelf")
        stickers.add_sticker("Brie", key="g-brie", shelf_label="Deli")   # repeat find
        v = self.album.view(today=NOV)
        self.assertEqual(sorted(s["name"] for s in page(v, "Dairy")["stickers"]),
                         ["Brie", "Sharp Cheddar"])
        self.assertIsNone(page(v, "Deli"))

    def test_seasonal_teaser_only_inside_the_window(self):
        self.assertIsNone(page(self.album.view(today=date(2026, 9, 14)), "Halloween"))
        t = page(self.album.view(today=date(2026, 9, 15)), "Halloween")
        self.assertIsNotNone(t)
        self.assertFalse(t["started"])
        self.assertEqual(t["count"], 0)
        self.assertEqual(t["kind"], "season")
        self.assertIn("Seasonal page", t["note"])
        self.assertIn("never expires", t["note"])
        self.assertEqual(t["badge"]["name"], "Pumpkin King")
        self.assertIsNotNone(page(self.album.view(today=date(2026, 11, 5)), "Halloween"))
        self.assertIsNone(page(self.album.view(today=date(2026, 11, 6)), "Halloween"))

    def test_halloween_starts_on_the_first_pumpkin_and_stays_forever(self):
        add("Mini Pumpkin")
        add("Whole Milk")
        for d in (OCT, NOV, date(2027, 6, 1)):
            v = self.album.view(today=d)
            h = page(v, "Halloween")
            self.assertTrue(h["started"], d)
            self.assertEqual(h["count"], 1)
            self.assertEqual([s["name"] for s in h["stickers"]], ["Mini Pumpkin"])
            # A season sticker sits on one page only.
            self.assertIsNone(page(v, "Pantry"))
            self.assertEqual(v["total"], 2)
        # The Halloween page comes after the aisles.
        ids = [p["id"] for p in self.album.view(today=NOV)["pages"]]
        self.assertEqual(ids, ["Dairy", "Halloween"])

    def test_no_prices_and_no_friend_fields_on_any_page(self):
        add("Whole Milk")
        keys = set()

        def walk(x):
            if isinstance(x, dict):
                for k, v in x.items():
                    keys.add(k.lower())
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
        walk(self.album.view(today=NOV))
        for banned in ("price", "friend", "trade", "comment", "media_b64", "session_ids"):
            self.assertFalse([k for k in keys if banned in k], banned)

    def test_summary_counts(self):
        add("Whole Milk")
        self.assertEqual(self.album.summary(), {"stickers": 1, "pages_complete": 0})


def aisles_index_with(*extra):
    from api import aisles
    idx = list(aisles._build_index())
    for aisle, phrases in extra:
        for ph in phrases:
            idx.append((len(ph.split()) * 2, aisle, ph.split()))
    return idx


class TestAlbumRoutes(ts.StickerCase):
    def test_album_route_shapes_and_backfill(self):
        self.check("Milk")
        self.check("Oat Milk")
        a = self.c.get("/api/quest/album").json()
        self.assertEqual(a["total"], 2)
        self.assertEqual([p["id"] for p in a["pages"] if p["kind"] != "season"], ["Dairy"])
        dairy = a["pages"][0]
        self.assertEqual(dairy["count"], 2)
        self.assertEqual(dairy["badge"]["text"], "6 to go. No rush.")

    def test_backfill_from_a_done_session_is_never_new(self):
        from api import quest, stickers
        with ts.as_user():
            quest.check_item(self.sid, "Milk", True)
            quest._mutate(self.sid, lambda s: s.update(state="done"))
        a = self.c.get("/api/quest/album").json()
        self.assertEqual(a["total"], 1)
        again = self.c.get("/api/quest/album").json()
        self.assertEqual(again["total"], 1)               # idempotent
        self.assertEqual(self.c.get(f"/api/quest/stickers/new?session={self.sid}").json()["new"], [])
        got = self.c.get(f"/api/quest/stickers?session={self.sid}").json()["stickers"]
        self.assertEqual(len(got), 1)
        self.assertNotIn("is_new", got[0])
        with ts.as_user():
            self.assertEqual(stickers.all_stickers()[0]["source"], "backfill")

    def test_the_album_is_private_to_the_account(self):
        self.check("Milk")
        self.assertEqual(self.c.get("/api/quest/album").status_code, 200)
        anon = ts.TestClient(self.main.app)
        self.assertEqual(anon.get("/api/quest/album").status_code, 401)
        self.assertEqual(anon.get("/api/quest/stickers?session=x").status_code, 401)
        self.assertEqual(anon.post("/api/quest/stickers", json={"name": "x"}).status_code, 401)


class TestChaptersAndFirstMapper(unittest.TestCase):
    def setUp(self):
        fresh("ana")
        from api import album, storemap
        self.album, self.sm = album, storemap
        self.addCleanup(state_reset)

    def test_first_mapped_needs_a_real_section_and_a_kept_capture(self):
        self.assertEqual(self.album.first_mapped_stores(), [])
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        self.assertEqual(self.album.first_mapped_stores(), [])      # no capture yet
        self.sm.ingest("Corner Store", "aisle-4:left", jpeg(1))
        self.assertEqual(self.album.first_mapped_stores(), ["Corner Store"])

    def test_only_the_creator_of_the_earliest_section_counts(self):
        from api import state
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        self.sm.ingest("Corner Store", "aisle-4:left", jpeg(1))
        state.set_current_user("ben")
        self.sm.add_segment("Corner Store", "Aisle 5", "left")
        self.sm.ingest("Corner Store", "aisle-5:left", jpeg(2))
        self.assertEqual(self.album.first_mapped_stores(), [])
        # He can still add to ana's section; that is not the first map.
        self.sm.ingest("Corner Store", "aisle-4:left", jpeg(3))
        self.assertEqual(self.album.first_mapped_stores(), [])
        state.set_current_user("ana")
        self.assertEqual(self.album.first_mapped_stores(), ["Corner Store"])

    def test_walkthrough_seeded_sections_never_count(self):
        from api import state
        TJ = "Trader Joe's|tj-argonaut"
        os.environ["ARYA_WALK_STORE_ID"] = "tj-argonaut"  # the walk's own store
        self.addCleanup(os.environ.pop, "ARYA_WALK_STORE_ID", None)
        doc = self.sm.load_map(TJ)
        seeded = next(iter(doc["segments"]))
        self.assertEqual(doc["segments"][seeded]["created_by"], "walkthrough")
        self.sm.ingest(TJ, seeded, jpeg(7))
        self.assertEqual(self.album.first_mapped_stores(), [])
        # A real section of her own, with a capture, is a real first map.
        self.sm.add_segment(TJ, "Aisle 99", "left")
        self.sm.ingest(TJ, "aisle-99:left", jpeg(8))
        self.assertEqual(self.album.first_mapped_stores(), ["Trader Joe's"])
        state.set_current_user("ben")
        self.assertEqual(self.album.first_mapped_stores(), [])

    def test_first_mapper_badge_detail(self):
        from api import social
        by_id = lambda: {b["id"]: b for b in social.badge_shelf()}
        b = by_id()["first_mapper"]
        self.assertFalse(b["earned"])
        self.assertEqual(b["detail"], "no store mapped yet")
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        self.sm.ingest("Corner Store", "aisle-4:left", jpeg(1))
        b = by_id()["first_mapper"]
        self.assertTrue(b["earned"])
        self.assertEqual(b["detail"], "First to map Corner Store")
        self.assertEqual(social.profile()["mapped_stores"], ["Corner Store"])

    def test_chapters_show_coverage_for_known_stores(self):
        from api import quest
        quest.create_session("Corner Store", "quest", [{"name": "Milk"}])
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        self.sm.add_segment("Corner Store", "Aisle 5", "left")
        self.sm.ingest("Corner Store", "aisle-4:left", jpeg(1))
        ch = {c["store"]: c for c in self.album.chapters()}
        c = ch["Corner Store"]
        self.assertEqual(c["pct"], 50)
        self.assertFalse(c["earned"])
        self.assertEqual(c["text"], "Map all of Corner Store together: 50%. "
                                    "Each shelf you add helps.")
        # My Stores are chapters too.
        self.assertIn("Trader Joe's", ch)
        self.sm.ingest("Corner Store", "aisle-5:left", jpeg(2))
        c = {x["store"]: x for x in self.album.chapters()}["Corner Store"]
        self.assertEqual(c["pct"], 100)
        self.assertTrue(c["earned"])
        self.assertEqual(c["text"], "Chapter complete. You helped map all of Corner Store.")
        # No chapter sticker or badge record exists, so no copy promises one.
        self.assertNotIn("sticker", c["text"].lower())
        self.assertNotIn("sticker", self.album.CHAPTER_TEXT.lower())

    def test_the_other_finds_note_makes_no_false_promise(self):
        add("Durian")
        o = page(self.album.view(today=NOV), "Other finds")
        self.assertEqual(o["note"], "Items Arya cannot place yet land here.")
        self.assertNotIn("typed", self.album.PAGE_NOTES["other"])

    def test_a_typed_item_the_map_knows_lands_on_its_aisle(self):
        from api import stickers
        rec = stickers.add_sticker("Dark chocolate bar", key="name:dark chocolate bar")[0]
        self.assertTrue(rec["typed"])
        v = self.album.view(today=NOV)
        self.assertEqual(page(v, "Pantry")["count"], 1)
        self.assertIsNone(page(v, "Other finds"))

    def test_a_chapter_is_not_earned_by_someone_who_never_helped(self):
        from api import state
        self.sm.add_segment("Corner Store", "Aisle 4", "left")
        self.sm.ingest("Corner Store", "aisle-4:left", jpeg(1))
        state.set_current_user("ben")
        from api import quest
        quest.create_session("Corner Store", "quest", [{"name": "Milk"}])
        c = {x["store"]: x for x in self.album.chapters()}["Corner Store"]
        self.assertEqual(c["pct"], 100)
        self.assertFalse(c["earned"])


def receipt(i, ok=True, rid=None):
    return {"receipt_id": rid or f"r-{i}", "merchant": "Corner Store",
            "purchased_at": "2026-10-0%d" % (i % 9 + 1), "lines": [],
            "subtotal": 1, "tax": 0, "total": 1, "totals_reconcile": ok}


class TestReceiptKeeperAndProfile(unittest.TestCase):
    def setUp(self):
        fresh()
        from api import social, state
        self.social, self.state = social, state

    def badge(self):
        return {b["id"]: b for b in self.social.badge_shelf()}["receipt_keeper"]

    def test_four_of_five_then_five(self):
        self.state._save("receipts.json", [receipt(i) for i in range(4)])
        b = self.badge()
        self.assertFalse(b["earned"])
        self.assertEqual(b["detail"], "4 of 5 checked receipts")
        self.state._save("receipts.json", [receipt(i) for i in range(5)])
        b = self.badge()
        self.assertTrue(b["earned"])
        self.assertEqual(b["detail"], "5 of 5 checked receipts")
        self.assertEqual(b["name"], "Receipt Keeper")

    def test_receipts_that_do_not_add_up_or_repeat_do_not_count(self):
        rs = [receipt(i) for i in range(3)]
        rs += [receipt(3, ok=False), receipt(4, rid="r-0")]      # off by a cent / a repeat
        self.state._save("receipts.json", rs)
        b = self.badge()
        self.assertFalse(b["earned"])
        self.assertEqual(b["detail"], "3 of 5 checked receipts")

    def test_sample_receipts_never_earn_receipt_keeper(self):
        rs = [receipt(i) for i in range(3)]
        for i in (3, 4, 5):
            r = receipt(i)
            r["source_type"] = "sample"          # quest.sample_receipt
            rs.append(r)
        self.state._save("receipts.json", rs)
        b = self.badge()
        self.assertFalse(b["earned"])
        self.assertEqual(b["detail"], "3 of 5 checked receipts")
        # Two real ones more, and it is earned from real receipts only.
        self.state._save("receipts.json", rs + [receipt(6), receipt(7)])
        self.assertTrue(self.badge()["earned"])

    def test_profile_keys_on_a_fresh_account(self):
        p = self.social.profile()
        self.assertEqual(p["mapped_stores"], [])
        self.assertEqual(p["album"], {"stickers": 0, "pages_complete": 0})
        u = p["unlocks"]
        self.assertEqual(set(u), {"ladder", "gained", "next", "never_locked", "open_to_all"})
        self.assertEqual(u["open_to_all"], ["Shop-Off race with friends", "Celebration sound"])
        self.assertEqual(u["never_locked"], ["Find it for me", "Receipts", "Lists",
                                             "Shop together", "Split the List"])
        self.assertEqual(u["gained"], [])
        self.assertEqual(u["next"]["level"], 2)
        by = {b["id"]: b for b in p["badges"]}
        self.assertFalse(by["first_mapper"]["earned"])
        self.assertIn("receipt_keeper", by)
        # points and levels are unchanged by the album.
        self.assertEqual((p["points"], p["level"], p["next_level_at"]), (0, 1, 100))

    def test_profile_album_counts_stickers(self):
        add("Whole Milk")
        add("Durian")
        self.assertEqual(self.social.profile()["album"]["stickers"], 2)


class TestUnlockView(unittest.TestCase):
    def setUp(self):
        from api import social
        self.social = social

    def test_level_one(self):
        v = self.social.unlock_view(1)
        self.assertFalse(any(r["reached"] for r in v["ladder"]))
        self.assertEqual(v["gained"], [])
        self.assertEqual(v["next"]["level"], 2)

    def test_gained_between_levels(self):
        v = self.social.unlock_view(4, 1)
        self.assertEqual([r["level"] for r in v["gained"]], [2, 4])
        self.assertEqual(v["next"]["level"], 5)
        v = self.social.unlock_view(3, 3)
        self.assertEqual(v["gained"], [])
        self.assertEqual(v["next"]["level"], 4)
        v = self.social.unlock_view(2, 1)
        self.assertEqual([r["level"] for r in v["gained"]], [2])
        self.assertEqual([r["reached"] for r in v["ladder"]][:3], [True, False, False])

    def test_past_the_last_rung(self):
        v = self.social.unlock_view(12, 9)
        self.assertEqual([r["level"] for r in v["gained"]], [10])
        self.assertIsNone(v["next"])
        self.assertTrue(all(r["reached"] for r in v["ladder"]))

    def test_rows_carry_kind_and_live_flags_and_no_lock_wording(self):
        rows = self.social.unlock_view(1)["ladder"]
        self.assertEqual({r["kind"] for r in rows} - {"expression", "trust", "fun", "community"}, set())
        for r in rows:
            self.assertEqual(set(r), {"level", "title", "kind", "live", "reached"})
            self.assertNotRegex(r["title"].lower(), r"lock|verified")
        self.assertNotIn("Split the List", " ".join(r["title"] for r in rows))

    def test_a_rung_is_live_only_if_its_feature_exists(self):
        # Nothing on the ladder exists in the app today. A rung may be
        # marked live only when it names a feature marker that is
        # present in the app source.
        from tests import frontend
        src = frontend.app()  # the app's source (web/src)
        for r in self.social.LEVEL_UNLOCKS:
            if r["live"]:
                self.assertTrue(r.get("feature"), r)
                self.assertIn(r["feature"], src, r)
        self.assertEqual([r["level"] for r in self.social.LEVEL_UNLOCKS if r["live"]], [])
        # Avatar extras have no code yet, so that rung is not live.
        avatar = next(r for r in self.social.LEVEL_UNLOCKS if "Avatar" in r["title"])
        self.assertFalse(avatar["live"])

    def test_open_to_all_features_exist_and_are_not_rungs(self):
        from tests import frontend
        src = frontend.app()  # the app's source (web/src)
        titles = " ".join(r["title"] for r in self.social.LEVEL_UNLOCKS)
        for o in self.social.OPEN_TO_ALL:
            self.assertIn(o["feature"], src, o)
            self.assertNotIn(o["title"], titles)
        self.assertNotIn("Shop-Off", titles)
        self.assertNotIn("celebration sound", titles.lower())

    def test_never_locked_names_the_basics(self):
        self.assertEqual(self.social.NEVER_LOCKED[0], "Find it for me")
        self.assertIn("Shop together", self.social.NEVER_LOCKED)
        self.assertIn("Split the List", self.social.NEVER_LOCKED)

    def test_levels_still_use_the_old_math(self):
        self.assertEqual(self.social.level_for(0)["level"], 1)
        self.assertEqual(self.social.level_for(100)["level"], 2)
        self.assertEqual(self.social.level_for(300)["level"], 3)


if __name__ == "__main__":
    unittest.main()
