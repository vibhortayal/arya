import os
import unittest

from api import main


class StaticCacheControl(unittest.TestCase):
    def test_hashed_build_files_are_immutable(self):
        p = os.path.join(main._WEB, "app", "index-abc123.js")
        self.assertIn("immutable", main._static_cache_control(p))

    def test_shell_pieces_outside_the_build_folder_are_untouched(self):
        self.assertIsNone(main._static_cache_control(os.path.join(main._WEB, "index.html")))
        self.assertIsNone(main._static_cache_control(os.path.join(main._PWA, "scene.js")))

    def test_images_icons_and_three_get_an_hour(self):
        for d in ("assets", "icons", "vendor"):
            p = os.path.join(main._PWA, d, "x.webp")
            self.assertEqual(main._static_cache_control(p), "public, max-age=3600")


if __name__ == "__main__":
    unittest.main()
