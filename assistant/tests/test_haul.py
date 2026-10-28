"""Haul (game slice): the closed hunt's receipt review, points
breakdown, trip name, second receipt and the 'Same haul' queue.

The hunt is already closed when the receipt is reviewed, so every fix
is an annotation in hauls.json. These tests pin that: fixes change the
haul view and nothing else (quest.json stays byte-equal), the points
breakdown is a pure decomposition of social.hunt_points, and nothing
here can reach a model (FakeClient.chat raises).
"""
import os, re, tempfile, unittest
from datetime import date

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

TODAY = date.today().isoformat()
USER = "owner@example.com"
HERE = os.path.dirname(os.path.abspath(__file__))
API = os.path.join(HERE, "..", "api")


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        raise AssertionError("haul paths must not call a model")


def line(name, qty=1, item_id=None):
    ln = {"decoded_name": name, "qty": qty, "unit_price": 1.0,
          "line_total": float(qty), "line_type": "item", "status": "auto"}
    if item_id:
        ln["item_id"] = item_id
    return ln


def receipt(rid, merchant, day, lines, total=None):
    return {"receipt_id": rid, "merchant": merchant, "purchased_at": day,
            "lines": lines, "subtotal": 0, "tax": 0,
            "total": total if total is not None else float(len(lines)),
            "totals_reconcile": True}


ITEMS = ["Milk", "Eggs", "Bananas", "Greek Yogurt", "Bread"]


