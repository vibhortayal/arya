"""The list photo read asks for minimal reasoning (a speed fix, 2026-11-03);
other reads keep their own effort."""
import json
import unittest

from api.list.intake import read_list_photo


class Rec:
    def __init__(self):
        self.kw = None

    def chat(self, messages, mode="standard", personal=False, **k):
        self.kw = dict(k, mode=mode, personal=personal)
        return json.dumps({"kind": "list", "items": ["butter", "rice"]}), {}, 0.0


class TestListPhotoEffort(unittest.TestCase):
    def test_minimal_effort_and_same_items(self):
        c = Rec()
        out = read_list_photo(b"x", c)
        self.assertEqual(c.kw["reasoning_effort"], "minimal")
        self.assertEqual(c.kw["mode"], "standard")
        self.assertTrue(c.kw["personal"])
        self.assertEqual(out, {"kind": "list", "items": ["butter", "rice"]})


if __name__ == "__main__":
    unittest.main()
