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


if __name__ == "__main__":
    unittest.main()
