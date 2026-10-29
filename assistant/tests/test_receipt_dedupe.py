"""Duplicate receipt uploads + bulk upload (owner, 2026-10-29).

The bug: uploading a Costco PDF from his phone failed with
"empty upload" (the service worker forwarded the POST and the
body arrived empty), and nothing stopped the SAME receipt from
being filed twice — each decode mints a fresh receipt_id, and
patterns/spend derive from the receipt list, so a duplicate
counted the trip twice.

Rules pinned here:
- an uploaded original (media) whose content matches a receipt
  already on file is skipped by add_receipts;
- the same content filed WITHOUT an upload keeps the old
  id-based behaviour (imports and synthetic records);
- find_duplicate returns the record on file so the decode doors
  can hand it back (the hunt doors settle by its id);
- the service worker never mediates non-GET requests;
- the Receipts picker accepts several files at once.
"""
import os
import tempfile
import unittest

from tests.frontend import src  # noqa: E402
ALICE = "alice@test.arya"


def _receipt(rid, merchant="Test Mart"):
    return {"receipt_id": rid, "merchant": merchant,
            "purchased_at": "2026-10-20T10:00:00",
            "lines": [{"sku": "111", "raw": "MILK", "qty": 1,
                       "line_total": 3.5, "status": "auto"}],
            "total": 3.5, "source_type": "pdf"}


class TestReceiptDedupe(unittest.TestCase):
    def setUp(self):
        from api import deps
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        from api import auth
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={
            "username": ALICE, "password": "pw-alice"})
        assert r.status_code == 200, r.text
        from api import state
        state.set_current_user(ALICE)
        self.state = state

    def tearDown(self):
        self.state.set_current_user(None)

    def test_same_upload_twice_files_once(self):
        media1 = {"dec-1": (b"%PDF-fake", "application/pdf")}
        self.assertEqual(
            self.state.add_receipts([_receipt("dec-1")], media=media1), 1)
        # A re-decode of the same receipt: new id, same content.
        media2 = {"dec-2": (b"%PDF-fake", "application/pdf")}
        self.assertEqual(
            self.state.add_receipts([_receipt("dec-2")], media=media2), 0)
        self.assertEqual(len(self.state.own_receipts()), 1)

    def test_find_duplicate_returns_the_filed_record(self):
        self.state.add_receipts([_receipt("dec-1")],
                                media={"dec-1": (b"x", "application/pdf")})
        dup = self.state.find_duplicate(_receipt("dec-9"))
        self.assertIsNotNone(dup)
        self.assertEqual(dup["receipt_id"], "dec-1")
        other = _receipt("dec-3", merchant="Other Store")
        self.assertIsNone(self.state.find_duplicate(other))

    def test_no_upload_keeps_id_based_behaviour(self):
        self.assertEqual(self.state.add_receipts([_receipt("a")]), 1)
        self.assertEqual(self.state.add_receipts([_receipt("b")]), 1)
        self.assertEqual(self.state.add_receipts([_receipt("a")]), 0)

    def test_fingerprint_ignores_id_and_name_variants(self):
        a = _receipt("x")
        b = _receipt("y")
        b["lines"] = [dict(b["lines"][0], decoded_name="Whole Milk")]
        self.assertEqual(self.state.receipt_fingerprint(a),
                         self.state.receipt_fingerprint(b))


class TestUploadShell(unittest.TestCase):
    def test_service_worker_never_mediates_writes(self):
        sw = src("sw.js")
        self.assertIn('if (e.request.method !== "GET") return;', sw)

    def test_receipts_picker_accepts_bulk(self):
        js = src("screens/Receipts.tsx")
        self.assertIn('id="rc-photo" accept="application/pdf,image/*" multiple', js)
        self.assertIn("Bulk upload done", js)
        self.assertIn("Already filed", js)


if __name__ == "__main__":
    unittest.main()
