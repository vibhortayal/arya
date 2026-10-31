"""Background store scans (owner, 2026-10-30): the walk only coaches,
frames wait on the phone until there is signal, then they go up one by
one and Arya reads them in the background. Pinned here: a job opens
with a capped frame count, frames are kept until read and deleted
after, the privacy order holds (scrub first, fail closed), what was
found lands on the map and in the job's summary, frames without a
shelf are skipped, the daily cap holds, and a job a restart
interrupted is read when the server starts again.
"""
import os, tempfile, unittest

os.environ["ARYA_INSECURE_COOKIE"] = "1"
os.environ["MODEL_API_KEY"] = "test-key"
from fastapi.testclient import TestClient  # noqa: E402

from tests.test_storescan import READ, FakeScanClient, jpeg  # noqa: E402

STORE = "New Store|s-1"
PRODUCE = '{"label": "Produce", "sign": "", "items": ["Apples"], "prices": []}'
NOTHING = '{"label": "", "sign": "", "items": [], "prices": []}'


class TestScanJobs(unittest.TestCase):
    def setUp(self):
        self.data = tempfile.mkdtemp()
        os.environ["ARYA_DATA_DIR"] = self.data
        os.environ["ARYA_SCAN_JOBS_INLINE"] = "1"
        os.environ["MODEL_API_KEY"] = "test-key"
        os.environ.pop("ARYA_SCAN_DAILY_FRAMES", None)
        FakeScanClient.people, FakeScanClient.people_fails = [], False
        FakeScanClient.reads, FakeScanClient.read_images, FakeScanClient.prompts = [], [], []
        from api import main, deps
        deps.MetaClient = FakeScanClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={"username": "owner@example.com", "password": "long-password"})
        assert r.status_code == 200, r.text

    def tearDown(self):
        os.environ.pop("ARYA_SCAN_JOBS_INLINE", None)

    def open(self, frames, **k):
        r = self.c.post("/api/storemap/jobs", json={"store": STORE, "frames": frames, **k})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    def put(self, jid, n, data):
        return self.c.put(f"/api/storemap/jobs/{jid}/frames/{n}", content=data,
                          headers={"Content-Type": "image/jpeg"})

    def frame_files(self, jid):
        d = os.path.join(self.data, "users", "owner@example.com", "scan-frames", jid)
        return sorted(os.listdir(d)) if os.path.isdir(d) else []

    def test_a_walk_is_read_in_the_background_and_summarised(self):
        FakeScanClient.reads = [READ, PRODUCE, NOTHING]
        job = self.open(3)
        self.assertEqual((job["status"], job["total"]), ("uploading", 3))
        for n in range(3):
            self.assertEqual(self.put(job["id"], n, jpeg(n + 1)).status_code, 200)
        self.assertEqual(len(self.frame_files(job["id"])), 3)    # kept until read
        out = self.c.post(f"/api/storemap/jobs/{job['id']}/commit").json()
        self.assertEqual(out["status"], "ready")
        self.assertEqual(out["done"], 3)
        res = out["result"]
        self.assertEqual(sorted(f["label"] for f in res["found"]), ["Aisle 4", "Produce"])
        self.assertTrue(all(f["created"] and f["fresh"] for f in res["found"]))
        self.assertEqual(res["signs"], ["Aisle 4 Dairy"])
        self.assertEqual(res["skipped"], 1)                      # no shelf in it
        self.assertEqual(res["prices"], [])                      # no opt-in
        self.assertGreater(res["pts"], 0)
        self.assertEqual(self.frame_files(job["id"]), [])        # raw frames deleted
        # The sections are on the shared map like any capture.
        v = self.c.get("/api/storemap", params={"store": STORE}).json()
        self.assertEqual(v["total"], 2)
        # People are scrubbed before every read; the sign outline is skipped.
        self.assertLess(FakeScanClient.prompts.index("person"), FakeScanClient.prompts.index("chat"))
        self.assertNotIn("aisle sign", FakeScanClient.prompts)

    def test_the_ready_card_goes_away_once_seen(self):
        FakeScanClient.reads = [PRODUCE]
        job = self.open(1)
        self.put(job["id"], 0, jpeg(1))
        self.c.post(f"/api/storemap/jobs/{job['id']}/commit")
        jobs = self.c.get("/api/storemap/jobs", params={"store": STORE}).json()["jobs"]
        self.assertEqual([(j["status"], j["seen"]) for j in jobs], [("ready", False)])
        self.c.post(f"/api/storemap/jobs/{job['id']}/seen")
        jobs = self.c.get("/api/storemap/jobs", params={"store": STORE}).json()["jobs"]
        self.assertTrue(jobs[0]["seen"])

    def test_nothing_is_kept_when_the_people_scrub_fails(self):
        FakeScanClient.people_fails = True
        job = self.open(1)
        self.put(job["id"], 0, jpeg(1))
        res = self.c.post(f"/api/storemap/jobs/{job['id']}/commit").json()["result"]
        self.assertEqual((res["found"], res["skipped"]), ([], 1))
        self.assertNotIn("chat", FakeScanClient.prompts)          # never read
        self.assertEqual(self.c.get("/api/storemap", params={"store": STORE}).json()["total"], 0)
        self.assertEqual(self.frame_files(job["id"]), [])

    def test_a_missing_frame_is_simply_not_read(self):
        FakeScanClient.reads = [PRODUCE]
        job = self.open(3)
        self.put(job["id"], 1, jpeg(1))
        out = self.c.post(f"/api/storemap/jobs/{job['id']}/commit").json()
        self.assertEqual((out["status"], out["total"], out["done"]), ("ready", 1, 1))

    def test_frames_are_capped_per_walk_and_per_day(self):
        from api import scanjobs
        self.assertEqual(self.open(500)["total"], scanjobs.MAX_FRAMES)
        os.environ["ARYA_SCAN_DAILY_FRAMES"] = "2"
        self.assertEqual(self.open(5)["total"], 2)
        os.environ["ARYA_SCAN_DAILY_FRAMES"] = "0"
        r = self.c.post("/api/storemap/jobs", json={"store": STORE, "frames": 3})
        self.assertEqual(r.status_code, 429)
        self.assertIn("mapped a lot today", r.json()["detail"])

    def test_bad_requests(self):
        job = self.open(2)
        self.assertEqual(self.put(job["id"], 5, jpeg(1)).status_code, 400)
        self.assertEqual(self.put("nope", 0, jpeg(1)).status_code, 404)
        self.assertEqual(self.c.put(f"/api/storemap/jobs/{job['id']}/frames/0", content=b"x",
                                    headers={"Content-Type": "image/jpeg"}).status_code, 400)
        self.c.post(f"/api/storemap/jobs/{job['id']}/commit")
        self.assertEqual(self.put(job["id"], 0, jpeg(1)).status_code, 400)   # already sent
        self.assertEqual(self.c.post("/api/storemap/jobs", json={"store": STORE, "frames": 0}).status_code, 400)

    def test_no_model_key_keeps_the_walk_on_the_phone(self):
        os.environ.pop("MODEL_API_KEY")
        try:
            r = self.c.post("/api/storemap/jobs", json={"store": STORE, "frames": 3})
            self.assertEqual(r.status_code, 503)
            self.assertIn("stays on your phone", r.json()["detail"])
        finally:
            os.environ["MODEL_API_KEY"] = "test-key"

    def test_a_job_a_restart_interrupted_is_read_at_start(self):
        from api import scanjobs
        FakeScanClient.reads = [PRODUCE]
        job = self.open(1)
        self.put(job["id"], 0, jpeg(1))
        # Commit without the inline read: the job waits in the pending
        # list as if the server had stopped before reading it.
        os.environ.pop("ARYA_SCAN_JOBS_INLINE")
        orig = scanjobs._ensure_worker
        scanjobs._ensure_worker = lambda: None
        try:
            self.c.post(f"/api/storemap/jobs/{job['id']}/commit")
            while not scanjobs._queue.empty():       # the "restart" loses the queue
                scanjobs._queue.get_nowait()
            self.assertEqual(len(scanjobs._pending_read()), 1)
            self.assertEqual(scanjobs.resume(), 1)
            ctx, jid = scanjobs._queue.get_nowait()
            ctx.run(scanjobs._run, jid)
        finally:
            scanjobs._ensure_worker = orig
            os.environ["ARYA_SCAN_JOBS_INLINE"] = "1"
        jobs = self.c.get("/api/storemap/jobs").json()["jobs"]
        self.assertEqual(jobs[0]["status"], "ready")
        self.assertEqual([f["label"] for f in jobs[0]["result"]["found"]], ["Produce"])
        self.assertEqual(scanjobs._pending_read(), [])


if __name__ == "__main__":
    unittest.main()
