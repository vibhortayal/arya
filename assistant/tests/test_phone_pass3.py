"""Phone pass 3 (owner's phone, 2026-10-28): dictation becomes a
list that asks before it joins; the Add button is the submit the
box never had; a started quest can be ended.

Client pins read the React screens (web/src); the split behaviour runs
under vitest in web/src/screens/dictation.test.ts."""
import unittest
from pathlib import Path

from tests.frontend import src


class TestVoiceToList(unittest.TestCase):
    def test_sentence_parser_feeds_the_bag(self):
        nl = src("screens/NewList.tsx")
        # The "Looks right?" strip gave way to the Pack bag: dictation
        # becomes bag rows (each can be taken out or put back).
        self.assertIn("function parseText(text: string): Line[]", nl)
        self.assertNotIn("ShowTextConfirm", nl)
        # the bag splits a sentence the same way
        self.assertIn("return parseText(l).map(", nl)
        self.assertIn("const addFromText = (txt: string, src?: string) => {", nl)

    def test_add_button_and_helper_slot_exist(self):
        nl = src("screens/NewList.tsx")
        for needle in ('id="nl-add"', 'id="nl-helper"'):
            self.assertIn(needle, nl)
        self.assertIn('id="btn-abandon"', src("screens/Hunt.tsx"))


class TestAbandonQuest(unittest.TestCase):
    def test_abandon_wiring(self):
        hunt = src("screens/Hunt.tsx")
        for needle in ('qSetState(s, "abandoned")',
                       "End this quest? It leaves Quest and cannot be resumed."):
            self.assertIn(needle, hunt)
        self.assertIn('{ state: "abandoned" }', src("screens/Quest.tsx"))


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
        a = src("screens/Lists.tsx")
        for needle in ("ADD_LEAD", "i need some ", "sentence", "export function splitPreview("):
            self.assertIn(needle, a)
        t = src("screens/dictation.test.ts")
        for needle in ("I need some eggs, eggs, bananas, cookies, oranges.", "mac and cheese",
                       "Oh, I need some eggs, potatoes, tomatoes, tomatoes, onions."):
            self.assertIn(needle, t)

    def test_second_dictation_with_filler_word(self):
        # Owner's phone, 2026-10-28: "Oh, I need some eggs, ..." made
        # an "Oh" item and kept "I need some eggs" whole.
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from api.list.intake import split_list_text
        self.assertEqual(
            split_list_text("Oh, I need some eggs, potatoes, tomatoes, tomatoes, onions."),
            ["eggs", "potatoes", "tomatoes", "onions"])
        q = src("screens/NewList.tsx")
        self.assertIn("FILL", q)
        self.assertIn("oh|okay|ok|so|well|um|uh|hmm", q)
        a = src("screens/Lists.tsx")
        self.assertIn("oh|okay|ok|so|well|um|uh|hmm", a)