class HaulBase(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state
        main.MetaClient = FakeClient
        main._login_fails.clear()
        self.main, self.state = main, state
        self.c = TestClient(main.app)
        state._save("receipts.json", [
            receipt("r-1", "Trader Joe's", TODAY, [
                line("Whole Milk"), line("Eggs Large"), line("Bananas", 2),
                line("Vanilla Yogurt"), line("Dark Chocolate Bar")], 12.5),
            receipt("r-1b", "Trader Joe's", TODAY, [line("Whole Milk")]),
            receipt("r-2", "Trader Joe's", TODAY, [line("Sourdough Bread")], 4.0),
            receipt("r-costco", "Costco", TODAY, [line("Paper Towels")]),
            receipt("r-old", "Trader Joe's", "2000-01-01", [line("Eggs")]),
            receipt("r-empty", "Trader Joe's", TODAY, []),
        ])
        r = self.c.post("/auth/setup", json={
            "username": USER, "password": "long-password"})
        assert r.status_code == 200, r.text

    def owner(self):
        """Run direct module calls as the signed-in account (the
        client's own requests carry the cookie instead)."""
        from api import quest
        return quest._as_user(USER)

    # -- helpers --
    def hunt(self, items=ITEMS, checked=None, finish=True, rid=None):
        c = self.c
        r = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": [{"name": n, "qty": 1} for n in items]})
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        for n in (items if checked is None else checked):
            c.post(f"/api/quest/sessions/{sid}/check",
                   json={"item": n, "checked": True})
        if finish:
            r = c.post(f"/api/quest/sessions/{sid}/state",
                       json={"state": "finished"})
            assert r.status_code == 200, r.text
        if rid:
            r = c.post(f"/api/quest/sessions/{sid}/receipt",
                       json={"receipt_id": rid})
            assert r.status_code == 200, r.text
        return sid

    def haul(self, sid):
        r = self.c.get(f"/api/quest/sessions/{sid}/haul")
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def fix(self, sid, kind, key):
        r = self.c.post(f"/api/quest/sessions/{sid}/haul/fix",
                        json={"kind": kind, "key": key})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def quest_bytes(self):
        p = os.path.join(os.environ["ARYA_DATA_DIR"], "users", USER, "quest.json")
        with open(p, "rb") as fh:
            return fh.read()

    def mutate(self, sid, fn):
        from api import quest
        with self.owner():
            quest._mutate(sid, fn)

    @staticmethod
    def keys(bucket):
        return [e["key"] for e in bucket]


class TestMatching(HaulBase):
    def test_open_hunt_is_400(self):
        sid = self.hunt(finish=False)
        r = self.c.get(f"/api/quest/sessions/{sid}/haul")
        self.assertEqual(r.status_code, 400)
        r = self.c.get("/api/quest/sessions/nope/haul")
        self.assertEqual(r.status_code, 404)

    def test_buckets_by_name_swap_extra_and_grabbed_only(self):
        sid = self.hunt(rid="r-1")
        h = self.haul(sid)
        rv = h["review"]
        self.assertEqual(self.keys(rv["matched"]), ["milk", "eggs", "bananas"])
        self.assertEqual(rv["read"], 5)
        # Greek Yogurt and Vanilla Yogurt share a head noun: a suggestion.
        self.assertEqual(self.keys(rv["swapped"]), ["greek yogurt"])
        sw = rv["swapped"][0]
        self.assertIs(sw["suggested"], True)
        self.assertEqual(sw["from"], "Vanilla Yogurt")
        self.assertIsNone(sw["fix"])
        self.assertEqual(self.keys(rv["on_receipt_only"]), ["dark chocolate bar"])
        self.assertEqual(self.keys(rv["grabbed_only"]), ["bread"])
        for bucket in rv.values():
            if isinstance(bucket, list):
                for e in bucket:
                    for k in ("key", "name", "qty", "fix"):
                        self.assertIn(k, e)
        # Default haul: every grab stays. A receipt gap never costs a
        # sticker. Only a stray receipt line waits for a tap.
        self.assertEqual(sorted(i["key"] for i in h["items"]),
                         ["bananas", "bread", "eggs", "greek yogurt", "milk"])
        src = {i["key"]: i["source"] for i in h["items"]}
        self.assertEqual(src["milk"], "matched")
        self.assertEqual(src["bread"], "grabbed")
        self.assertEqual(src["greek yogurt"], "grabbed")
        self.assertNotIn("dark chocolate bar", src)
        self.assertEqual(h["receipt"], {"attached": True, "count": 1})
        self.assertIs(h["settled"], True)

    def test_group_match_beats_a_different_name(self):
        with self.owner():
            self.state._save("dictionary.json", {"entries": [{
                "item_id": "costco-7", "canonical_name": "Kirkland Organic Eggs",
                "aliases": []}]})
            self.state._save("receipts.json", self.state.receipts() + [
                receipt("r-grp", "Trader Joe's", TODAY,
                        [line("KS ORG 24CT", 1, "costco-7")])])
        sid = self.hunt(items=["Eggs"], rid="r-grp")
        rv = self.haul(sid)["review"]
        self.assertEqual(self.keys(rv["matched"]), ["kirkland organic eggs"])
        self.assertEqual(rv["on_receipt_only"], [])

    def test_explicit_swapped_from_is_a_swap_without_a_question(self):
        sid = self.hunt(items=["Milk"], rid="r-1b")
        self.mutate(sid, lambda s: s["items"][0].update(
            name="Whole Milk", swapped_from="Oat Milk"))
        rv = self.haul(sid)["review"]
        self.assertEqual(self.keys(rv["swapped"]), ["whole milk"])
        self.assertIs(rv["swapped"][0]["suggested"], False)
        self.assertEqual(rv["swapped"][0]["from"], "Oat Milk")
        self.assertEqual(rv["matched"], [])

    def test_no_receipt_every_checked_item_stands(self):
        sid = self.hunt(checked=["Milk", "Eggs", "Bread"])
        h = self.haul(sid)
        self.assertIsNone(h["receipt"])
        self.assertIs(h["settled"], False)
        self.assertEqual(sorted(i["key"] for i in h["items"]), ["bread", "eggs", "milk"])
        self.assertTrue(all(i["source"] == "grabbed" for i in h["items"]))
        self.assertEqual(h["review"]["read"], 0)

    def test_a_scan_that_read_nothing_keeps_every_grab(self):
        sid = self.hunt(rid="r-empty")
        h = self.haul(sid)
        self.assertEqual(len(h["items"]), 5)
        self.assertEqual(h["review"]["read"], 0)

    def test_unchecked_items_are_never_in_the_haul(self):
        sid = self.hunt(checked=["Milk"], rid="r-1")
        h = self.haul(sid)
        self.assertEqual([i["key"] for i in h["items"]], ["milk"])
        self.assertEqual(h["review"]["grabbed_only"], [])

    def test_receipt_only_lines_say_whether_the_name_was_decoded(self):
        with self.owner():
            raw = {"raw": "KS ORG BNNA 3LB", "qty": 1, "unit_price": 1.0,
                   "line_total": 1.0, "line_type": "item", "status": "auto"}
            self.state._save("receipts.json", self.state.receipts() + [
                receipt("r-raw", "Trader Joe's", TODAY,
                        [line("Whole Milk"), raw])])
        sid = self.hunt(items=["Milk"], rid="r-raw")
        by = {e["key"]: e for e in self.haul(sid)["review"]["on_receipt_only"]}
        self.assertIs(by["ks org bnna 3lb"]["decoded"], False)
        sid2 = self.hunt(items=["Milk"], rid="r-1")
        by2 = {e["key"]: e for e in self.haul(sid2)["review"]["on_receipt_only"]}
        self.assertIs(by2["dark chocolate bar"]["decoded"], True)

    def test_item_keys_are_normalised_names(self):
        from api import haul
        self.assertEqual(haul.key_of("Greek  Yogurt!"), "greek yogurt")


class TestFixes(HaulBase):
    def test_fixes_shape_the_haul_and_leave_quest_json_alone(self):
        sid = self.hunt(rid="r-1")
        before = self.quest_bytes()
        h = self.fix(sid, "extra_add", "dark chocolate bar")
        self.assertIn("dark chocolate bar", [i["key"] for i in h["items"]])
        self.assertEqual(h["review"]["on_receipt_only"][0]["fix"], "extra_add")
        h = self.fix(sid, "grabbed_keep", "bread")
        self.assertIn("bread", [i["key"] for i in h["items"]])
        h = self.fix(sid, "swap_ok", "greek yogurt")
        self.assertIn("greek yogurt", [i["key"] for i in h["items"]])
        self.assertEqual(self.quest_bytes(), before)
        # Points never move with a fix.
        self.assertEqual(h["points"], self.haul(sid)["points"])

    def test_fixes_are_idempotent_last_write_wins_and_undoable(self):
        sid = self.hunt(rid="r-1")
        a = self.fix(sid, "extra_add", "dark chocolate bar")
        b = self.fix(sid, "extra_add", "dark chocolate bar")
        self.assertEqual(a["items"], b["items"])
        c = self.fix(sid, "extra_drop", "dark chocolate bar")
        self.assertNotIn("dark chocolate bar", [i["key"] for i in c["items"]])
        self.assertEqual(c["review"]["on_receipt_only"][0]["fix"], "extra_drop")
        d = self.fix(sid, "extra_none", "dark chocolate bar")
        self.assertIsNone(d["review"]["on_receipt_only"][0]["fix"])
        self.assertEqual(d["items"], self.haul(sid)["items"])
        # Undo of nothing is fine too.
        self.fix(sid, "extra_none", "dark chocolate bar")

    def test_swap_no_returns_both_sides_to_their_own_lists(self):
        sid = self.hunt(rid="r-1")
        h = self.fix(sid, "swap_no", "greek yogurt")
        self.assertEqual(h["review"]["swapped"], [])
        self.assertIn("greek yogurt", self.keys(h["review"]["grabbed_only"]))
        self.assertIn("vanilla yogurt", self.keys(h["review"]["on_receipt_only"]))
        # The grabbed item can still be kept after the denial.
        h = self.fix(sid, "grabbed_keep", "greek yogurt")
        self.assertIn("greek yogurt", [i["key"] for i in h["items"]])
        h = self.fix(sid, "swap_none", "greek yogurt")
        self.assertEqual(self.keys(h["review"]["swapped"]), ["greek yogurt"])

    def test_dropping_a_grab_leaves_it_off(self):
        sid = self.hunt(rid="r-1")
        self.assertIn("bread", [i["key"] for i in self.haul(sid)["items"]])
        h = self.fix(sid, "grabbed_drop", "bread")
        self.assertNotIn("bread", [i["key"] for i in h["items"]])
        self.assertEqual(h["review"]["grabbed_only"][0]["fix"], "grabbed_drop")
        # Undo puts it back; Keep is the explicit form of the default.
        h = self.fix(sid, "grabbed_none", "bread")
        self.assertIn("bread", [i["key"] for i in h["items"]])
        h = self.fix(sid, "grabbed_keep", "bread")
        src = {i["key"]: i["source"] for i in h["items"]}
        self.assertEqual(src["bread"], "kept")

    def test_an_unconfirmed_swap_keeps_the_grab_and_can_be_dropped(self):
        sid = self.hunt(rid="r-1")
        h = self.haul(sid)
        self.assertIn("greek yogurt", [i["key"] for i in h["items"]])
        self.assertIsNone(h["review"]["swapped"][0]["fix"])
        # Confirmed: it is a swap. Denied: it is a plain grab again.
        h = self.fix(sid, "swap_ok", "greek yogurt")
        src = {i["key"]: i["source"] for i in h["items"]}
        self.assertEqual(src["greek yogurt"], "swap")
        h = self.fix(sid, "swap_no", "greek yogurt")
        src = {i["key"]: i["source"] for i in h["items"]}
        self.assertEqual(src["greek yogurt"], "grabbed")
        h = self.fix(sid, "grabbed_drop", "greek yogurt")
        self.assertNotIn("greek yogurt", [i["key"] for i in h["items"]])

    def test_points_still_match_the_stickers_shown(self):
        sid = self.hunt(rid="r-1")
        h = self.haul(sid)
        # Items +50 for five grabs; five stickers shown. No mismatch.
        self.assertEqual(h["points"]["items"] // 10, len(h["items"]))

    def test_bad_fixes_are_400(self):
        sid = self.hunt(rid="r-1")
        for body in ({"kind": "nope", "key": "bread"},
                     {"kind": "extra_add", "key": "not a line"},
                     {"kind": "grabbed_keep", "key": "milk"},   # matched
                     {"kind": "", "key": ""}):
            r = self.c.post(f"/api/quest/sessions/{sid}/haul/fix", json=body)
            self.assertEqual(r.status_code, 400, body)
        r = self.c.post("/api/quest/sessions/nope/haul/fix",
                        json={"kind": "extra_add", "key": "x"})
        self.assertEqual(r.status_code, 404)
        r = self.c.post(f"/api/quest/sessions/{sid}/haul/fix", json=[1])
        self.assertEqual(r.status_code, 400)

    def test_hide_and_show(self):
        sid = self.hunt(rid="r-1")
        before = self.quest_bytes()
        h = self.c.post(f"/api/quest/sessions/{sid}/haul/hide",
                        json={"key": "milk", "hidden": True}).json()
        self.assertTrue(next(i for i in h["items"] if i["key"] == "milk")["hidden"])
        self.assertEqual(h["stats"]["items"], 4)
        h = self.c.post(f"/api/quest/sessions/{sid}/haul/hide",
                        json={"key": "milk", "hidden": False}).json()
        self.assertFalse(next(i for i in h["items"] if i["key"] == "milk")["hidden"])
        r = self.c.post(f"/api/quest/sessions/{sid}/haul/hide",
                        json={"key": "unicorn", "hidden": True})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.quest_bytes(), before)


class TestSecondReceipt(HaulBase):
    def test_second_receipt_merges_lines(self):
        sid = self.hunt(rid="r-1")
        before = self.quest_bytes()
        r = self.c.post(f"/api/quest/sessions/{sid}/haul/receipts",
                        json={"receipt_id": "r-2"})
        self.assertEqual(r.status_code, 200, r.text)
        h = r.json()
        self.assertEqual(h["receipt"]["count"], 2)
        self.assertIn("bread", self.keys(h["review"]["matched"]))
        self.assertEqual(h["review"]["grabbed_only"], [])
        self.assertEqual(h["review"]["read"], 6)
        # Idempotent.
        r = self.c.post(f"/api/quest/sessions/{sid}/haul/receipts",
                        json={"receipt_id": "r-2"})
        self.assertEqual(r.json()["receipt"]["count"], 2)
        self.assertEqual(self.quest_bytes(), before)

    def test_mismatched_store_is_refused(self):
        sid = self.hunt(rid="r-1")
        r = self.c.post(f"/api/quest/sessions/{sid}/haul/receipts",
                        json={"receipt_id": "r-costco"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Costco", r.json()["detail"])

    def test_receipt_dated_before_the_hunt_is_refused(self):
        sid = self.hunt(rid="r-1")
        r = self.c.post(f"/api/quest/sessions/{sid}/haul/receipts",
                        json={"receipt_id": "r-old"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("before the hunt", r.json()["detail"])

    def test_needs_the_trips_own_receipt_first(self):
        sid = self.hunt()
        r = self.c.post(f"/api/quest/sessions/{sid}/haul/receipts",
                        json={"receipt_id": "r-2"})
        self.assertEqual(r.status_code, 400)
        r = self.c.post(f"/api/quest/sessions/{sid}/haul/receipts", json={})
        self.assertEqual(r.status_code, 400)
        sid2 = self.hunt(rid="r-1")
        r = self.c.post(f"/api/quest/sessions/{sid2}/haul/receipts",
                        json={"receipt_id": "nope"})
        self.assertEqual(r.status_code, 404)


class TestPoints(HaulBase):
    def hunt_points(self, sid):
        from api import quest, social
        with self.owner():
            return social.hunt_points(quest.get_session(sid))

    def test_breakdown_total_equals_hunt_points(self):
        from api import haul, quest, social
        sid = self.hunt(rid="r-1")
        p = self.haul(sid)["points"]
        self.assertEqual(p["items"], 50)
        self.assertEqual(p["full_haul"], 25)
        self.assertEqual(p["boss"], 0)
        self.assertEqual(p["receipt"], 50)
        self.assertEqual(p["total"], p["items"] + p["full_haul"] + p["boss"] + p["receipt"])
        self.assertEqual(p["total"], self.hunt_points(sid))
        self.assertEqual(p["banked"], p["total"])
        self.assertEqual(p["pending"], 0)
        # A partial hunt: no full-haul bonus.
        sid2 = self.hunt(checked=["Milk", "Eggs"], rid="r-1b")
        p2 = self.haul(sid2)["points"]
        self.assertEqual((p2["items"], p2["full_haul"]), (20, 0))
        self.assertEqual(p2["total"], self.hunt_points(sid2))

    def test_boss_counts_only_when_that_item_is_checked(self):
        from api import quest, social
        sid = self.hunt(checked=["Milk", "Eggs"], rid="r-1")
        grp = quest._item_key("Bread")
        self.mutate(sid, lambda s: s.__setitem__(
            "boss", {"name": "Bread", "group": grp, "reports": 2}))
        h = self.haul(sid)
        self.assertEqual(h["boss"], {"name": "Bread", "found": False})
        self.assertEqual(h["points"]["boss"], 0)
        self.assertFalse(any(i["boss"] for i in h["items"]))
        # Now the boss is checked.
        self.c.post(f"/api/quest/sessions/{sid}/check",
                    json={"item": "Bread", "checked": True})
        h = self.haul(sid)
        self.assertEqual(h["boss"]["found"], True)
        want = getattr(social, "POINTS_BOSS", 40)
        self.assertEqual(h["points"]["boss"], want)
        self.assertEqual(h["points"]["total"],
                         h["points"]["items"] + h["points"]["full_haul"] + want + 50)
        if hasattr(social, "POINTS_BOSS"):
            self.assertEqual(h["points"]["total"], self.hunt_points(sid))
        # Only the boss item carries the flag, and only on the haul view.
        self.fix(sid, "grabbed_keep", "bread")
        flags = {i["key"]: i["boss"] for i in self.haul(sid)["items"]}
        self.assertTrue(flags["bread"])
        self.assertFalse(flags["milk"])

    def test_unsettled_points_wait_and_never_expire(self):
        from api import quest, social
        sid = self.hunt()
        p = self.haul(sid)["points"]
        self.assertEqual(p["banked"], 0)
        self.assertEqual(p["pending"], p["total"])
        self.assertGreater(p["total"], 0)
        # An old session date changes nothing on the pending path.
        self.mutate(sid, lambda s: s.update(created_at="2001-01-01T00:00:00",
                                            started_at="2001-01-01T00:00:00"))
        self.assertEqual(self.haul(sid)["points"], p)
        # The profile banks nothing yet.
        self.assertEqual(self.c.get("/api/quest/profile").json()["points"], 0)

    def test_late_receipt_pays_once(self):
        sid = self.hunt()
        pending = self.haul(sid)["points"]["total"]
        r = self.c.post(f"/api/quest/sessions/{sid}/receipt",
                        json={"receipt_id": "r-1b"})
        self.assertEqual(r.status_code, 200, r.text)
        after = self.c.get("/api/quest/profile").json()["points"]
        self.assertEqual(after, pending)
        p = self.haul(sid)["points"]
        self.assertEqual((p["banked"], p["pending"]), (pending, 0))
        # Viewing the haul again, and fixing it, never pays twice.
        self.haul(sid)
        self.assertEqual(self.c.get("/api/quest/profile").json()["points"], pending)

    def test_stats_carry_items_and_level(self):
        sid = self.hunt(rid="r-1")
        s = self.haul(sid)["stats"]
        self.assertEqual(s["items"], 5)
        self.assertGreaterEqual(s["level"], 1)


class TestTripName(unittest.TestCase):
    def test_deterministic_and_themed(self):
        from api import haul
        fruit = [{"name": n} for n in ("Bananas", "Blueberries", "Strawberries",
                                       "Apples", "Milk")]
        a = haul.trip_name(fruit, "2026-10-25T10:00:00")      # a Sunday
        self.assertEqual(a, "Sunday Fruit Bowl Run")
        self.assertEqual(a, haul.trip_name(fruit, "2026-10-25T10:00:00"))
        dairy = [{"name": n} for n in ("Milk", "Yogurt", "Butter", "Cream", "Bananas")]
        self.assertEqual(haul.trip_name(dairy, "2026-10-26T09:00:00"), "Monday Dairy Dash")
        frozen = [{"name": n} for n in ("Ice Cream", "Frozen Peas", "Popsicles",
                                        "Gelato", "Bread")]
        self.assertEqual(haul.trip_name(frozen, "2026-10-27T09:00:00"),
                         "Tuesday Cold Aisle Run")
        mixed = [{"name": n} for n in ("Bananas", "Milk", "Bread", "Rice", "Carrots")]
        self.assertEqual(haul.trip_name(mixed, "2026-10-28T09:00:00"),
                         "Wednesday Weekly Shop")

    def test_fewer_than_five_items_is_a_quick_run(self):
        from api import haul
        four = [{"name": n} for n in ("Bananas", "Blueberries", "Strawberries", "Apples")]
        self.assertEqual(haul.trip_name(four, "2026-10-25T10:00:00"), "Sunday Quick Run")
        self.assertEqual(haul.trip_name([], None), "Quick Run")


class TestPrivateBlock(HaulBase):
    def test_estimate_vs_actual_is_the_owners_alone(self):
        sid = self.hunt(rid="r-1")
        h = self.haul(sid)
        self.assertIsNotNone(h["private"])
        self.assertEqual(h["private"]["actual"], 12.5)
        r = self.c.get(f"/api/quest/sessions/{sid}/haul")
        self.assertEqual(r.headers.get("cache-control"), "no-store")
        # Another account cannot see this trip at all.
        from api import auth
        auth.create_user("bob@example.com", "pw-bob")
        other = TestClient(self.main.app)
        r = other.post("/auth/login", json={"username": "bob@example.com",
                                            "password": "pw-bob"})
        self.assertEqual(r.status_code, 200, r.text)
        r = other.get(f"/api/quest/sessions/{sid}/haul")
        self.assertEqual(r.status_code, 404)

    def test_no_receipt_no_private_block(self):
        sid = self.hunt()
        self.assertIsNone(self.haul(sid)["private"])

    def test_estimate_uses_history_before_this_trip(self):
        from api import haul, quest
        with self.owner():
            self.state._save("receipts.json", self.state.receipts() + [
                receipt("r-hist", "Trader Joe's", "2026-01-01",
                        [dict(line("Whole Milk", 1), line_total=3.0, sku="m1",
                              item_id="m1")])])
            self.state._save("dictionary.json", {"entries": [{
                "item_id": "m1", "canonical_name": "Whole Milk", "aliases": []}]})
        sid = self.hunt(items=["Milk"], rid="r-1b")
        with self.owner():
            pb = haul.private_block(quest.get_session(sid))
        self.assertEqual(pb["estimate_items"], 1)
        self.assertEqual(pb["estimate"], 3.0)


    def _history(self, day, price=3.0):
        with self.owner():
            self.state._save("receipts.json", self.state.receipts() + [
                receipt("r-hist", "Trader Joe's", day,
                        [dict(line("Whole Milk", 1), line_total=price, sku="m1",
                              item_id="m1")])])
            self.state._save("dictionary.json", {"entries": [{
                "item_id": "m1", "canonical_name": "Whole Milk", "aliases": []}]})

    def test_a_partial_estimate_says_how_many_items_it_covers(self):
        from api import haul, quest
        self._history("2026-01-01")
        sid = self.hunt(rid="r-1")           # five grabs, one priced
        with self.owner():
            pb = haul.private_block(quest.get_session(sid))
        self.assertEqual((pb["estimate_items"], pb["grabbed_items"]), (1, 5))
        self.assertEqual(pb["estimate"], 3.0)
        self.assertEqual(pb["actual"], 12.5)
        # The same numbers ride the haul view.
        pv = self.haul(sid)["private"]
        self.assertEqual((pv["estimate_items"], pv["grabbed_items"]), (1, 5))

    def test_prices_from_after_the_trip_are_not_history(self):
        from api import haul, quest
        self._history("2999-01-01", 9.0)     # bought AFTER this hunt
        sid = self.hunt(items=["Milk"], rid="r-1b")
        with self.owner():
            pb = haul.private_block(quest.get_session(sid))
        self.assertEqual(pb["estimate_items"], 0)
        self.assertIsNone(pb["estimate"])
        self.assertEqual(pb["grabbed_items"], 1)

    def test_a_price_dated_the_day_of_the_hunt_is_not_before_it(self):
        from api import haul, quest
        self._history(TODAY, 9.0)
        sid = self.hunt(items=["Milk"], rid="r-1b")
        with self.owner():
            pb = haul.private_block(quest.get_session(sid))
        self.assertIsNone(pb["estimate"])


class TestNoVerifiedAndNoModel(unittest.TestCase):
    def test_server_strings_never_say_verified(self):
        for name in ("haul.py", "crew.py", "haul_routes.py"):
            with open(os.path.join(API, name), encoding="utf-8") as fh:
                src = fh.read()
            self.assertNotIn("verified", src.lower(), name)
            self.assertNotIn("cropped", src.lower(), name)
            self.assertNotIn("meta_client", src, name)


class TestQueue(HaulBase):
    def test_add_dedupes_caps_removes_and_finishes(self):
        from api import haul
        with self.owner():
            self._queue_body(haul)

    def _queue_body(self, haul):
        rows = haul.queued_add("@Priya", "hp-1", ["Mandarins", "mandarins!", " Kiwi ", ""])
        self.assertEqual([r["name"] for r in rows], ["Mandarins", "Kiwi"])
        row = rows[0]
        self.assertEqual((row["qty"], row["from"], row["post_id"]), (1, "priya", "hp-1"))
        self.assertTrue(row["id"] and row["added_at"])
        # Dedupe also holds against what is already queued.
        rows = haul.queued_add("dev", "hp-2", ["kiwi", "Pears"])
        self.assertEqual([r["name"] for r in rows], ["Mandarins", "Kiwi", "Pears"])
        # Cap.
        many = [f"Thing {chr(97 + i % 26)}{i}" for i in range(60)]
        rows = haul.queued_add("dev", "hp-3", many)
        self.assertEqual(len(rows), haul.QUEUE_MAX)
        # Remove one, finish some.
        rid = rows[0]["id"]
        rows = haul.queued_remove(rid)
        self.assertNotIn(rid, [r["id"] for r in rows])
        ids = [r["id"] for r in rows[:3]]
        rows2 = haul.queued_finish(ids)
        self.assertEqual(len(rows2), len(rows) - 3)
        self.assertFalse(set(ids) & {r["id"] for r in rows2})
        self.assertEqual(haul.queued_finish(["nope"]), rows2)
        for bad in ("bad handle!", ""):
            with self.assertRaises(ValueError):
                haul.queued_add(bad, "hp-1", ["x"])
        with self.assertRaises(ValueError):
            haul.queued_add("priya", "bad id", ["x"])

    def test_queue_never_touches_the_list_ledger_or_dictionary(self):
        from api import haul, state
        with self.owner():
            before = repr(state.derived()["smart_list"]), repr(state.dictionary()), repr(state.receipts())
            haul.queued_add("priya", "hp-1", ["Mandarins", "Kiwi"])
            haul.queued_finish([r["id"] for r in haul.queued_list()])
            after = repr(state.derived()["smart_list"]), repr(state.dictionary()), repr(state.receipts())
        self.assertEqual(before, after)

    def test_routes(self):
        c = self.c
        self.assertEqual(c.get("/api/quest/queued").json(), {"queued": []})
        # Not a friend's post and not the demo: refused.
        r = c.post("/api/quest/queued", json={"from": "priya", "post_id": "hp-1",
                                              "names": ["Kiwi"]})
        self.assertEqual(r.status_code, 404)
        r = c.post("/api/quest/queued", json={"from": "priya", "post_id": "hp-1",
                                              "names": "Kiwi"})
        self.assertEqual(r.status_code, 400)
        r = c.post("/api/quest/queued/finish", json={"ids": "x"})
        self.assertEqual(r.status_code, 400)
        r = c.delete("/api/quest/queued/nope")
        self.assertEqual(r.status_code, 200)


class TestDemoSandbox(unittest.TestCase):
    """The demo household plays the whole loop; nothing reaches disk."""

    def setUp(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(HERE, "..", "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        from api import main
        main.MetaClient = FakeClient
        self.c = TestClient(main.app)
        self.c.post("/auth/demo")

    def disk(self):
        out = {}
        for root, _d, files in os.walk(os.environ["ARYA_DATA_DIR"]):
            for f in files:
                if f in ("sessions.json", "cost-ledger.jsonl"):
                    continue
                p = os.path.join(root, f)
                with open(p, "rb") as fh:
                    out[p] = fh.read()
        return out

    def test_the_haul_loop_works_in_the_sandbox_and_writes_nothing(self):
        c = self.c
        before = self.disk()
        r = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": [{"name": "Whole Milk 1 gal", "qty": 1}, {"name": "Hummus", "qty": 1}]})
        self.assertEqual(r.status_code, 200, r.text)
        sid = r.json()["id"]
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        for n in ("Whole Milk 1 gal", "Hummus"):
            c.post(f"/api/quest/sessions/{sid}/check", json={"item": n, "checked": True})
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "finished"})
        h = c.get(f"/api/quest/sessions/{sid}/haul").json()
        self.assertEqual(h["points"]["pending"], h["points"]["total"])
        r = c.post(f"/api/quest/sessions/{sid}/sample-receipt")
        self.assertEqual(r.status_code, 200, r.text)
        h = c.get(f"/api/quest/sessions/{sid}/haul").json()
        self.assertTrue(h["settled"])
        self.assertEqual(len(h["items"]), 2)
        r = c.post(f"/api/quest/sessions/{sid}/haul/hide",
                   json={"key": h["items"][0]["key"], "hidden": True})
        self.assertEqual(r.status_code, 200, r.text)
        r = c.post(f"/api/quest/sessions/{sid}/haul/post", json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(c.get("/api/quest/crew/audience").json(), {"audience": []})
        self.assertEqual(c.get("/api/quest/crew/feed").json(), {"feed": []})
        r = c.post("/api/quest/queued", json={"from": "priya", "post_id": "sample",
                                              "names": ["Mandarins", "Kiwi"]})
        self.assertEqual(r.status_code, 200, r.text)
        rows = r.json()["queued"]
        self.assertEqual([x["name"] for x in rows], ["Mandarins", "Kiwi"])
        left = c.delete(f"/api/quest/queued/{rows[0]['id']}").json()["queued"]
        self.assertEqual([x["name"] for x in left], ["Kiwi"])
        self.assertEqual(c.delete(f"/api/quest/sessions/{sid}/haul/post").status_code, 200)
        self.assertEqual(self.disk(), before)


if __name__ == "__main__":
    unittest.main()
