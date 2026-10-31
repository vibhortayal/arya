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

    def test_images_and_icons_get_a_day_and_three_a_week(self):
        for d in ("assets", "icons"):
            p = os.path.join(main._PWA, d, "x.webp")
            self.assertEqual(main._static_cache_control(p), "public, max-age=86400")
        p = os.path.join(main._PWA, "vendor", "three.module.js")
        self.assertEqual(main._static_cache_control(p), "public, max-age=604800")

    def test_boot_script_is_revalidated_like_the_shell(self):
        # boot.js keeps its name across builds, so it must not be cached
        # by guesswork (audit 2026-10-30).
        import tempfile
        from fastapi.testclient import TestClient
        from starlette.applications import Starlette
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "boot.js"), "w").write("/* */")
            app = Starlette()
            app.mount("/", main._AppFiles(d), name="app")
            self.assertEqual(TestClient(app).get("/boot.js").headers.get("cache-control"), "no-cache")


if __name__ == "__main__":
    unittest.main()
