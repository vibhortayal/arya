"""Ask Arya in the user's language (owner, 2026-10-29;
docs/MULTILINGUAL-ASK.md): the REPLY LANGUAGE line, the language
setting, localized code lines, non-Latin item ids, and the server-side
add-box gate."""
import json, os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
from fastapi.testclient import TestClient  # noqa: E402

from api.list.intake import has_non_latin, item_slug  # noqa: E402


class Spy:
    """Records every chat call and answers with a fixed JSON body."""
    calls = []
    answer = {"reply": "ok", "actions": [], "items": []}

    def __init__(self, *a, **k):
        pass

    def chat(self, messages, mode="standard", personal=False, **k):
        Spy.calls.append(messages)
        return json.dumps(Spy.answer), {}, 0.0


class TestHelpers(unittest.TestCase):
    def test_slug_keeps_ascii_ids_and_non_latin_letters(self):
        self.assertEqual(item_slug("Oat Milk!"), "oat-milk")
        self.assertEqual(item_slug("दूध"), "दूध")
        self.assertNotEqual(item_slug("दूध"), item_slug("चावल"))

    def test_non_latin_detection(self):
        self.assertTrue(has_non_latin("दूध जोड़ो"))
        self.assertFalse(has_non_latin("agrega leche ¿qué?"))


class TestMultilingual(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import main, deps
        deps.MetaClient = Spy
        deps._login_fails.clear()
        Spy.calls = []
        Spy.answer = {"reply": "ok", "actions": [], "items": []}
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "t@x.y", "password": "long-password"})
        assert r.status_code == 200, r.text

    def ask(self, text="hi"):
        Spy.calls = []
        self.c.post("/api/chat", json={"messages": [{"role": "user", "content": text}]})
        return [m["content"] for m in Spy.calls[-1]]

    def test_setting_default_set_and_reject(self):
        self.assertEqual(self.c.get("/api/settings").json()["language"], "auto")
        r = self.c.post("/api/settings", json={"language": "ES"})
        self.assertEqual((r.status_code, r.json()["language"]), (200, "es"))
        self.assertEqual(r.json()["currency"], "USD")
        self.assertEqual(self.c.post("/api/settings", json={"language": "xx"}).status_code, 400)
        self.assertEqual(self.c.post("/api/settings", json={}).status_code, 400)

    def test_reply_language_line_only_when_fixed(self):
        self.assertFalse(any(m.startswith("REPLY LANGUAGE") for m in self.ask()))
        self.c.post("/api/settings", json={"language": "es"})
        self.assertIn("REPLY LANGUAGE: Spanish (es)", self.ask())
        self.c.post("/api/settings", json={"language": "hi"})
        self.assertIn("REPLY LANGUAGE: Hindi (hi)", self.ask())
        self.c.post("/api/settings", json={"language": "auto"})
        self.assertFalse(any(m.startswith("REPLY LANGUAGE") for m in self.ask()))

    def test_prompt_pins_language_rules_and_currency(self):
        from api import chat_service
        text = open(chat_service.PROMPT_PATH, encoding="utf-8").read()
        self.assertIn("Reply in the language the user wrote in", text)
        self.assertIn("REPLY LANGUAGE", text)
        self.assertNotIn("US dollars", text)

    def test_snapshot_currency_follows_setting(self):
        def currency():
            snap = next(m for m in self.ask() if m.startswith("HOUSEHOLD SNAPSHOT"))
            return json.loads(snap.split("\n", 1)[1])["currency"]
        self.assertEqual(currency(), "USD ($)")
        self.c.post("/api/settings", json={"currency": "INR"})
        self.assertEqual(currency(), "INR (₹)")

    def test_risky_text_localizes(self):
        from unittest import mock
        from api import chat_service, state
        for patch in (mock.patch.object(chat_service, "_resolve", lambda n: "a1"),
                      mock.patch.object(state, "names", lambda: {"a1": "Almonds"})):
            patch.start()
            self.addCleanup(patch.stop)
        Spy.answer = {"reply": "ok", "actions": [{"type": "snooze", "item": "Almonds", "days": 7}]}

        def proposed():
            r = self.c.post("/api/chat", json={"surface": "list", "context": {},
                                               "messages": [{"role": "user", "content": "x"}]}).json()
            return r["proposed"][0]["text"]
        self.assertEqual(proposed(), "Snooze Almonds for 7 days?")
        self.c.post("/api/settings", json={"language": "es"})
        self.assertEqual(proposed(), "¿Posponer Almonds 7 días?")
        self.c.post("/api/settings", json={"language": "hi"})
        self.assertIn("टालें", proposed())

    def test_non_latin_item_gets_its_own_row(self):
        Spy.answer = {"reply": "ठीक है", "actions": [
            {"type": "add_to_list", "item": "दूध"},
            {"type": "add_to_list", "item": "चावल"}]}
        r = self.c.post("/api/chat", json={"messages": [{"role": "user", "content": "दूध और चावल जोड़ो"}]}).json()
        self.assertEqual(len(r["applied"]), 2)
        names = [i["name"] for i in self.c.get("/api/home").json()["list"]["items"]]
        self.assertIn("दूध", names)
        self.assertIn("चावल", names)

    def test_add_box_gate(self):
        # English on auto: the $0 split, no model call.
        Spy.calls = []
        self.c.post("/api/list/from-text", json={"text": "milk, eggs"})
        self.assertEqual(Spy.calls, [])
        # Non-Latin script: one model call extracts the items.
        Spy.answer = {"items": ["दूध"]}
        r = self.c.post("/api/list/from-text", json={"text": "दूध जोड़ो"}).json()
        self.assertEqual((len(Spy.calls), r["names"], r["source"]), (1, ["दूध"], "model"))
        # A fixed non-English language: Latin script goes to the model too.
        self.c.post("/api/settings", json={"language": "es"})
        Spy.calls, Spy.answer = [], {"items": ["leche"]}
        r = self.c.post("/api/list/from-text", json={"text": "agrega leche"}).json()
        self.assertEqual((len(Spy.calls), r["names"]), (1, ["leche"]))


class TestVoiceHint(unittest.TestCase):
    def test_hint_sent_only_when_given_and_retried_without_on_refusal(self):
        from api.voice.service import transcribe_audio
        from tests.test_intake_parity import wav_bytes

        class C:
            def __init__(self, fail):
                self.fail, self.langs = fail, []

            def transcribe(self, wav, duration, language=None):
                self.langs.append(language)
                if language and self.fail:
                    raise RuntimeError("Meta API HTTP 400")
                return {"text": "hola"}, 0.0
        c = C(False)
        transcribe_audio(wav_bytes(), c)
        self.assertEqual(c.langs, [None])
        c = C(False)
        transcribe_audio(wav_bytes(), c, "Spanish")
        self.assertEqual(c.langs, ["Spanish"])
        c = C(True)
        self.assertEqual(transcribe_audio(wav_bytes(), c, "Hindi")["text"], "hola")
        self.assertEqual(c.langs, ["Hindi", None])


if __name__ == "__main__":
    unittest.main()
