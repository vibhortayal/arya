"""The API image must carry every folder the api package reads at run
time. Demo Town's pack lived in demo_town/, which the image did not copy,
so /api/town/hints answered 500 in production once the flag was on."""
import os, re, unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
RUNTIME_DIRS = ("demo_town", "prompts", "pwa", "harness", "golden")


class TestApiImage(unittest.TestCase):
    def test_image_copies_the_folders_the_api_reads(self):
        text = open(os.path.join(ROOT, "deploy", "Dockerfile.api")).read()
        copied = set(re.findall(r"^COPY (?!--from)(\S+) \./\1\s*$", text, re.M))
        for d in RUNTIME_DIRS:
            self.assertIn(d, copied, f"Dockerfile.api does not COPY {d}")

    def test_api_references_only_folders_the_image_has(self):
        text = open(os.path.join(ROOT, "deploy", "Dockerfile.api")).read()
        copied = set(re.findall(r"^COPY (?:--from=\S+ )?\S+ \./(\S+?)/?\s*$", text, re.M))
        found = set()
        for dirpath, _d, files in os.walk(os.path.join(ROOT, "api")):
            for f in files:
                if f.endswith(".py"):
                    src = open(os.path.join(dirpath, f)).read()
                    found |= set(re.findall(r'"\.\.", "([a-z_]+)"', src))
        found -= {"data"}          # the data volume, not part of the image
        for d in found:
            self.assertTrue(any(c == d or c.startswith(d + "/") for c in copied),
                            f"api reads ../{d} but the image does not copy it")


if __name__ == "__main__":
    unittest.main()
