"""Intake parity (owner ruling 2026-10-27): the in-app Photo and
Voice doors call the Meta API — including in the demo household,
where they work live and persist nothing."""
from tests.conftest import one_list
import io, json, os, tempfile, unittest, wave

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

PHOTO_PAYLOAD = {"store": "Safeway", "date": "2026-07-29", "subtotal": 4.49,
                 "tax": 0.0, "total": 4.49,
                 "lines": [{"item_no": "1", "product": "MILK", "brand": None,
                            "detail": None, "list_price": 4.49, "price": 4.49,
                            "discount": 0, "qty": 1, "is_return": False,
                            "confidence": 0.95, "needs_user_check": False,
                            "alternatives": []}]}


def wav_bytes(seconds=1.0, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return buf.getvalue()


class FakeClient:
    """Stands in for MetaClient: chat serves the photo decode and
    the Add camera's list read, and transcribe serves Muse Voice
    Transcribe. The real client's Bearer-key request shape is
    covered in test_voice.py."""

    def __init__(self, ledger=None):
        pass

    def chat(self, messages, mode=None, personal=None, **k):
        assert personal is True and mode == "standard"
        user = messages[-1]["content"]
        if isinstance(user, list):
            text = " ".join(p.get("text", "") for p in user
                            if isinstance(p, dict))
            if "shopping list" in text:
                return json.dumps({"kind": "list",
                                   "items": ["oat milk", "eggs"]}), {}, 0.01
        return json.dumps(PHOTO_PAYLOAD), {}, 0.02

    def transcribe(self, wav, duration_s):
        return {"text": "oat milk, eggs"}, 0.0001


def fresh_client():
    os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
    from api import main
    from api import deps
    deps.MetaClient = FakeClient
    deps._login_fails.clear()
    return TestClient(main.app), main


class TestTranscribeEndpoint(unittest.TestCase):
    def setUp(self):
        self.c, self.main = fresh_client()
        r = self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
        assert r.status_code == 200, r.text

    def test_login_required(self):
        anon = TestClient(self.main.app)
        r = anon.post("/api/transcribe", content=wav_bytes(),
                      headers={"Content-Type": "audio/wav"})
        self.assertEqual(r.status_code, 401)

    def test_transcribe_ok_and_stateless(self):
        r = self.c.post("/api/transcribe", content=wav_bytes(2.0),
                        headers={"Content-Type": "audio/wav"})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["text"], "oat milk, eggs")
        self.assertEqual(body["model"], "muse-voice-transcribe-1.0")
        self.assertFalse(body["demo"])
        # nothing filed anywhere: the transcript is the only product
        self.assertEqual(self.c.get("/api/quest/receipts").json()["receipts"], [])
        self.assertEqual(self.c.get("/api/review").json()["lines"], [])

    def test_rejects_wrong_type_and_bad_wav(self):
        r = self.c.post("/api/transcribe", content=b"x",
                        headers={"Content-Type": "text/plain"})
        self.assertEqual(r.status_code, 415)
        r = self.c.post("/api/transcribe", content=b"junk",
                        headers={"Content-Type": "audio/wav"})
        self.assertEqual(r.status_code, 422)
        r = self.c.post("/api/transcribe", content=b"",
                        headers={"Content-Type": "audio/wav"})
        self.assertEqual(r.status_code, 400)

    def test_missing_key_is_503(self):
        saved = os.environ.get("MODEL_API_KEY")
        os.environ["MODEL_API_KEY"] = ""
        try:
            r = self.c.post("/api/transcribe", content=wav_bytes(),
                            headers={"Content-Type": "audio/wav"})
            self.assertEqual(r.status_code, 503)
        finally:
            os.environ["MODEL_API_KEY"] = saved or ""


class TestDemoDoors(unittest.TestCase):
    def setUp(self):
        self.c, self.main = fresh_client()
        r = self.c.post("/auth/demo")
        assert r.status_code == 200, r.text

    def _disk(self):
        out = {}
        for root, _dirs, files in os.walk(os.environ["ARYA_DATA_DIR"]):
            for f in files:
                if f in ("sessions.json", "cost-ledger.jsonl"):
                    continue
                with open(os.path.join(root, f), "rb") as fh:
                    out[os.path.join(root, f)] = fh.read()
        return out

    def test_demo_photo_files_into_the_sandbox_only(self):
        before = self._disk()
        r = self.c.post("/decode/photo", content=b"\xff\xd8\xff fake",
                        headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["demo"])
        self.assertEqual(body["added"], 1)
        self.assertEqual(body["receipt"]["merchant"], "Safeway")
        self.assertEqual(len(body["receipt"]["lines"]), 1)
        # the visitor sees it (a hunt can finish on it); disk did not change
        ids = [x["receipt_id"] for x in self.c.get("/api/quest/receipts").json()["receipts"]]
        self.assertIn(body["receipt"]["receipt_id"], ids)
        self.assertEqual(self._disk(), before)

    def test_demo_transcribe_works(self):
        r = self.c.post("/api/transcribe", content=wav_bytes(),
                        headers={"Content-Type": "audio/wav"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["text"], "oat milk, eggs")
        self.assertTrue(r.json()["demo"])

    def test_demo_list_photo_adds_to_the_sandbox_only(self):
        before = self._disk()
        one_list(self.c)        # every item on a list: the demo visitor makes one
        r = self.c.post("/api/list/from-photo", content=b"\xff\xd8\xff fake",
                        headers={"Content-Type": "image/jpeg"})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertTrue(body["demo"])
        self.assertEqual(body["kind"], "list")
        self.assertEqual(body["names"], ["oat milk", "eggs"])
        self.assertEqual(body["added"], 2)
        home = self.c.get("/api/home").json()
        names = [i["name"].lower() for i in home["list"]["items"]]
        self.assertIn("oat milk", names)
        self.assertEqual(self._disk(), before)

    def test_demo_batch_doors_stay_closed(self):
        self.assertEqual(self.c.post("/decode/pdf", content=b"x").status_code, 403)
        self.assertEqual(self.c.post("/api/intake/order-text",
                                     json={"text": "x" * 30}).status_code, 403)
        self.assertEqual(self.c.post("/eyes/photo", content=b"\xff\xd8",
                                     headers={"Content-Type": "image/jpeg"}).status_code, 403)
        # typing and the cart work in the sandbox
        one_list(self.c)
        self.assertEqual(self.c.post("/api/list/add", json={"name": "milk"}).status_code, 200)
        self.assertEqual(self.c.post("/api/list/from-text",
                                     json={"text": "milk, eggs"}).status_code, 200)

if __name__ == "__main__":
    unittest.main()
