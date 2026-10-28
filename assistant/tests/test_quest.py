"""Arya Quest Stage A: sessions, the Optimizer, Shop-Off, social.
All deterministic code — a FakeClient stands in only because main.py
builds one on other routes; no Quest path calls a model."""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        raise AssertionError("Quest paths must not call a model")


def make_client(case):
    from api import main
    main.MetaClient = FakeClient
    main._login_fails.clear()
    case.c = TestClient(main.app)
    case.main = main
    return case.c


def setup_account(case, username="owner@example.com"):
    r = case.c.post("/auth/setup", json={"username": username,
                                         "password": "long-password"})
    assert r.status_code == 200, r.text


class TestQuestSessions(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        from api import state
        state._save("dictionary.json", {"entries": [
            {"item_id": "sku-milk", "sku": "11",
             "canonical_name": "Whole Milk 1 gal"},
            {"item_id": "sku-eggs", "sku": "22",
             "canonical_name": "Free Range Eggs"}]})
        state._save("receipts.json", [{
            "receipt_id": "r-tj-1", "merchant": "Trader Joe's",
            "purchased_at": "2026-10-27", "lines": [], "subtotal": 0,
            "tax": 0, "total": 0, "totals_reconcile": True}])
        setup_account(self)

    def test_lifecycle_and_merge_on_add(self):
        c = self.c
        r = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": [{"name": "milk", "qty": 1}, {"name": "Eggs", "qty": 2}]})
        assert r.status_code == 200, r.text
        sess = r.json()
        assert sess["state"] == "not_started" and sess["mode"] == "quest"
        assert sess["store"] == "Trader Joe's"
        assert len(sess["items"]) == 2
        sid = sess["id"]
        # adding the same product again merges quantity (dictionary identity:
        # "Milk" and "Whole Milk 1 gal" resolve to the same product group)
        r = c.post(f"/api/quest/sessions/{sid}/items",
                   json={"name": "Whole Milk 1 gal", "qty": 2})
        items = {i["name"]: i for i in r.json()["items"]}
        assert len(items) == 2, items
        milk = next(i for i in items.values() if "Milk" in i["name"])
        assert milk["qty"] == 3, milk
        # unknown product stays as typed, its own line
        r = c.post(f"/api/quest/sessions/{sid}/items", json={"name": "Mystery Jam"})
        assert len(r.json()["items"]) == 3
        # play, check, pause, resume
        r = c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        assert r.json()["started_at"]
        r = c.post(f"/api/quest/sessions/{sid}/check",
                   json={"item": "Mystery Jam", "checked": True})
        jam = next(i for i in r.json()["items"] if i["name"] == "Mystery Jam")
        assert jam["checked"] is True
        r = c.post(f"/api/quest/sessions/{sid}/check",
                   json={"item": "Nope", "checked": True})
        assert r.status_code == 404
        r = c.post(f"/api/quest/sessions/{sid}/state", json={"state": "bogus"})
        assert r.status_code == 400
        # receipt finish: an unknown receipt is refused, a filed one closes
        r = c.post(f"/api/quest/sessions/{sid}/receipt",
                   json={"receipt_id": "r-nope"})
        assert r.status_code == 404
        r = c.post(f"/api/quest/sessions/{sid}/receipt",
                   json={"receipt_id": "r-tj-1"})
        done = r.json()
        assert done["state"] == "done" and done["receipt_id"] == "r-tj-1"
        assert done["finished_at"]
        # listing carries it; an unknown session 404s
        got = c.get("/api/quest/sessions").json()["sessions"]
        assert [s["id"] for s in got] == [sid]
        assert c.get("/api/quest/sessions/qs-nope").status_code == 404

    def test_create_validation(self):
        c = self.c
        r = c.post("/api/quest/sessions", json={"mode": "quest", "items": []})
        assert r.status_code == 400
        r = c.post("/api/quest/sessions", json={
            "store": "Costco", "mode": "turbo", "items": []})
        assert r.status_code == 400
        r = c.post("/api/quest/sessions", json={
            "store": "Costco", "items": ["Eggs", "Eggs"]})
        sess = r.json()
        assert sess["mode"] == "quest"  # default
        assert len(sess["items"]) == 1 and sess["items"][0]["qty"] == 2


BERRY_DICT = {"entries": [
    {"item_id": "sku-eggs", "sku": "22", "canonical_name": "Free Range Eggs"},
    {"item_id": "sku-milk-w", "sku": "31", "canonical_name": "Whole Milk 1 gal"},
    {"item_id": "sku-milk-o", "sku": "32", "canonical_name": "Oat Milk"},
    {"item_id": "sku-bb", "sku": "41", "canonical_name": "Blueberries"},
    {"item_id": "sku-bb-org", "sku": "42", "canonical_name": "Organic Blueberries"},
    {"item_id": "sku-bb-frz", "sku": "43", "canonical_name": "Frozen Blueberries"}]}


class TestOptimizer(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        from api import state
        state._save("dictionary.json", BERRY_DICT)
        setup_account(self)

    def optimize(self, items):
        r = self.c.post("/api/quest/optimize",
                        json={"items": items, "store": "Costco"})
        assert r.status_code == 200, r.text
        return r.json()

    def test_merge_duplicates_sum_qty(self):
        out = self.optimize([{"name": "Eggs"}, {"name": "eggs", "qty": 2}])
        assert out["report"]["in"] == 2 and out["report"]["out"] == 1
        line = out["items"][0]
        assert line["name"] == "Free Range Eggs" and line["qty"] == 3
        m = out["report"]["merged"]
        assert len(m) == 1 and m[0]["from"] == ["Eggs", "eggs"] and m[0]["qty"] == 3

    def test_typo_corrected_and_reported(self):
        out = self.optimize([{"name": "Free Range Egss"}])
        assert out["items"][0]["name"] == "Free Range Eggs"
        assert out["report"]["corrected"] == [
            {"from": "Free Range Egss", "to": "Free Range Eggs"}]
        assert out["report"]["questions"] == []

    def test_ambiguity_asks_never_guesses(self):
        out = self.optimize([{"name": "blueberries"}])
        # no blueberry line is placed; a question with all three real
        # products comes back instead
        assert out["items"] == []
        q = out["report"]["questions"]
        assert len(q) == 1 and q[0]["item"] == "blueberries"
        names = {c["name"] for c in q[0]["candidates"]}
        assert names == {"Blueberries", "Organic Blueberries",
                         "Frozen Blueberries"}, names

    def test_typed_distinguishing_word_selects(self):
        out = self.optimize([{"name": "frozen blueberries"},
                             {"name": "Organic Blueberries"}])
        names = [i["name"] for i in out["items"]]
        assert names == ["Frozen Blueberries", "Organic Blueberries"], names
        assert out["report"]["questions"] == []
        # and plain "milk" asks too: whole and oat are different products
        out = self.optimize([{"name": "milk"}])
        assert out["items"] == []
        assert len(out["report"]["questions"]) == 1

    def test_unresolved_stays_as_typed_flagged(self):
        out = self.optimize([{"name": "Unobtainium Dust", "qty": 2}])
        assert out["report"]["unresolved"] == ["Unobtainium Dust"]
        line = out["items"][0]
        assert line["name"] == "Unobtainium Dust" and line["qty"] == 2
        assert line["unresolved"] is True


class TestShopOff(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        from api import state
        state._save("receipts.json", [
            {"receipt_id": "r-you", "merchant": "Trader Joe's",
             "purchased_at": "2026-10-26T18:43:05", "lines": [],
             "subtotal": 0, "tax": 0, "total": 0},
            {"receipt_id": "r-opp", "merchant": "Trader Joe's",
             "purchased_at": "2026-10-26T18:42:18", "lines": [],
             "subtotal": 0, "tax": 0, "total": 0}])
        setup_account(self)
        # Shop-Off opponents must be real accounts (review M10).
        from api import auth
        auth.create_user("cartqueen@example.com", "long-password")

    def _finish(self, session_id, receipt_id):
        sess = self.c.get(f"/api/quest/sessions/{session_id}").json()
        for it in sess["items"]:
            r = self.c.post(f"/api/quest/sessions/{session_id}/check",
                            json={"item": it["name"], "checked": True})
            assert r.status_code == 200, r.text
        r = self.c.post(f"/api/quest/sessions/{session_id}/receipt",
                        json={"receipt_id": receipt_id})
        assert r.status_code == 200, r.text

    def test_photo_finish_by_receipt_time(self):
        c = self.c
        r = c.post("/api/quest/shopoff", json={
            "store": "Trader Joe's", "items": ["Milk", "Eggs"],
            "opponent_handle": "@cartqueen"})
        assert r.status_code == 200, r.text
        race = r.json()
        assert race["state"] == "racing" and race["winner"] is None
        me, opp = race["players"]
        assert me["handle"] == "owner" and opp["handle"] == "cartqueen"
        assert opp["placeholder"] is True
        assert me["progress"] == {"checked": 0, "total": 2, "complete": False}
        # opponent finishes on an earlier receipt; mine lands later
        self._finish(opp["session_id"], "r-opp")
        mid = c.get(f"/api/quest/shopoff/{race['id']}").json()
        assert mid["state"] == "racing"  # I am still shopping
        self._finish(me["session_id"], "r-you")
        final = c.get(f"/api/quest/shopoff/{race['id']}").json()
        assert final["state"] == "finished"
        # 18:42:18 beats 18:43:05: the receipt is the photo finish
        assert final["winner"] == "cartqueen", final
        assert all(p["done"] and p["progress"]["complete"]
                   for p in final["players"])


class TestSocial(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        from datetime import date, timedelta
        from api import state
        today = date.today()
        receipts = []
        for w in range(5):
            d = (today - timedelta(days=7 * w)).isoformat()
            receipts.append({
                "receipt_id": f"r-w{w}", "merchant": "Costco",
                "purchased_at": d,
                "lines": [{"item_id": "sku-eggs", "sku": "22", "qty": 1,
                           "line_type": "item", "line_total": 9.0,
                           "status": "auto",
                           "decoded_name": "Free Range Eggs"}] +
                          ([{"item_id": "sku-bn", "sku": "23", "qty": 1,
                             "line_type": "item", "line_total": 1.5,
                             "status": "auto",
                             "decoded_name": "Organic Bananas"}] if w < 4 else []),
                "subtotal": 10.5, "tax": 0, "total": 10.5})
        state._save("receipts.json", receipts)
        state._save("quest.json", {"friends": [
            {"handle": "cartqueen", "status": "pending_in",
             "top_badge": "Speed Demon", "last_hunt": "Costco · yesterday"}]})
        setup_account(self)
        # Friend requests resolve against real accounts (review
        # M10): cartqueen and milk_runner must exist to be asked.
        from api import auth
        auth.create_user("cartqueen@example.com", "long-password")
        auth.create_user("milk_runner@example.com", "long-password")

    def test_friends_request_accept(self):
        c = self.c
        friends = c.get("/api/quest/friends").json()["friends"]
        assert len(friends) == 1 and friends[0]["status"] == "pending_in"
        r = c.post("/api/quest/friends/accept", json={"handle": "@CartQueen"})
        assert r.json()["status"] == "accepted"
        r = c.post("/api/quest/friends", json={"handle": "milk_runner"})
        assert r.json()["status"] == "pending_out"
        r = c.post("/api/quest/friends", json={"handle": "milk_runner"})
        assert r.json()["status"] == "pending_out"  # no duplicate
        r = c.post("/api/quest/friends", json={"handle": "owner"})
        assert r.status_code == 400  # your own handle
        r = c.post("/api/quest/friends/accept", json={"handle": "ghost"})
        assert r.status_code == 404
        handles = {f["handle"] for f in c.get("/api/quest/friends").json()["friends"]}
        assert handles == {"cartqueen", "milk_runner"}

    def test_profile_stats_and_badges(self):
        p = self.c.get("/api/quest/profile").json()
        assert p["handle"] == "owner"
        assert p["stats"]["receipts"] == 5
        assert p["stats"]["hunts"] == 0
        assert p["stats"]["streak_weeks"] == 5, p["stats"]
        assert p["mapped_stores"] == []
        badges = {b["id"]: b for b in p["badges"]}
        assert badges["egg_baron"]["earned"] is True
        assert badges["banana_republic"]["earned"] is True
        assert badges["top_contributor"]["earned"] is False
        assert badges["top_contributor"]["detail"] == "5 of 10 receipts"
        assert badges["first_mapper"]["earned"] is False
        assert badges["speed_demon"]["earned"] is False

    def test_speed_demon_and_clean_sweep_from_a_hunt(self):
        c = self.c
        r = c.post("/api/quest/sessions", json={
            "store": "Costco", "items": [{"name": "Eggs"}]})
        sid = r.json()["id"]
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        c.post(f"/api/quest/sessions/{sid}/check",
               json={"item": "Eggs", "checked": True})
        c.post(f"/api/quest/sessions/{sid}/receipt",
               json={"receipt_id": "r-w0"})
        p = c.get("/api/quest/profile").json()
        assert p["stats"]["hunts"] == 1
        badges = {b["id"]: b for b in p["badges"]}
        assert badges["speed_demon"]["earned"] is True
        assert badges["clean_sweep"]["earned"] is True


class TestDriverLadder(unittest.TestCase):
    """The scene is a viewport, not the game: a hunt played through
    the strip driver completes and scores exactly like one played
    through the aisle driver. The session records its starting
    driver; nothing in play or scoring reads it."""

    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        from api import state
        state._save("dictionary.json", BERRY_DICT)
        state._save("receipts.json", [
            {"receipt_id": "r-strip", "merchant": "Trader Joe's",
             "purchased_at": "2026-10-27T18:42:18", "lines": [],
             "subtotal": 0, "tax": 0, "total": 0},
            {"receipt_id": "r-aisle", "merchant": "Trader Joe's",
             "purchased_at": "2026-10-27T19:42:18", "lines": [],
             "subtotal": 0, "tax": 0, "total": 0},
            {"receipt_id": "r-photo", "merchant": "Trader Joe's",
             "purchased_at": "2026-10-27T20:42:18", "lines": [],
             "subtotal": 0, "tax": 0, "total": 0}])
        setup_account(self)

    def _play(self, driver, receipt_id):
        c = self.c
        r = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest", "driver": driver,
            "items": [{"name": "Free Range Eggs"},
                      {"name": "Whole Milk 1 gal"}]})
        assert r.status_code == 200, r.text
        sess = r.json()
        assert sess["driver"] == driver
        sid = sess["id"]
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        for it in sess["items"]:
            r = c.post(f"/api/quest/sessions/{sid}/check",
                       json={"item": it["name"], "checked": True})
            assert r.status_code == 200, r.text
        r = c.post(f"/api/quest/sessions/{sid}/receipt",
                   json={"receipt_id": receipt_id})
        assert r.status_code == 200, r.text
        done = r.json()
        profile = c.get("/api/quest/profile").json()
        return done, profile

    def test_strip_and_aisle_score_identically(self):
        strip_done, p1 = self._play("strip", "r-strip")
        assert strip_done["state"] == "done"
        assert all(i["checked"] for i in strip_done["items"])
        badges1 = {b["id"] for b in p1["badges"] if b["earned"]}
        assert p1["stats"]["hunts"] == 1
        assert {"speed_demon", "clean_sweep"} <= badges1
        aisle_done, p2 = self._play("aisle", "r-aisle")
        assert aisle_done["state"] == "done"
        assert all(i["checked"] for i in aisle_done["items"])
        badges2 = {b["id"] for b in p2["badges"] if b["earned"]}
        assert badges2 == badges1  # the viewport changed nothing
        assert p2["stats"]["hunts"] == 2

    def test_photo_driver_accepted(self):
        # Regression (2026-10-27): the photo-walk driver shipped as the
        # mapped-store default but was missing from DRIVERS, so every
        # hunt start at a mapped store failed with
        # "driver must be one of ('cloud', 'aisle', 'strip')".
        done, p = self._play("photo", "r-photo")
        assert done["state"] == "done"
        assert p["stats"]["hunts"] == 1

    def test_driver_defaults_to_strip_and_validates(self):
        c = self.c
        r = c.post("/api/quest/sessions", json={
            "store": "Costco", "items": ["Eggs"]})
        assert r.json()["driver"] == "strip"  # no model -> strip
        r = c.post("/api/quest/sessions", json={
            "store": "Costco", "items": ["Eggs"], "driver": "hologram"})
        assert r.status_code == 400


class TestSpotter(unittest.TestCase):
    """"Not here" reports: a report flags a stop, edits nothing, and
    earns nothing until time resolves it. Resolution transitions are
    rollout — this build carries the states and the data shape."""

    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        from api import state
        state._save("dictionary.json", BERRY_DICT)
        setup_account(self)
        r = self.c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": [{"name": "Free Range Eggs"},
                      {"name": "Whole Milk 1 gal"}]})
        assert r.status_code == 200, r.text
        self.sid = r.json()["id"]
        self.c.post(f"/api/quest/sessions/{self.sid}/state",
                    json={"state": "playing"})

    def _report(self, item="Free Range Eggs", kind="empty_shelf", **kw):
        body = {"item": item, "kind": kind}
        body.update(kw)
        return self.c.post(
            f"/api/quest/sessions/{self.sid}/report-missing", json=body)

    def test_report_files_open_and_reads_back_by_store(self):
        r = self._report(photo="shelf-1842.jpg")
        assert r.status_code == 200, r.text
        rep = r.json()
        assert rep["state"] == "reported" and rep["kind"] == "empty_shelf"
        assert rep["store"] == "Trader Joe's"
        assert rep["item"] == "Free Range Eggs"
        assert rep["photo"] == "shelf-1842.jpg"
        assert rep["reporter"] == "owner"
        out = self.c.get("/api/quest/stores/Trader%20Joe%27s/reports").json()
        assert out["count"] == 1 and out["reports"][0]["id"] == rep["id"]
        # a different store reads empty; name matching is forgiving
        out = self.c.get("/api/quest/stores/Costco/reports").json()
        assert out["count"] == 0
        out = self.c.get("/api/quest/stores/trader%20joes/reports").json()
        assert out["count"] == 1
        # the hunt itself is untouched: the item is still there to find
        sess = self.c.get(f"/api/quest/sessions/{self.sid}").json()
        egg = next(i for i in sess["items"] if "Eggs" in i["name"])
        assert egg["checked"] is False

    def test_report_is_idempotent_per_stop_and_validates(self):
        first = self._report().json()
        again = self._report(kind="cant_tell").json()
        assert again["id"] == first["id"]  # one open report per stop
        out = self.c.get("/api/quest/stores/Trader%20Joe%27s/reports").json()
        assert out["count"] == 1
        r = self._report(kind="vanished")
        assert r.status_code == 400
        r = self._report(item="Unobtainium Dust")
        assert r.status_code == 404
        r = self.c.post("/api/quest/sessions/qs-nope/report-missing",
                        json={"item": "Eggs", "kind": "empty_shelf"})
        assert r.status_code == 404
        # a second stop reports independently
        r = self._report(item="Whole Milk 1 gal", kind="replaced")
        assert r.status_code == 200
        out = self.c.get("/api/quest/stores/Trader%20Joe%27s/reports").json()
        assert out["count"] == 2

    def test_profile_counts_spots_and_eagle_eye_waits_for_truth(self):
        self._report()
        p = self.c.get("/api/quest/profile").json()
        assert p["stats"]["spots_reported"] == 1
        badges = {b["id"]: b for b in p["badges"]}
        assert badges["eagle_eye"]["earned"] is False
        assert badges["eagle_eye"]["detail"] == "no verified spots yet"
        # a report resolving as a verified move (a rollout transition;
        # seeded here in its data shape) is what earns the badge
        from api import state
        ctx = state._current_user.set("owner@example.com")
        try:
            store = state._load("quest.json", {})
            store["reports"][0]["state"] = "verified_move"
            state._save("quest.json", store)
        finally:
            state._current_user.reset(ctx)
        p = self.c.get("/api/quest/profile").json()
        badges = {b["id"]: b for b in p["badges"]}
        assert badges["eagle_eye"]["earned"] is True
        assert badges["eagle_eye"]["detail"] == "1 verified spot"
        # and a resolved stockout closes the store's open queue
        out = self.c.get("/api/quest/stores/Trader%20Joe%27s/reports").json()
        assert out["count"] == 0


