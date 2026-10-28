"""The Postgres seam: json mode untouched, dual mirrors, pg reads/writes
the database, demo and file-only names always use files. A dict stands in
for the database."""
import os, tempfile, unittest
from unittest import mock

from api import auth, pgstore, state


class FakePg:
    def __init__(self):
        self.rows = {}

    def read(self, owner, name):
        return self.rows.get((owner, name), pgstore._MISSING)

    def write(self, owner, name, obj):
        self.rows[(owner, name)] = obj


class SeamTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.fake = FakePg()
        for target, fn in (("read", self.fake.read), ("write", self.fake.write)):
            p = mock.patch.object(pgstore, target, fn)
            p.start()
            self.addCleanup(p.stop)
        env = mock.patch.dict(os.environ, {"ARYA_DATA_DIR": self.tmp.name})
        env.start()
        self.addCleanup(env.stop)
        self.addCleanup(state.set_current_user, None)
        state.set_current_user("ann")

    def mode(self, m):
        p = mock.patch.dict(os.environ, {"ARYA_STORE": m})
        p.start()
        self.addCleanup(p.stop)

    def test_json_mode_never_touches_pg(self):
        self.mode("json")
        state._save("flags.json", {"a": 1})
        self.assertEqual(state._load("flags.json", {}), {"a": 1})
        self.assertEqual(self.fake.rows, {})

    def test_dual_writes_file_and_mirror_reads_file(self):
        self.mode("dual")
        state._save("flags.json", {"a": 1})
        self.assertEqual(self.fake.rows[("ann", "flags.json")], {"a": 1})
        self.fake.rows[("ann", "flags.json")] = {"stale": True}
        self.assertEqual(state._load("flags.json", {}), {"a": 1})

    def test_dual_mirror_failure_does_not_break_save(self):
        self.mode("dual")
        with mock.patch.object(pgstore, "write", side_effect=RuntimeError("down")):
            state._save("flags.json", {"a": 1})
        self.assertEqual(state._load("flags.json", {}), {"a": 1})

    def test_pg_mode_uses_db_not_files(self):
        self.mode("pg")
        state._save("flags.json", {"a": 2})
        self.assertEqual(self.fake.rows[("ann", "flags.json")], {"a": 2})
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "users", "ann", "flags.json")))
        self.assertEqual(state._load("flags.json", {}), {"a": 2})
        self.assertEqual(state._load("cart.json", "dflt"), "dflt")

    def test_demo_and_file_only_names_stay_on_files(self):
        self.mode("pg")
        state.set_current_user("demo")
        state._save("flags.json", {"d": 1})
        state.set_current_user("ann")
        state._save("shelf_matches.json", {"x": 1})
        self.assertEqual(self.fake.rows, {})

    def test_auth_root_plane_in_pg_mode(self):
        self.mode("pg")
        state.set_current_user(None)
        auth.create_user("bob", "pw-123456")
        self.assertIn(("", "users.json"), self.fake.rows)
        self.assertTrue(auth.verify("bob", "pw-123456"))


if __name__ == "__main__":
    unittest.main()
