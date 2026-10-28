"""Score shares (owner, 2026-10-28): the player character, wild
finds (caught live and caught by the receipt), the Shelf SOS
count, and Snap your haul. The numbers a card quotes must be
provable from the record: SOS trips count the player's own
reports across distinct sessions; wild finds are receipt lines
no hunt item claims; a haul photo's 'not seen' never claims an
item is missing."""
import os, tempfile, unittest
from datetime import date

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

TODAY = date.today().isoformat()


def read(name):
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "..", "pwa", name), encoding="utf-8") as fh:
        return fh.read()


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        raise AssertionError("share paths must not call a model")


class TestShares(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state
        main.MetaClient = FakeClient
        main._login_fails.clear()
        self.c = TestClient(main.app)
        state._save("receipts.json", [{
            "receipt_id": "r-tj-1", "merchant": "Trader Joe's",
            "purchased_at": TODAY,
            "lines": [{"decoded_name": "Milk"},
                      {"raw": "Oat Milk Chocolate"}],
            "subtotal": 0, "tax": 0, "total": 0,
            "totals_reconcile": True}])
        r = self.c.post("/auth/setup", json={
            "username": "owner@example.com", "password": "long-password"})
        assert r.status_code == 200, r.text

    def play(self, items=("Milk", "Eggs"), attach=False):
        c = self.c
        r = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": [{"name": n, "qty": 1} for n in items]})
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        for n in items:
            c.post(f"/api/quest/sessions/{sid}/check",
                   json={"item": n, "checked": True})
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "finished"})
        if attach:
            r = c.post(f"/api/quest/sessions/{sid}/receipt",
                       json={"receipt_id": "r-tj-1"})
            assert r.status_code == 200, r.text
        return sid

    def test_avatar_roundtrip_and_validation(self):
        r = self.c.post("/api/quest/avatar", json={"file": "blueberry.webp"})
        self.assertEqual(r.status_code, 200, r.text)
        p = self.c.get("/api/quest/profile").json()
        self.assertEqual(p["avatar"], "blueberry.webp")
        for bad in ("../secret.webp", "nope.webp", "", "blueberry.png"):
            r = self.c.post("/api/quest/avatar", json={"file": bad})
            self.assertEqual(r.status_code, 400, bad)

    def test_wild_finds_come_from_the_receipt_diff(self):
        sid = self.play(attach=True)
        sess = self.c.get(f"/api/quest/sessions/{sid}").json()
        self.assertEqual(sess["wild_finds"], ["Oat Milk Chocolate"])
        self.assertEqual(sess["my_reports"], [])

    def test_wild_item_added_live_lands_collected(self):
        c = self.c
        r = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": [{"name": "Milk", "qty": 1}]})
        sid = r.json()["id"]
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        r = c.post(f"/api/quest/sessions/{sid}/items",
                   json={"name": "Dark Chocolate Bar", "wild": True})
        self.assertEqual(r.status_code, 200, r.text)
        item = next(i for i in r.json()["items"]
                    if i["name"] == "Dark Chocolate Bar")
        self.assertTrue(item["wild"])
        self.assertTrue(item["checked"])

    def test_sos_count_counts_my_distinct_sessions(self):
        for _ in range(2):
            sid = self.play()
            r = self.c.post(f"/api/quest/sessions/{sid}/report-missing",
                            json={"item": "Eggs", "kind": "empty_shelf"})
            assert r.status_code == 200, r.text
        d = self.c.get("/api/quest/sos-count",
                       params={"store": "Trader Joe's",
                               "item": "Eggs"}).json()
        self.assertEqual(d["trips"], 2)
        d = self.c.get("/api/quest/sos-count",
                       params={"store": "Trader Joe's",
                               "item": "Milk"}).json()
        self.assertEqual(d["trips"], 0)
        sess = self.c.get(f"/api/quest/sessions/{sid}").json()
        self.assertIn("Eggs", sess["my_reports"])

    def test_haul_photo_matches_the_hunt(self):
        import api.eyes.service as eyes
        eyes.detect = lambda body, client, media_type="image/jpeg": [
            {"name": "Milk", "confidence": 0.9},
            {"name": "Trail Mix", "confidence": 0.8}]
        sid = self.play()
        r = self.c.post(f"/api/quest/haul-photo?session={sid}",
                        content=b"\xff\xd8\xff",
                        headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 200, r.text)
        d = r.json()
        self.assertEqual([s["item"] for s in d["seen"]], ["Milk"])
        self.assertEqual(d["extras"], ["Trail Mix"])
        self.assertEqual(d["not_seen"], ["Eggs"])
        sess = self.c.get(f"/api/quest/sessions/{sid}").json()
        self.assertEqual(sess["haul_check"]["extras"], ["Trail Mix"])


class TestShareClient(unittest.TestCase):
    def test_share_engine_and_surfaces(self):
        js = read("share.js")
        for needle in ("@traderjoes", "@costco", "captureStream",
                       "MediaRecorder",
                       "Arya keeps count", "Wild finds"):
            self.assertIn(needle, js)
        # A photo or a receipt is never called verified (haul slice).
        self.assertNotIn("receipt-verified", js)
        q = read("quest.js")
        for needle in ('id="share-haul"', 'id="share-love"',
                       'id="share-sos"', 'id="haul-photo"',
                       "Wild finds</h3>", '$("#btn-wild")',
                       "haul-photo?session="):
            self.assertIn(needle, q)
        html = read("index.html")
        for needle in ('id="share-sheet"', 'id="share-canvas"',
                       'id="wild-form"',
                       'id="btn-wild"', 'src="share.js"'):
            self.assertIn(needle, html)
        a = read("app.js")
        self.assertIn('post("/api/quest/avatar"', a)
        self.assertNotIn("paintPlayerPicker", a)  # one avatar, no second picker
        self.assertNotIn('id="pf-player"', html)

    def test_no_spend_on_cards(self):
        js = read("share.js")
        self.assertNotIn("receipt.total", js)
        self.assertNotIn("money(", js)


if __name__ == "__main__":
    unittest.main()

    def test_share_at_finish_settled_or_not(self):
        # Owner's phone test (2026-10-28): a 10/10 haul finished with
        # Skip offered nothing to share — the buttons were gated on
        # the receipt. Share belongs to the finish; the CARD carries
        # the honesty: receipt-verified only once settled.
        q = read("quest.js")
        self.assertNotIn('${attached ? `<button class="btn primary grow" id="share-haul"', q)
        js = read("share.js")
        self.assertIn('sess.state === "done"', js)
        self.assertIn("pts to bank", js)
        self.assertIn("receipt still to add", js)
