"""Raw Meta API text never reaches the app (owner, 2026-11-01): the
avatar "Make" flow showed "Meta API HTTP 400 ... content_policy_violation"."""
import json, logging, os, unittest
from unittest import mock

os.environ.setdefault("MODEL_API_KEY", "test-key")
from api import meta_client
from api.errors import GENERIC, safe_detail


class Transport:
    def __init__(self, status, payload):
        self.status, self.payload = status, payload

    def __call__(self, *a, **k):
        return self.status, self.payload


def client(status, payload):
    c = meta_client.MetaClient(api_key="k")
    c._send = lambda *a, **k: (status, payload)
    c._send_multipart = lambda *a, **k: (status, payload)
    return c


POLICY = {"error": {"message": "Your request was rejected", "code": "content_policy_violation"}}


class ModelErrors(unittest.TestCase):
    def test_image_refusal_is_plain_and_raw_goes_to_log(self):
        with self.assertLogs("arya.meta", logging.WARNING) as logs:
            with self.assertRaises(meta_client.ModelError) as cm:
                client(400, POLICY).generate_image("Game of thrones Arya")
        msg = str(cm.exception)
        self.assertIn("couldn't draw that", msg)
        self.assertNotIn("HTTP", msg)
        self.assertNotIn("content_policy", msg)
        self.assertIn("content_policy_violation", "".join(logs.output))
        self.assertEqual(cm.exception.status, 400)

    def test_text_busy_and_down(self):
        for status, word in ((429, "busy"), (503, "trouble"), (401, "couldn't get an answer")):
            with self.assertRaises(meta_client.ModelError) as cm:
                client(status, {"error": "x"}).chat([{"role": "user", "content": "hi"}])
            self.assertIn(word, str(cm.exception))
            self.assertNotIn("HTTP", str(cm.exception))

    def test_still_a_runtime_error(self):
        self.assertTrue(issubclass(meta_client.ModelError, RuntimeError))


class SafeDetail(unittest.TestCase):
    def test_raw_text_hidden_plain_kept(self):
        self.assertEqual(safe_detail(RuntimeError("Meta API HTTP 400: {'error': 'x'}")), GENERIC)
        self.assertEqual(safe_detail(RuntimeError("Google Places unreachable: <urlopen error>")), GENERIC)
        self.assertEqual(safe_detail(RuntimeError("the model's answer could not be read, try again")),
                         "the model's answer could not be read, try again")
        e = meta_client.model_error(400, POLICY, "image")
        self.assertEqual(safe_detail(e), str(e))


class AvatarRoute(unittest.TestCase):
    def test_avatar_make_shows_plain_words(self):
        import tempfile
        os.environ["ARYA_INSECURE_COOKIE"] = "1"
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        from api import main, deps
        c = TestClient(main.app)
        self.assertEqual(c.post("/auth/setup", json={"username": "o@x.y", "password": "long-password"}).status_code, 200)
        bad = mock.Mock(side_effect=meta_client.model_error(400, POLICY, "image"))
        with mock.patch.object(deps, "new_client", return_value=mock.Mock(generate_image=bad, edit_image=bad, chat=bad)):
            from api.routes import avatar
            with mock.patch.object(avatar, "new_client", return_value=mock.Mock(generate_image=bad, edit_image=bad, chat=bad), create=True):
                r = c.post("/api/quest/avatar/generate", json={"prompt": "Game of thrones Arya"})
        self.assertEqual(r.status_code, 502, r.text)
        self.assertIn("couldn't draw that", r.json()["detail"])
        self.assertNotIn("content_policy", r.json()["detail"])


if __name__ == "__main__":
    unittest.main()
