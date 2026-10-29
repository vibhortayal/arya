"""Tranche 1a exit doors — production-gap register #1/#2.

Receipt delete (with hunt detach), session dismiss, remove-from-
My-Stores, Eyes photo delete + retention cap, data export, and
full account deletion (friend mirrors scrubbed, feedback
anonymized, data directory erased). Over HTTP with real accounts,
mirroring test_friends.py.
"""
import json, os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"

ALICE = "alice@example.com"
BOB = "bob@example.com"


def _receipt(rid, merchant="Test Mart"):
    return {"receipt_id": rid, "merchant": merchant,
            "purchased_at": "2026-10-20T10:00:00",
            "lines": [{"name": "Whole Milk 1 gal", "qty": 1,
                       "price": 3.5, "line_total": 3.5,
                       "status": "verified"}],
            "subtotal": 3.5, "tax": 0.0, "total": 3.5,
            "source_type": "text"}


class TestDeletes(unittest.TestCase):
    def setUp(self):
        from api import deps
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        from api import auth
        deps._login_fails.clear()
        self.a = TestClient(main.app)
        r = self.a.post("/auth/setup", json={
            "username": ALICE, "password": "pw-alice"})
        assert r.status_code == 200, r.text
        auth.create_user(BOB, "pw-bob")
        self.b = TestClient(main.app)
        r = self.b.post("/auth/login", json={
            "username": BOB, "password": "pw-bob"})
        assert r.status_code == 200, r.text

    # -- seeding helpers (in-process, under the owner's context) --
    def _seed_receipt(self, rid="rc-test-1"):
        from api import state
        state.set_current_user(ALICE)
        try:
            state.add_receipts([_receipt(rid)])
        finally:
            state.set_current_user(None)

    def _seed_session(self, state_name="finished", receipt_id=None):
        from api import quest
        with quest._as_user(ALICE):
            sess = quest.create_session("Test Mart", raw_items=["Milk"])
            store = quest._store()
            for s in store["sessions"]:
                if s["id"] == sess["id"]:
                    s["state"] = state_name
                    s["finished_at"] = "2026-10-28T12:00:00"
                    if receipt_id:
                        s["receipt_id"] = receipt_id
                        s["settled"] = True
            quest._save_store(store)
            return sess["id"]

    def _session(self, sid):
        from api import quest
        with quest._as_user(ALICE):
            return next(s for s in quest._store()["sessions"]
                        if s["id"] == sid)

    # -- receipt delete --
    def test_receipt_delete_round_trip(self):
        self._seed_receipt()
        rows = self.a.get("/api/quest/receipts").json()["receipts"]
        self.assertEqual([r["receipt_id"] for r in rows], ["rc-test-1"])
        r = self.a.post("/api/quest/receipts/rc-test-1/delete", json={})
        self.assertEqual(r.status_code, 200, r.text)
        rows = self.a.get("/api/quest/receipts").json()["receipts"]
        self.assertEqual(rows, [])
        r = self.a.post("/api/quest/receipts/rc-test-1/delete", json={})
        self.assertEqual(r.status_code, 404, r.text)

    def test_receipt_delete_detaches_from_hunt(self):
        self._seed_receipt()
        sid = self._seed_session("done", receipt_id="rc-test-1")
        r = self.a.post("/api/quest/receipts/rc-test-1/delete", json={})
        self.assertEqual(r.status_code, 200, r.text)
        sess = self._session(sid)
        self.assertIsNone(sess["receipt_id"])
        self.assertFalse(sess["settled"])
        self.assertEqual(sess["state"], "finished")

    def test_receipt_delete_is_owner_only(self):
        self._seed_receipt()
        r = self.b.post("/api/quest/receipts/rc-test-1/delete", json={})
        self.assertEqual(r.status_code, 404, r.text)
        rows = self.a.get("/api/quest/receipts").json()["receipts"]
        self.assertEqual(len(rows), 1)

    # -- session dismiss --
    def test_session_dismiss(self):
        sid = self._seed_session("finished")
        unsettled = self.a.get("/api/quest/receipts").json()["unsettled"]
        self.assertEqual([e["session_id"] for e in unsettled], [sid])
        r = self.a.post(f"/api/quest/sessions/{sid}/delete", json={})
        self.assertEqual(r.status_code, 200, r.text)
        unsettled = self.a.get("/api/quest/receipts").json()["unsettled"]
        self.assertEqual(unsettled, [])
        r = self.a.post(f"/api/quest/sessions/{sid}/delete", json={})
        self.assertEqual(r.status_code, 404, r.text)

    # -- My Stores remove --
    def test_store_remove(self):
        r = self.b.post("/api/stores", json={
            "name": "Pavillions", "street": "100 Main St",
            "city": "Chino Hills", "state": "CA", "zip": "91709"})
        self.assertEqual(r.status_code, 200, r.text)
        sid = r.json()["id"]
        r = self.a.post("/api/stores/mine", json={"store_id": sid})
        self.assertEqual(r.status_code, 200, r.text)
        mine = self.a.get("/api/stores/mine").json()
        self.assertIn(sid, [s["id"] for s in mine["stores"]])
        r = self.a.post("/api/stores/mine/remove", json={"store_id": sid})
        self.assertEqual(r.status_code, 200, r.text)
        mine = self.a.get("/api/stores/mine").json()
        self.assertNotIn(sid, [s["id"] for s in mine["stores"]])
        r = self.a.post("/api/stores/mine/remove", json={"store_id": sid})
        self.assertEqual(r.status_code, 404, r.text)
        # The directory row itself survives a remove.
        found = self.a.get("/api/stores/search?q=Pavillions").json()
        self.assertTrue(any(s["id"] == sid for s in found["stores"]))

    # -- Eyes delete + retention cap --
    def _seed_eyes(self, rid, day="2026-10-28"):
        from api import state
        photo_dir = os.path.join(os.environ["ARYA_DATA_DIR"],
                                 "users", ALICE, "eyes_photos")
        os.makedirs(photo_dir, exist_ok=True)
        with open(os.path.join(photo_dir, rid + ".jpg"), "wb") as fh:
            fh.write(b"\xff\xd8img")
        state.set_current_user(ALICE)
        try:
            state.save_eyes_record({
                "id": rid, "kind": "fridge", "date": day,
                "photo": rid + ".jpg", "sightings": []})
        finally:
            state.set_current_user(None)
        return os.path.join(photo_dir, rid + ".jpg")

    def test_eyes_delete_removes_record_and_photo(self):
        path = self._seed_eyes("eyes-1")
        recs = self.a.get("/api/eyes").json()["records"]
        self.assertEqual([r["id"] for r in recs], ["eyes-1"])
        r = self.a.post("/api/eyes/eyes-1/delete", json={})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self.a.get("/api/eyes").json()["records"], [])
        self.assertFalse(os.path.exists(path))
        r = self.a.post("/api/eyes/eyes-1/delete", json={})
        self.assertEqual(r.status_code, 404, r.text)

    def test_eyes_retention_cap_prunes_oldest(self):
        from api import state
        old = state.EYES_MAX
        state.EYES_MAX = 3
        try:
            for i in range(4):
                self._seed_eyes(f"eyes-cap-{i}", day=f"2026-10-2{i}")
        finally:
            state.EYES_MAX = old
        recs = self.a.get("/api/eyes").json()["records"]
        self.assertEqual(len(recs), 3)
        self.assertNotIn("eyes-cap-0", [r["id"] for r in recs])

    # -- export --
    def test_export_carries_the_account(self):
        self._seed_receipt()
        r = self.a.get("/api/account/export")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertIn("attachment", r.headers.get("content-disposition", ""))
        body = r.json()
        self.assertEqual(body["user"], ALICE)
        self.assertEqual([x["receipt_id"] for x in body["receipts"]],
                         ["rc-test-1"])

    # -- account delete --
    def test_account_delete_erases_everything(self):
        # Friendship first: bob must lose his alice mirror.
        r = self.a.post("/api/quest/friends", json={"handle": "bob"})
        self.assertEqual(r.status_code, 200, r.text)
        r = self.b.post("/api/quest/friends/accept",
                        json={"handle": "alice"})
        self.assertEqual(r.status_code, 200, r.text)
        # A feedback note: attribution must be anonymized.
        r = self.a.post("/api/feedback",
                        json={"kind": "idea", "text": "more cowbell"})
        self.assertEqual(r.status_code, 200, r.text)
        self._seed_receipt()
        # Wrong password refuses.
        r = self.a.post("/auth/account/delete",
                        json={"password": "pw-wrong"})
        self.assertEqual(r.status_code, 401, r.text)
        # Right password erases.
        r = self.a.post("/auth/account/delete",
                        json={"password": "pw-alice"})
        self.assertEqual(r.status_code, 200, r.text)
        # Sign-in is gone, the old session is dead, the dir is gone.
        from fastapi.testclient import TestClient
        import api.main as main
        fresh = TestClient(main.app)
        r = fresh.post("/auth/login", json={
            "username": ALICE, "password": "pw-alice"})
        self.assertEqual(r.status_code, 401, r.text)
        r = self.a.get("/api/account/export")
        self.assertEqual(r.status_code, 401, r.text)
        udir = os.path.join(os.environ["ARYA_DATA_DIR"], "users", ALICE)
        self.assertFalse(os.path.isdir(udir))
        # Bob's friend list no longer mentions alice.
        friends = self.b.get("/api/quest/friends").json()["friends"]
        self.assertEqual(friends, [])
        # Feedback survives, anonymized.
        fb = os.path.join(os.environ["ARYA_DATA_DIR"], "feedback.jsonl")
        text = open(fb).read()
        self.assertIn("deleted-account", text)
        self.assertNotIn(ALICE, text)


if __name__ == "__main__":
    unittest.main()
