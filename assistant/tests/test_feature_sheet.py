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
        from tests import frontend
        tabs = frontend.src("App.tsx").split("const TAB_LABEL", 1)[1].split("};", 1)[0]
        labels = re.findall(r':\s*"([^"]+)"', tabs)
        first = raw().splitlines()[0]
        for t in re.findall(r"\b(Today|Lists|Ask|Quest|Help|Settings)\b", first):
            self.assertIn(t, labels)
        self.assertEqual(len(labels), 6)
        self.assertIn('id="pf-reminders"', frontend.src("screens/Profile.tsx"))

    def test_sizes(self):
        flags = {k: True for k in KNOWN_FLAGS}
        self.assertLess(len(chat_service.feature_sheet(flags)), 9500)
        # A data question gets the overview only; a topic gets its section.
        base = chat_service.feature_sheet(flags, question="how much was milk at Costco?")
        self.assertLess(len(base), 900)
        self.assertNotIn("Use soon:", base)

    def test_topic_match(self):
        flags = {k: False for k in KNOWN_FLAGS}
        f = lambda q: chat_service.feature_sheet(flags, question=q)
        self.assertIn("Map my store: open the Quest tab", f("how do I map my store?"))
        self.assertIn("Start a group", f("how do I share my list with my wife"))
        self.assertIn("Help tab: tap Help", f("where is the help tab"))
        self.assertIn("tap Edit on Today", f("can I move the cards around"))
        self.assertIn("Receipts: open Today", f("where do I add a receipt"))
        # no topic words but a general ask: everything
        self.assertIn("Use soon:", f("what can you do?"))
        self.assertIn("Receipts: open Today", f("what can you do?"))

    def test_other_languages_get_every_topic(self):
        seen = {}

        class C:
            def chat(self, messages, **kw):
                seen["sheet"] = next(m["content"] for m in messages if m["content"].startswith("ABOUT ARYA:"))
                return '{"reply":"ok","actions":[]}', 0, 0
        chat_service.chat([{"role": "user", "content": "¿Cómo comparto mi lista?"}], C())
        self.assertIn("Start a group", seen["sheet"])
        self.assertIn("Receipts: open Today", seen["sheet"])
        chat_service.chat([{"role": "user", "content": "how much was milk?"}], C())
        self.assertNotIn("Start a group", seen["sheet"])

    def test_follow_up_keeps_topic(self):
        h = [{"role": "user", "content": "how do I add a receipt?"}, {"role": "assistant", "content": "x"},
             {"role": "user", "content": "and then?"}]
        self.assertIn("receipt", chat_service._asked(h))

    def test_every_section_has_keywords(self):
        _h, secs = chat_service._sections(raw())
        self.assertGreaterEqual(len(secs), 10)
        for title, kws, lines in secs:
            self.assertTrue(kws and lines, title)

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
