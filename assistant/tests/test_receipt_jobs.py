"""Background receipt reading: files are sent first, then read on the
server one by one; a refusal every file would hit pauses the job."""
import os, sys, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["ARYA_RECEIPT_JOBS_INLINE"] = "1"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from fastapi import HTTPException
from fastapi.testclient import TestClient


class TestReceiptJobs(unittest.TestCase):
    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from api import receiptjobs
        from api.main import app
        self.rj = receiptjobs
        self.c = TestClient(app)
        self.c.post("/auth/setup", json={"username": "owner", "password": "pw"})
        self.seen = []

    def send(self, n, media="image/png"):
        job = self.c.post("/api/receipts/jobs", json={"count": n}).json()
        for i in range(n):
            r = self.c.put(f"/api/receipts/jobs/{job['id']}/files/{i}", content=b"img%d" % i,
                           headers={"Content-Type": media, "X-File-Name": f"r{i}.png"})
            self.assertEqual(r.status_code, 200, r.text)
        return job["id"]

    def run_with(self, fake, n=4):
        self.rj.file_one = fake
        jid = self.send(n)
        return jid, self.c.post(f"/api/receipts/jobs/{jid}/commit").json()

    def test_every_file_is_read_and_counted(self):
        outcomes = iter(["filed", "duplicate", "filed", "filed"])
        _jid, out = self.run_with(lambda body, media: next(outcomes))
        self.assertEqual((out["status"], out["filed"], out["duplicate"], out["failed"]),
                         ("ready", 3, 1, 0))
        self.assertEqual(self.c.get("/api/receipts/jobs").json()["jobs"][0]["done"], 4)

    def test_a_bad_file_fails_with_its_reason_and_the_rest_go_on(self):
        def fake(body, media):
            if body == b"img1":
                raise HTTPException(422, "could not read the date on this receipt")
            return "filed"
        _jid, out = self.run_with(fake)
        self.assertEqual((out["filed"], out["failed"]), (3, 1))
        self.assertEqual(out["failures"], [{"name": "r1.png", "reason": "could not read the date on this receipt"}])

    def test_a_refusal_pauses_the_job_and_resume_finishes_it(self):
        state = {"open": False, "calls": 0}

        def fake(body, media):
            state["calls"] += 1
            if not state["open"] and body == b"img2":
                raise HTTPException(429, "Arya's reading is switched off for this account after unusual use.")
            return "filed"
        jid, out = self.run_with(fake)
        self.assertEqual(out["status"], "paused")
        self.assertIn("switched off", out["reason"])
        self.assertEqual(out["filed"], 2)
        self.assertEqual(state["calls"], 3)          # img3 was not tried
        state["open"] = True
        out = self.c.post(f"/api/receipts/jobs/{jid}/resume").json()
        self.assertEqual((out["status"], out["filed"], out["failed"]), ("ready", 4, 0))

    def test_rejects_bad_input(self):
        self.assertEqual(self.c.post("/api/receipts/jobs", json={"count": 0}).status_code, 400)
        self.assertEqual(self.c.post("/api/receipts/jobs", json={"count": 151}).status_code, 400)
        jid = self.send(1)
        r = self.c.put(f"/api/receipts/jobs/{jid}/files/0", content=b"x", headers={"Content-Type": "text/plain"})
        self.assertEqual(r.status_code, 415)
        r = self.c.put(f"/api/receipts/jobs/{jid}/files/5", content=b"x", headers={"Content-Type": "image/png"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.c.post("/api/receipts/jobs/nope/commit").status_code, 404)

    def test_a_sent_batch_cannot_take_more_files(self):
        self.rj.file_one = lambda b, m: "filed"
        jid = self.send(1)
        self.c.post(f"/api/receipts/jobs/{jid}/commit")
        r = self.c.put(f"/api/receipts/jobs/{jid}/files/0", content=b"x", headers={"Content-Type": "image/png"})
        self.assertEqual(r.status_code, 400)

    def test_files_are_deleted_once_read(self):
        self.rj.file_one = lambda b, m: "filed"
        jid = self.send(2)
        self.c.post(f"/api/receipts/jobs/{jid}/commit")
        self.assertFalse(os.path.exists(self.rj._dir(jid)))

    def test_demo_cannot_start_a_batch(self):
        c = TestClient(__import__("api.main", fromlist=["app"]).app)
        c.post("/auth/demo")
        self.assertIn(c.post("/api/receipts/jobs", json={"count": 1}).status_code, (403, 401))


class TestFileOne(unittest.TestCase):
    """The real per-file path: refusals carry the app's own reasons."""
    def test_no_key_is_a_503_with_the_reason(self):
        os.environ.pop("MODEL_API_KEY", None)
        from api import receiptjobs
        with self.assertRaises(HTTPException) as cm:
            receiptjobs.file_one(b"x", "image/png")
        self.assertEqual(cm.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
