"""Malformed input answers 400 — review 2026-10-28, M6/L12.

Before the fix: a non-JSON body, a JSON array where an object was
expected, or a non-numeric qty all surfaced as bare 500s; the flag
route mass-assigned any keys it was sent (an empty probe POST left
a junk record in the owner's real flags); a missing item_id wrote
a flag under the key None; a negative eyes index read the last
sighting instead of 404ing.
"""
import os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"


class TestValidation(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        self.state = main.state
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "v@example.com",
                                             "password": "pw-test"})
        assert r.status_code == 200, r.text

    def _as_user(self, fn):
        """Run a direct store call as the test user, then restore
        the context. The context must be clear again before the
        next client request: the test portal propagates this
        thread's context into requests, and the auth store lives
        at the root (context cleared)."""
        tok = self.state._current_user.set("v@example.com")
        try:
            return fn()
        finally:
            self.state._current_user.reset(tok)

    def _flags(self):
        return self._as_user(self.state.flags)

    def test_flag_rejects_non_json_body(self):
        r = self.c.post("/api/items/milk/flag", content=b"not json",
                        headers={"Content-Type": "application/json"})
        self.assertEqual(r.status_code, 400, r.text)

    def test_flag_rejects_array_body(self):
        r = self.c.post("/api/items/milk/flag", json=["never"])
        self.assertEqual(r.status_code, 400, r.text)

    def test_flag_rejects_empty_and_junk_only_bodies(self):
        for body in ({}, {"evil": 1}):
            r = self.c.post("/api/items/x/flag", json=body)
            self.assertEqual(r.status_code, 400, (body, r.text))
        self.assertEqual(self._flags(), {})

    def test_flag_stores_only_recognized_keys(self):
        r = self.c.post("/api/items/milk/flag",
                        json={"never": True, "evil": 1})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._flags(), {"milk": {"never": True}})

    def test_list_check_requires_item_id(self):
        r = self.c.post("/api/list/check", json={"checked": True})
        self.assertEqual(r.status_code, 400, r.text)
        self.assertEqual(self._flags(), {})

    def test_list_qty_guards(self):
        r = self.c.post("/api/list/qty", json={"qty": 2})
        self.assertEqual(r.status_code, 400, r.text)
        r = self.c.post("/api/list/qty",
                        json={"item_id": "milk", "qty": "abc"})
        self.assertEqual(r.status_code, 400, r.text)
        r = self.c.post("/api/list/qty",
                        json={"item_id": "milk", "qty": 3})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(self._flags()["milk"]["qty_override"], 3)

    def test_review_line_bad_idx_is_400_not_500(self):
        r = self.c.post("/api/review/line",
                        json={"action": "confirm", "receipt_id": "r",
                              "idx": "abc"})
        self.assertEqual(r.status_code, 400, r.text)
        r = self.c.post("/api/review/line", json={"action": "confirm"})
        self.assertEqual(r.status_code, 400, r.text)

    def test_array_body_is_400_on_object_routes(self):
        r = self.c.post("/api/list/add", json=[1, 2])
        self.assertEqual(r.status_code, 400, r.text)
        r = self.c.post("/auth/login", json=["x"])
        self.assertEqual(r.status_code, 400, r.text)

    def test_eyes_negative_idx_is_404(self):
        rec = {"id": "eye-1", "date": "2026-10-27", "kind": "fridge",
               "photo": "eye-1.jpg",
               "sightings": [{"name": "Milk", "state": "pending"}]}
        self._as_user(lambda: self.state.save_eyes_record(rec))
        r = self.c.post("/api/eyes/eye-1/sightings/-1",
                        json={"state": "confirmed"})
        self.assertEqual(r.status_code, 404, r.text)
        self.assertEqual(
            self._as_user(self.state.eyes_records)[0]["sightings"][0]["state"],
            "pending")

    def test_eyes_photo_rejects_unknown_kind(self):
        r = self.c.post("/eyes/photo?kind=garage", content=b"\xff\xd8\xff x",
                        headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 400, r.text)


if __name__ == "__main__":
    unittest.main()
