import unittest

from api.list.intake import skipped_pieces, split_list_items


class SkippedPiecesTest(unittest.TestCase):
    def test_number_and_punctuation_are_reported(self):
        text = "eggs x 2, bananas, 12345, ???, bread"
        self.assertEqual([n for n, _ in split_list_items(text)],
                         ["eggs", "bananas", "bread"])
        self.assertEqual(skipped_pieces(text), ["12345", "???"])

    def test_empty_pieces_are_not_reported(self):
        self.assertEqual(skipped_pieces("milk, , eggs,"), [])


if __name__ == "__main__":
    unittest.main()
