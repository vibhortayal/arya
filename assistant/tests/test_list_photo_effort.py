"""List photo read at minimal reasoning effort (owner, 2026-11-04:
"Speed: list photo read uses minimal reasoning effort"). If the API
refuses "minimal", the call repeats once at "low" so the read lands.
Ops' site-wide effort setting still moves every other Spark call."""
import os
import tempfile
import unittest
from unittest import mock

from api.meta_client import MetaClient

OK = {"choices": [{"message": {"content": '{"kind": "list", "items": ["Milk"]}'}}], "usage": {}}


class TestListPhotoEffort(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()

    def client(self, bodies, refuse=False):
        def t(method, url, headers, body):
            bodies.append(dict(body))
            if refuse and body.get("reasoning_effort") == "minimal":
                return 400, {"error": {"message": "invalid reasoning_effort: minimal"}}
            return 200, OK
        return MetaClient(api_key="k", transport=t)

    def test_the_list_photo_asks_for_minimal(self):
        from api.list.intake import read_list_photo
        bodies = []
        out = read_list_photo(b"jpeg", self.client(bodies))
        self.assertEqual(out["items"], ["Milk"])
        self.assertEqual([b["reasoning_effort"] for b in bodies], ["minimal"])

    def test_a_refused_minimal_repeats_once_at_low(self):
        from api.list.intake import read_list_photo
        bodies = []
        out = read_list_photo(b"jpeg", self.client(bodies, refuse=True))
        self.assertEqual(out["items"], ["Milk"])
        self.assertEqual([b["reasoning_effort"] for b in bodies], ["minimal", "low"])

    def test_ops_setting_moves_other_calls_not_minimal(self):
        from api import site_flags
        bodies = []
        c = self.client(bodies)
        with mock.patch.object(site_flags, "reasoning_effort", return_value="high"):
            c.chat([], reasoning_effort="minimal")
            c.chat([])
        self.assertEqual([b["reasoning_effort"] for b in bodies], ["minimal", "high"])


if __name__ == "__main__":
    unittest.main()
