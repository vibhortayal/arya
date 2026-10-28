"""Phone pass 3 (owner's phone, 2026-10-28): dictation becomes a
list that asks before it joins; the Add button is the submit the
box never had; a started quest can be ended."""
import unittest
from pathlib import Path

PWA = Path(__file__).resolve().parent.parent / "pwa"


def read(name):
    return (PWA / name).read_text()


class TestVoiceToList(unittest.TestCase):
    def test_sentence_parser_and_confirm_flow(self):
        q = read("quest.js")
        for needle in ("function qParseText", "function qShowTextConfirm",
                       "Looks right? Tap an item to drop it.",
                       "Add ${items.length} item",
                       'post("/api/list/add", { name: it.name })'):
            self.assertIn(needle, q)
        # voice lands in the confirm flow, not just the raw box
        self.assertIn("qShowTextConfirm();\n});", q)
        # the plan count and Start read the sentence parser
        self.assertIn("qParseText($(\"#nl-text\").value)", q)

    def test_add_button_and_confirm_strip_exist(self):
        html = read("index.html")
        for needle in ('id="nl-add"', 'id="nl-confirm"', 'id="btn-abandon"'):
            self.assertIn(needle, html)


class TestAbandonQuest(unittest.TestCase):
    def test_abandon_wiring(self):
        q = read("quest.js")
        for needle in ('qSetState(sess, "abandoned")',
                       "End this quest? It leaves Today and cannot be resumed.",
                       '"abandoned"'):
            self.assertIn(needle, q)
