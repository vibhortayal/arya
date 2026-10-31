"""Audit H4 (2026-10-30): uploads are read whole before the app checks
their size, so Caddy caps every request body for the app's site. Pins
deploy/Caddyfile."""
import os
import re
import unittest

CADDY = os.path.join(os.path.dirname(__file__), "..", "deploy", "Caddyfile")


class TestCaddyLimits(unittest.TestCase):
    def setUp(self):
        with open(CADDY, encoding="utf-8") as fh:
            text = fh.read()
        self.site = text.split("arya.teamnightshift.org {", 1)[1].split("\n}\n", 1)[0]

    def test_site_caps_request_bodies(self):
        m = re.search(r"request_body\s*\{\s*max_size\s+(\d+)MB\s*\}", self.site)
        self.assertIsNotNone(m, "the app's site block needs a request_body max_size")
        # Above the largest real upload (a 12 MB photo as base64 is about
        # 16 MB), far below what could fill the VM's memory.
        self.assertGreaterEqual(int(m.group(1)), 20)
        self.assertLessEqual(int(m.group(1)), 100)


if __name__ == "__main__":
    unittest.main()
