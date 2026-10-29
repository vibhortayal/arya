"""Ask Arya's feature sheet must not drift from the app: tabs and
screens it names exist, and flag-gated lines vanish when the flag is off."""
import os
import re
import unittest

from api import chat_service

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
KNOWN_FLAGS = {"push_reminders", "supabase_auth", "registration_open"}


def raw():
    with open(chat_service.FEATURES_PATH, encoding="utf-8") as fh:
        return fh.read()


class FeatureSheet(unittest.TestCase):
    def test_flags_are_known_and_wired(self):
        tags = set(re.findall(r"^\[if (\w+)\]", raw(), re.M))
        self.assertTrue(tags <= KNOWN_FLAGS)
        self.assertEqual(set(chat_service._feature_flags()), KNOWN_FLAGS)

    def test_gated_lines_hidden_when_off(self):
        off = chat_service.feature_sheet({k: False for k in KNOWN_FLAGS})
        self.assertNotIn("Remind me", off)
        self.assertNotIn("[if", off)
        on = chat_service.feature_sheet({k: True for k in KNOWN_FLAGS})
        self.assertIn("Remind me", on)
        self.assertNotIn("[if", on)

    def test_tabs_named_in_sheet_exist_in_app(self):
        html = open(os.path.join(ROOT, "pwa", "index.html"), encoding="utf-8").read()
        nav = html.split('<nav id="tabs"', 1)[1].split("</nav>", 1)[0]
        labels = re.findall(r"<span>([^<]+)</span>", nav)
        first = raw().splitlines()[0]
        for t in re.findall(r"\b(Today|Lists|Ask|Quest)\b", first):
            self.assertIn(t, labels)
        self.assertEqual(len(labels), 4)
        self.assertIn('id="pf-reminders"', html)

    def test_small(self):
        self.assertLess(len(chat_service.feature_sheet({k: True for k in KNOWN_FLAGS})), 2400)

    def test_prompt_gets_sheet(self):
        seen = {}

        class C:
            def chat(self, messages, **kw):
                seen["m"] = messages
                return '{"reply":"ok","actions":[]}', 0, 0
        chat_service.chat([{"role": "user", "content": "what can you do?"}], C())
        self.assertTrue(any(m["content"].startswith("ABOUT ARYA:") for m in seen["m"]))


if __name__ == "__main__":
    unittest.main()
