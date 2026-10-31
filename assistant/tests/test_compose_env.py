"""Every switch the app reads must reach the api container. Compose
passes only the variables it lists (there is no env_file), so a
setting written in deploy/.env but missing here silently does nothing
(codebase map 2026-10-29)."""
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
# Set by compose itself, or only by tests.
NOT_FROM_ENV_FILE = {"ARYA_DATA_DIR", "ARYA_INSECURE_COOKIE", "ARYA_SCAN_JOBS_INLINE"}


def read_by_code():
    names = set()
    pat = re.compile(r"os\.(?:environ\.get|getenv)\(\s*[\"']([A-Z_]+)[\"']"
                     r"|os\.environ\[[\"']([A-Z_]+)[\"']\]")
    for base, _dirs, files in os.walk(os.path.join(ROOT, "api")):
        for f in files:
            if f.endswith(".py"):
                with open(os.path.join(base, f), encoding="utf-8") as fh:
                    for m in pat.finditer(fh.read()):
                        names.add(m.group(1) or m.group(2))
    return names - NOT_FROM_ENV_FILE


def passed_by_compose():
    with open(os.path.join(ROOT, "deploy", "docker-compose.yml"), encoding="utf-8") as fh:
        text = fh.read()
    api = text.split("\n  api:\n", 1)[1].split("\n  caddy:\n", 1)[0]
    return set(re.findall(r"^\s+([A-Z_]+):", api, re.M))


class TestComposeEnv(unittest.TestCase):
    def test_every_app_setting_is_passed_to_the_container(self):
        missing = sorted(read_by_code() - passed_by_compose())
        self.assertEqual(missing, [], "add these to the api environment in "
                         "deploy/docker-compose.yml")

    def test_numeric_defaults_parse(self):
        # An empty ${VAR:-} would crash float()/int() in the app.
        with open(os.path.join(ROOT, "deploy", "docker-compose.yml"), encoding="utf-8") as fh:
            text = fh.read()
        for name in ("ARYA_DAILY_BUDGET_USD", "ARYA_DEMO_DAILY_BUDGET_USD",
                     "ARYA_DEMO_SESSION_BUDGET_USD", "ARYA_FEEDBACK_DAILY_CAP"):
            default = re.search(name + r": \$\{" + name + r":-([^}]*)\}", text).group(1)
            float(default)


if __name__ == "__main__":
    unittest.main()
