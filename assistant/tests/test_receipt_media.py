"""Receipt image retention (Discussion 42).

The owner asked whether his receipt images would be available
in the app; the honest answer was no — decode kept the lines
and discarded the photo. Retention now lives in the filing
path (state.add_receipts): a receipt filed from an uploaded
photo or PDF keeps its original bytes per account, served back
only to its owner at the recorded media type. Receipts filed
without an upload have no original and the endpoint 404s
honestly; the demo files nothing.
"""
import io, json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

PHOTO_PAYLOAD = {
    "store": "Safeway", "date": "2026-07-29", "subtotal": 4.49,
    "tax": 0.0, "total": 4.49,
    "lines": [{"item_no": "1", "product": "MILK", "brand": None,
               "detail": None, "list_price": 4.49, "price": 4.49,
               "discount": 0, "qty": 1, "is_return": False,
               "confidence": 0.95, "needs_user_check": False,
               "alternatives": []}]}

PDF_PAYLOAD = {
    "merchant": "Costco Example City", "purchased_at": "2026-10-20",
    "lines": [{"raw": "spinach", "sku": "1", "line_type": "item",
               "qty": 1, "line_total": 5.39, "confidence": 0.95},
              {"raw": "egg white", "sku": "2", "line_type": "item",
               "qty": 1, "line_total": 19.97, "confidence": 0.95}],
    "subtotal": 25.36, "tax": 0.0, "total": 25.36}

FIXTURE_PDF = os.path.join(os.path.dirname(__file__), "fixtures",
                           "receipt.pdf")


class FakeClient:
    payload = PHOTO_PAYLOAD

    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode=None, personal=None, **k):
        return json.dumps(type(self).payload), {}, 0.001


def jpeg_bytes():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (900, 1400), (233, 230, 220)).save(buf, "JPEG")
    return buf.getvalue()


class TestReceiptMedia(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = self.base
        from api import main
        from api import deps
        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.main = main
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner",
                                             "password": "long-password"})
        assert r.status_code == 200, r.text

    def file_photo(self):
        FakeClient.payload = PHOTO_PAYLOAD
        img = jpeg_bytes()
        r = self.c.post("/decode/photo", content=img,
                        headers={"Content-Type": "image/jpeg"})
        assert r.status_code == 200, r.text
        return r.json()["receipt"]["receipt_id"], img

    def test_photo_original_is_kept_and_served_to_its_owner(self):
        rid, img = self.file_photo()
        detail = self.c.get(f"/api/quest/receipts/{rid}").json()
        self.assertEqual(detail["photo"], rid)
        self.assertEqual(detail["media_type"], "image/jpeg")
        r = self.c.get(f"/api/quest/receipts/{rid}/original")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "image/jpeg")
        self.assertEqual(r.content, img)   # the bytes as uploaded
        # Stored per account, under the receipt id.
        path = os.path.join(self.base, "users", "owner",
                            "receipt-media", rid)
        self.assertTrue(os.path.exists(path))
        self.assertEqual(os.path.getsize(path), len(img))

    def test_pdf_original_is_kept_at_its_media_type(self):
        FakeClient.payload = PDF_PAYLOAD
        with open(FIXTURE_PDF, "rb") as fh:
            pdf = fh.read()
        r = self.c.post("/decode/pdf", content=pdf,
                        headers={"Content-Type": "application/pdf"})
        assert r.status_code == 200, r.text
        rid = r.json()["receipt"]["receipt_id"]
        detail = self.c.get(f"/api/quest/receipts/{rid}").json()
        self.assertEqual(detail["media_type"], "application/pdf")
        r = self.c.get(f"/api/quest/receipts/{rid}/original")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "application/pdf")
        self.assertEqual(r.content, pdf)

    def test_receipt_without_an_upload_has_no_original(self):
        # A seeded-history record, written straight into the
        # account's store (the shape bootstrap data arrives in).
        path = os.path.join(self.base, "users", "owner", "receipts.json")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            json.dump([{
                "receipt_id": "r-seed", "merchant": "Trader Joe's",
                "purchased_at": "2026-10-27", "lines": [], "subtotal": 0,
                "tax": 0, "total": 0, "totals_reconcile": True}], fh)
        detail = self.c.get("/api/quest/receipts/r-seed").json()
        self.assertIsNone(detail["photo"])
        r = self.c.get("/api/quest/receipts/r-seed/original")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(
            self.c.get("/api/quest/receipts/r-nope/original").status_code,
            404)

    def test_no_cross_account_access(self):
        rid, _ = self.file_photo()
        from api import auth
        auth.create_user("second@example.com", "second-password")
        other = TestClient(self.main.app)
        r = other.post("/auth/login", json={
            "username": "second@example.com",
            "password": "second-password"})
        assert r.status_code == 200, r.text
        self.assertEqual(
            other.get(f"/api/quest/receipts/{rid}/original").status_code,
            404)
        self.assertEqual(
            other.get(f"/api/quest/receipts/{rid}").status_code, 404)


class TestDemoFilesNothing(unittest.TestCase):
    def test_demo_receipts_have_no_originals(self):
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "demo_gen", os.path.join(os.path.dirname(__file__), "..",
                                     "harness", "make_demo_household.py"))
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        gen.main(base)
        from api import main
        from api import deps
        c = TestClient(main.app)
        c.post("/auth/demo")
        archive = c.get("/api/quest/receipts").json()["receipts"]
        assert archive, "demo household carries receipts"
        rid = archive[0]["receipt_id"]
        self.assertIsNone(archive[0]["photo"])
        self.assertEqual(
            c.get(f"/api/quest/receipts/{rid}/original").status_code, 404)
        self.assertFalse(os.path.exists(
            os.path.join(base, "users", "demo", "receipt-media")))


class TestViewerClient(unittest.TestCase):
    def test_detail_view_gains_view_receipt_only_with_an_original(self):
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "..", "pwa", "quest.js"),
                  encoding="utf-8") as fh:
            js = fh.read()
        self.assertIn("View receipt", js)
        self.assertIn("/original", js)
        self.assertIn("r.photo", js)   # gated on the original existing
        with open(os.path.join(here, "..", "pwa", "styles.css"),
                  encoding="utf-8") as fh:
            self.assertIn(".receiptimg", fh.read())


if __name__ == "__main__":
    unittest.main()
