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


if __name__ == "__main__":
    unittest.main()
