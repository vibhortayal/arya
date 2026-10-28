"""Store durability — review 2026-10-28, H2.

The JSON store writes atomically (temp file + os.replace) and
serializes load-modify-save cycles per file. These tests run real
parallel cycles: the pre-fix store (truncate-in-place, no lock)
loses updates and can hand a reader a half-written file.
"""
import os, tempfile, threading, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()


def _run_parallel(n, fn):
    errors = []

    def wrap(i):
        try:
            fn(i)
        except Exception as e:  # collected, then asserted empty
            errors.append(e)

    threads = [threading.Thread(target=wrap, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


class TestAtomicStore(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import state
        self.state = state

    def test_parallel_set_flag_loses_nothing(self):
        state = self.state
        errors = _run_parallel(8, lambda t: [
            state.set_flag(f"item-{t}-{i}", {"manual": True})
            for i in range(25)])
        self.assertEqual(errors, [])
        flags = state.flags()
        self.assertEqual(len(flags), 200)
        self.assertTrue(all(v == {"manual": True} for v in flags.values()))

    def test_parallel_check_item_loses_nothing(self):
        from api import quest
        sess = quest.create_session(
            "Corner Shop", "quest",
            [{"name": f"Item {i}"} for i in range(20)])
        errors = _run_parallel(
            20, lambda i: quest.check_item(sess["id"], f"Item {i}", True))
        self.assertEqual(errors, [])
        after = quest.get_session(sess["id"])
        self.assertTrue(all(it["checked"] for it in after["items"]))

    def test_reader_never_sees_a_partial_file(self):
        state = self.state
        big = [{"receipt_id": f"r-{i}", "purchased_at": "2026-10-01",
                "lines": [{"raw": "x" * 40}] * 20} for i in range(300)]
        stop = threading.Event()
        read_errors = []

        def writer():
            for _ in range(30):
                state._save("receipts.json", big)
            stop.set()

        def reader():
            while not stop.is_set():
                try:
                    state._load("receipts.json", [])
                except Exception as e:
                    read_errors.append(e)

        w = threading.Thread(target=writer)
        r = threading.Thread(target=reader)
        w.start()
        r.start()
        w.join()
        r.join()
        self.assertEqual(read_errors, [])
        self.assertEqual(len(state.receipts()), 300)

    def test_no_temp_files_left_behind(self):
        self.state.set_flag("a", {"manual": True})
        leftovers = [n for n in os.listdir(os.environ["ARYA_DATA_DIR"])
                     if n.startswith(".tmp-")]
        self.assertEqual(leftovers, [])


class TestAuthStoreConcurrency(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import auth
        self.auth = auth

    def test_parallel_new_session_loses_nothing(self):
        auth = self.auth
        pairs = []
        errors = _run_parallel(
            10, lambda i: pairs.append((i, auth.new_session(f"user-{i}"))))
        self.assertEqual(errors, [])
        self.assertEqual(len({tok for _, tok in pairs}), 10)
        for i, tok in pairs:
            self.assertEqual(auth.session_user(tok), f"user-{i}")
        self.assertEqual(len(auth._load("sessions.json", {})), 10)


if __name__ == "__main__":
    unittest.main()
