"""Ask Arya with a photo (owner 2026-10-30): one-shot, never stored,
no price claims from the picture, and a photo answer changes nothing."""
import base64, json, os, shutil, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient

from tests.test_eyes_chat import seed_demo

PIC = base64.b64encode(b"\xff\xd8\xff\xe0fakejpeg").decode()
seen = []


class TestChatPhoto(unittest.TestCase):
    def setUp(self):
        from api import deps
        base = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = base
        seed_demo(base)
        os.makedirs(os.path.join(base, "users"), exist_ok=True)
        shutil.copytree(os.path.join(base, "users", "demo"), os.path.join(base, "users", "owner"))
        import api.main as main

        class FakeClient:
            def __init__(self, ledger=None):
                pass

            def chat(self, messages, mode=None, personal=None, **kw):
                seen.append(messages)
                return json.dumps({"reply": "That is a jar of basil pesto.",
                                   "actions": [{"type": "add_to_list", "item": "Fresh Basil"}]}), {}, 0.01

        deps.MetaClient = FakeClient
        seen.clear()
        self.base = base
        self.c = TestClient(main.app)
        self.c.post("/auth/setup", json={"username": "owner", "password": "pw"})

    def ask(self, image):
        return self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "what is this?"}], "image": image})

    def test_photo_rides_on_the_question_and_changes_nothing(self):
        r = self.ask({"media_type": "image/jpeg", "data": PIC})
        self.assertEqual(r.status_code, 200)
        d = r.json()
        self.assertEqual(d["reply"], "That is a jar of basil pesto.")
        self.assertEqual(d["applied"], [])
        msgs = seen[-1]
        last = next(m for m in reversed(msgs) if isinstance(m["content"], list))
        self.assertEqual(last["content"][0]["text"], "what is this?")
        self.assertTrue(last["content"][1]["image_url"]["url"].startswith("data:image/jpeg;base64,"))
        rules = next(m["content"] for m in msgs if isinstance(m["content"], str) and m["content"].startswith("PHOTO:"))
        self.assertIn("Never say whether a price is good", rules)
        self.assertIn("not saved", rules)

    def test_photo_is_not_stored(self):
        self.ask({"media_type": "image/jpeg", "data": PIC})
        for root, _dirs, files in os.walk(self.base):
            self.assertFalse([f for f in files if f.endswith((".jpg", ".png", ".webp"))
                              and "eyes_photos" in root and "fakejpeg" in open(os.path.join(root, f), "rb").read().decode("latin1")])

    def test_text_only_still_applies_actions(self):
        r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "add basil"}],
                                           # asked from a list: the add goes there (two lists)
                                           "context": {"list": "Trader Joe's", "list_id": "l-demo-tj"}})
        self.assertIn("Fresh Basil", " ".join(r.json()["applied"]))

    def test_bad_images_are_refused(self):
        self.assertEqual(self.ask({"media_type": "application/pdf", "data": PIC}).status_code, 415)
        self.assertEqual(self.ask({"media_type": "image/jpeg", "data": "***"}).status_code, 400)
        self.assertEqual(self.ask({"media_type": "image/jpeg", "data": ""}).status_code, 400)
        self.assertEqual(self.ask({"media_type": "image/jpeg", "data": "A" * 8_000_004}).status_code, 413)
        self.assertEqual(self.ask("not an object").status_code, 415)


if __name__ == "__main__":
    unittest.main()
