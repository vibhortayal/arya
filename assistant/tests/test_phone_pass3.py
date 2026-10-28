"""Phone pass 3 (owner's phone, 2026-10-28): dictation becomes a
list that asks before it joins; the Add button is the submit the
box never had; a started quest can be ended."""
import unittest
from pathlib import Path

PWA = Path(__file__).resolve().parent.parent / "pwa"


def read(name):
    return (PWA / name).read_text()


class TestVoiceToList(unittest.TestCase):
    def test_sentence_parser_feeds_the_bag(self):
        q = read("quest.js")
        # The "Looks right?" strip gave way to the Pack bag: dictation
        # becomes bag rows (each can be taken out or put back).
        self.assertIn("function qParseText", q)
        self.assertNotIn("function qShowTextConfirm", q)
        self.assertIn("qNlAdd();\n});", q)
        # the plan count and Start read the sentence parser
        self.assertIn("qParseText($(\"#nl-text\").value)", q)
        # the bag splits a sentence the same way
        pack = read("pack.js")
        self.assertIn("qParseText(l)", pack)

    def test_add_button_and_helper_slot_exist(self):
        html = read("index.html")
        for needle in ('id="nl-add"', 'id="nl-helper"', 'id="btn-abandon"'):
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

    def test_second_dictation_with_filler_word(self):
        # Owner's phone, 2026-10-28: "Oh, I need some eggs, ..." made
        # an "Oh" item and kept "I need some eggs" whole.
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from api.list.intake import split_list_text
        self.assertEqual(
            split_list_text("Oh, I need some eggs, potatoes, tomatoes, tomatoes, onions."),
            ["eggs", "potatoes", "tomatoes", "onions"])
        q = read("quest.js")
        self.assertIn("FILL", q)
        self.assertIn("oh|okay|ok|so|well|um|uh|hmm", q)
        a = read("app.js")
        self.assertIn("oh|okay|ok|so|well|um|uh|hmm", a)
