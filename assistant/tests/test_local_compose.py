"""The laptop setup (compose.yaml at the repo root, owner 2026-11-02):
it must stay separate from the live deploy and need only a Meta key."""
import os, re, unittest

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")


def read(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as fh:
        return fh.read()


class LocalCompose(unittest.TestCase):
    def test_no_vm_folders_no_caddy_and_seeds_the_demo(self):
        c = read("compose.yaml")
        self.assertNotIn("/home/ubuntu", c)
        self.assertNotIn("caddy", c.lower().split("services:", 1)[1])
        self.assertIn("harness.make_demo_household /app/data", c)
        self.assertIn("healthcheck:", c)
        self.assertIn('"${ARYA_LOCAL_PORT:-8080}:8000"', c)
        self.assertIn('ARYA_INSECURE_COOKIE: "1"', c)

    def test_judge_defaults_town_on_signup_open_no_supabase(self):
        # Owner, 2026-11-02: plain username and password locally (no
        # waitlist, no Google), and the Demo Town neighbourhood as seed.
        c = read("compose.yaml")
        self.assertIn("ARYA_DEMO_TOWN: ${ARYA_DEMO_TOWN:-1}", c)
        self.assertIn("ARYA_REGISTRATION_OPEN: ${ARYA_REGISTRATION_OPEN:-1}", c)
        self.assertIn('ARYA_SUPABASE_AUTH: "0"', c)
        self.assertIn("ARYA_GROUPS: ${ARYA_GROUPS:-1}", c)
        for live_only in ("SUPABASE_URL", "GOOGLE_OAUTH", "RESEND_API_KEY", "ARYA_KEY_VAULT_SECRET"):
            self.assertNotIn(live_only, c)

    def test_env_example_needs_only_the_meta_key(self):
        e = read(".env.local.example")
        keys = dict(re.findall(r"^([A-Z_]+)=(.*)$", e, re.M))
        self.assertEqual(keys["MODEL_API_KEY"], "")
        self.assertEqual(keys["ARYA_STORE"], "json")
        self.assertLessEqual(len(keys), 7)
        self.assertNotIn("train", e.lower())

    def test_live_compose_is_untouched_by_the_local_one(self):
        live = read("assistant/deploy/docker-compose.yml")
        self.assertNotIn("ARYA_INSECURE_COOKIE", live)
        self.assertIn("caddy:", live)


if __name__ == "__main__":
    unittest.main()
