"""Small UX fixes — review 2026-10-28, U3/U5/U6/U7.

/auth/me answers 200 with user=None when signed out (the boot
probe's normal path, not an error); the Profile tile says what
its number counts ("Hunts finished" — done sessions, per the
verified-only counting rule); token rows wrap; Sign out is a
44 px tap target.
"""
import os, tempfile, unittest

os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
os.environ["ARYA_INSECURE_COOKIE"] = "1"

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def read(name):
    with open(os.path.join(PWA, name), encoding="utf-8") as fh:
        return fh.read()


class TestAuthMe(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        import api.main as main
        main._login_fails.clear()
        self.c = TestClient(main.app)

    def test_signed_out_me_is_200_with_null_user(self):
        r = self.c.get("/auth/me")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"user": None, "demo": False})

    def test_signed_in_me_still_answers_the_user(self):
        self.c.post("/auth/setup", json={"username": "u@x.y",
                                         "password": "pw-test"})
        r = self.c.get("/auth/me")
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["user"], "u@x.y")
        self.assertEqual(r.json()["demo"], False)


class TestSmallUxPins(unittest.TestCase):
    def test_boot_branches_on_me_user(self):
        self.assertIn("if (me && me.user)", read("app.js"))

    def test_hunts_tile_label(self):
        js = read("app.js")
        self.assertIn('<div class="sl">Hunts finished</div>', js)

    def test_token_rows_wrap_and_signout_target(self):
        css = read("styles.css")
        self.assertIn("#profile-token-row, #connect-token-row "
                      "{ flex-wrap: wrap; }", css)
        self.assertIn(".avatar {", css)
        self.assertIn("min-height: 44px", css)


if __name__ == "__main__":
    unittest.main()