class TestReceiptArchive(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        make_client(self)
        from api import state
        state._save("receipts.json", [
            {"receipt_id": "r-old", "merchant": "Costco",
             "purchased_at": "2026-10-20", "source_type": "grocery",
             "lines": [{"decoded_name": "Eggs", "qty": 1,
                        "unit_price": 9.0, "line_total": 9.0,
                        "line_type": "item", "status": "auto"}],
             "subtotal": 9.0, "tax": 0, "total": 9.0,
             "totals_reconcile": True, "image_ref": None},
            {"receipt_id": "r-new", "merchant": "Trader Joe's",
             "purchased_at": "2026-10-27T18:42:18",
             "source_type": "photo",
             "lines": [{"decoded_name": "Milk", "qty": 1,
                        "unit_price": 4.5, "line_total": 4.5,
                        "line_type": "item", "status": "auto"},
                       {"decoded_name": "Old Yogurt", "qty": 1,
                        "unit_price": -12.99, "line_total": -12.99,
                        "line_type": "return", "status": "auto"}],
             "subtotal": -8.49, "tax": 0.4, "total": -8.09,
             "totals_reconcile": False, "image_ref": None}])
        setup_account(self)

    def test_archive_newest_first_with_facts(self):
        rs = self.c.get("/api/quest/receipts").json()["receipts"]
        assert [r["receipt_id"] for r in rs] == ["r-new", "r-old"]
        new = rs[0]
        assert new["merchant"] == "Trader Joe's" and new["items"] == 1
        assert new["returns_total"] == -12.99
        assert new["totals_reconcile"] is False
        assert new["photo"] is None  # decode retains no photo today
        assert rs[1]["returns_total"] == 0

    def test_detail_is_the_digitized_twin(self):
        d = self.c.get("/api/quest/receipts/r-new").json()
        assert d["total"] == -8.09 and d["tax"] == 0.4
        assert [ln["name"] for ln in d["lines"]] == ["Milk", "Old Yogurt"]
        assert d["lines"][1]["line_type"] == "return"
        assert self.c.get("/api/quest/receipts/r-nope").status_code == 404


if __name__ == "__main__":
    unittest.main()
