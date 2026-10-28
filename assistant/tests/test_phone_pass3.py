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


class TestListComposerSmarts(unittest.TestCase):
    def test_server_split_understands_dictation(self):
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from api.list.intake import split_list_text
        self.assertEqual(
            split_list_text("I need some eggs, eggs, bananas, cookies, oranges."),
            ["eggs", "bananas", "cookies", "oranges"])
        self.assertEqual(split_list_text("eggs and bananas and milk"),
                         ["eggs", "bananas", "milk"])
        self.assertEqual(split_list_text("mac and cheese"), ["mac and cheese"])
        self.assertEqual(split_list_text("salt and pepper"), ["salt and pepper"])

    def test_client_preview_mirrors(self):
        a = read("app.js")
        for needle in ("ADD_LEAD", "i need some ", "sentence",
                       "mac and cheese"):
            self.assertIn(needle, a)
