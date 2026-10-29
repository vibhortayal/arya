"""Finish flow — this trip's receipt, now or later (Discussion 41).

The owner rejected the filed-receipt picker on the Finish
screen: the receipt that settles a hunt is this trip's, snapped
at finish — or uploaded later against the same hunt. These
tests pin the whole rule: the picker is gone from the client;
Skip finishes the hunt UNSETTLED and the Receipts view logs it
with a "Receipt missing" tag; while unsettled, receipt-verified
rewards do not credit (badges and profile stats read
receipt-closed hunts only); the late upload settles the hunt
and clears the entry.
"""
import os, tempfile, unittest
from datetime import date

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

# Receipts that settle a hunt must not predate it (issue #14), so
# fixtures that settle hunts created now are dated today.
TODAY = date.today().isoformat()


def read(name):
    from tests import frontend
    return frontend.read(name)


class FakeClient:
    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        raise AssertionError("Quest paths must not call a model")


class TestFinishFlow(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, state
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        state._save("receipts.json", [{
            "receipt_id": "r-tj-1", "merchant": "Trader Joe's",
            "purchased_at": TODAY, "lines": [], "subtotal": 0,
            "tax": 0, "total": 0, "totals_reconcile": True}])
        r = self.c.post("/auth/setup", json={
            "username": "owner@example.com", "password": "long-password"})
        assert r.status_code == 200, r.text

    def play_and_finish(self, attach=False):
        c = self.c
        r = c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest",
            "items": [{"name": "Milk", "qty": 1}, {"name": "Eggs", "qty": 1}]})
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        c.post(f"/api/quest/sessions/{sid}/state", json={"state": "playing"})
        for item in ("Milk", "Eggs"):
            c.post(f"/api/quest/sessions/{sid}/check",
                   json={"item": item, "checked": True})
        r = c.post(f"/api/quest/sessions/{sid}/state",
                   json={"state": "finished"})
        assert r.status_code == 200, r.text
        if attach:
            r = c.post(f"/api/quest/sessions/{sid}/receipt",
                       json={"receipt_id": "r-tj-1"})
            assert r.status_code == 200, r.text
            return sid, r.json()
        return sid, r.json()

    def profile(self):
        return self.c.get("/api/quest/profile").json()

    def badge(self, pid, badge_id):
        return next(b for b in pid["badges"] if b["id"] == badge_id)

    def test_skip_finishes_unsettled_and_logs_the_entry(self):
        sid, sess = self.play_and_finish()
        self.assertEqual(sess["state"], "finished")
        self.assertIs(sess["settled"], False)
        self.assertIsNone(sess["receipt_id"])
        d = self.c.get("/api/quest/receipts").json()
        self.assertEqual([r["receipt_id"] for r in d["receipts"]], ["r-tj-1"])
        self.assertEqual(len(d["unsettled"]), 1)
        entry = d["unsettled"][0]
        self.assertEqual(entry["session_id"], sid)
        self.assertEqual(entry["store"], "Trader Joe's")
        self.assertEqual(entry["items_collected"], 2)
        self.assertEqual(entry["items_total"], 2)
        self.assertTrue(entry["finished_at"])

    def test_unsettled_credits_no_receipt_verified_rewards(self):
        # A fast, fully-checked hunt would earn Speed Demon and
        # Clean Sweep the moment it settled — while unsettled it
        # earns neither, and the hunt count does not move.
        self.play_and_finish()
        p = self.profile()
        self.assertEqual(p["stats"]["hunts"], 0)
        self.assertFalse(self.badge(p, "speed_demon")["earned"])
        self.assertFalse(self.badge(p, "clean_sweep")["earned"])

    def test_late_upload_settles_and_clears_the_tag(self):
        sid, _ = self.play_and_finish()
        r = self.c.post(f"/api/quest/sessions/{sid}/receipt",
                        json={"receipt_id": "r-tj-1"})
        done = r.json()
        self.assertEqual(done["state"], "done")
        self.assertIs(done["settled"], True)
        d = self.c.get("/api/quest/receipts").json()
        self.assertEqual(d["unsettled"], [])
        p = self.profile()
        self.assertEqual(p["stats"]["hunts"], 1)
        self.assertTrue(self.badge(p, "clean_sweep")["earned"])
        self.assertTrue(self.badge(p, "speed_demon")["earned"])

    def test_receipt_at_finish_is_settled_from_the_start(self):
        sid, sess = self.play_and_finish(attach=True)
        self.assertIs(sess["settled"], True)
        d = self.c.get("/api/quest/receipts").json()
        self.assertEqual(d["unsettled"], [])


class TestFinishClient(unittest.TestCase):
    def test_picker_is_gone(self):
        from tests import frontend
        fin = frontend.src("screens/Finish.tsx")
        self.assertNotIn("already filed", fin)
        self.assertNotIn('id="fin-receipts"', fin)
        self.assertIn('id="fin-skip"', fin)
        self.assertIn(">No receipt today</button>", fin)
        self.assertIn("Snap the receipt", fin)
        app = frontend.app()
        self.assertNotIn("renderFinishReceipts", app)
        self.assertNotIn("fin-receipts", app)
        self.assertNotIn("data-attach", app)

    def test_receipts_view_carries_the_unsettled_entry(self):
        # Hunt v2 item 7: the unsettled entry raises the Add receipt
        # sheet (wireframe 7b) — this trip's receipt, attached to its
        # own hunt, which settles it and clears the tag.
        from tests import frontend
        js = frontend.src("screens/Receipts.tsx")
        self.assertIn("Receipt missing", js)
        self.assertIn(">Add receipt</button>", js)
        self.assertIn("archive.unsettled", js)
        self.assertIn("setAr({ sessionId: e.session_id, label: e.store })", js)
        sheet = frontend.src("ui/AddReceiptSheet.tsx")
        self.assertIn("/api/quest/sessions/${sid}/receipt", sheet)
        self.assertIn('id="ar-sheet"', sheet)
        self.assertIn('id="ar-photo"', sheet)
        self.assertIn(".misstag", read("styles.css"))

    def test_rule_is_logged(self):
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "..", "..", "docs", "quest",
                               "DISCUSSION.md"), encoding="utf-8") as fh:
            log = fh.read()
        self.assertIn("Finish takes only this trip's receipt", log)


if __name__ == "__main__":
    unittest.main()
