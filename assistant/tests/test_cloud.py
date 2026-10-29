"""Quest Stage C: the cloud pipeline — tools/prep_cloud.py turns a
VGGT reconstruction into the web asset the "cloud" SceneDriver loads,
and the shipped Trader Joe's model is verified as data. A session for
the demo store can select the cloud driver end to end."""
import importlib.util, json, math, os, struct, tempfile, unittest

os.environ.setdefault("ARYA_INSECURE_COOKIE", "1")
os.environ.setdefault("ARYA_DATA_DIR", tempfile.mkdtemp())
os.environ.setdefault("MODEL_API_KEY", "test-key")

HERE = os.path.dirname(__file__)
ASSISTANT = os.path.abspath(os.path.join(HERE, ".."))
TJ_MODEL = os.path.join(ASSISTANT, "pwa", "models", "trader-joes")


def load_prep():
    spec = importlib.util.spec_from_file_location(
        "prep_cloud", os.path.join(ASSISTANT, "tools", "prep_cloud.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def write_ply(path, points):
    """points: [(x, y, z, r, g, b)] in VGGT export layout."""
    with open(path, "wb") as f:
        f.write(("ply\nformat binary_little_endian 1.0\n"
                 f"element vertex {len(points)}\n"
                 "property float x\nproperty float y\nproperty float z\n"
                 "property uchar red\nproperty uchar green\n"
                 "property uchar blue\nend_header\n").encode())
        for p in points:
            f.write(struct.pack("<fffBBB", *p))


def walk_poses(n=24, spike_at=12):
    """A straight walk along +x, 0.06 per pose, identity rotation
    (center = -t), with one pose spiked 0.9 off the line."""
    poses = []
    for k in range(n):
        cx = 0.06 * k
        cy = 0.9 if k == spike_at else 0.0
        poses.append({"frame": f"frame_{k:04d}.jpg",
                      "extrinsic": [[1, 0, 0, -cx], [0, 1, 0, -cy],
                                    [0, 0, 1, 0.0]],
                      "intrinsic": [[240, 0, 259], [0, 240, 147],
                                    [0, 0, 1]]})
    return poses


def path_max_step(manifest):
    path = manifest["path"]
    return max(math.dist(path[i - 1]["p"], path[i]["p"])
               for i in range(1, len(path)))


class TestPrepPipeline(unittest.TestCase):
    def setUp(self):
        self.prep = load_prep()
        self.dir = tempfile.mkdtemp()

    def test_small_build_end_to_end(self):
        pts = [(0.01 * (i % 40), 0.01 * (i // 40 % 10), 0.005 * i,
                200, 120, 40) for i in range(400)]
        ply = os.path.join(self.dir, "in.ply")
        write_ply(ply, pts)
        poses_path = os.path.join(self.dir, "poses.json")
        with open(poses_path, "w") as f:
            json.dump(walk_poses(), f)
        out = os.path.join(self.dir, "out")
        info = self.prep.build(ply, poses_path, out, "test-store",
                                target=10_000)
        assert info["points"] == 400
        manifest = json.load(open(os.path.join(out, "manifest.json")))
        assert manifest["points"] == 400
        assert manifest["layout"]["positionBytes"] == 400 * 6
        assert manifest["layout"]["colorBytes"] == 400 * 3
        blob = open(os.path.join(out, "cloud.bin"), "rb").read()
        assert len(blob) == 400 * 9
        # The planted spike pose is dropped; the path cannot lurch.
        assert 12 in manifest["pathStats"]["droppedPoses"]
        assert path_max_step(manifest) <= 0.2
        assert len(manifest["path"]) >= 10

    def test_decimate_hits_the_band(self):
        # 30k deterministic pseudo-random points -> ~10k out.
        pts = []
        seed = 12345
        for i in range(30_000):
            seed = (seed * 1103515245 + 12345) % (2 ** 31)
            x = (seed % 1000) / 500.0
            seed = (seed * 1103515245 + 12345) % (2 ** 31)
            y = (seed % 400) / 500.0
            seed = (seed * 1103515245 + 12345) % (2 ** 31)
            z = (seed % 1000) / 500.0
            pts.append((x, y, z, 10, 20, 30))
        ply = os.path.join(self.dir, "big.ply")
        write_ply(ply, pts)
        pos, col = self.prep.read_ply(ply)
        pos, col = self.prep.decimate(pos, col, target=10_000)
        n = len(pos) // 3
        assert 4_000 <= n <= 10_500, n
        assert len(col) == 3 * n


class TestShippedTJModel(unittest.TestCase):
    """The committed Trader Joe's asset: the band, the byte layout,
    and a smoothed path with no step above a sane threshold."""

    def setUp(self):
        self.manifest = json.load(
            open(os.path.join(TJ_MODEL, "manifest.json")))

    def test_point_band_and_layout(self):
        m = self.manifest
        assert 300_000 <= m["points"] <= 500_000, m["points"]
        assert m["layout"]["positionBytes"] == m["points"] * 6
        assert m["layout"]["colorBytes"] == m["points"] * 3
        size = os.path.getsize(os.path.join(TJ_MODEL, "cloud.bin"))
        assert size == m["points"] * 9

    def test_path_is_smooth(self):
        m = self.manifest
        assert len(m["path"]) >= 100
        assert path_max_step(m) <= 0.2
        assert m["pathStats"]["maxStep"] <= 0.2
        # The spike's known mislocalized poses are out of the path.
        assert 19 in m["pathStats"]["droppedPoses"]


class TestCloudSession(unittest.TestCase):
    """A session for the demo Trader Joe's store can start in the
    cloud driver — the server half of the Stage C wiring."""

    def setUp(self):
        os.environ["ARYA_DATA_DIR"] = tempfile.mkdtemp()
        from fastapi.testclient import TestClient
        from api import main
        from api import deps

        class FakeClient:
            def __init__(self, *a, **k):
                pass

            def chat(self, *a, **k):
                raise AssertionError("Quest paths must not call a model")

        deps.MetaClient = FakeClient
        deps._login_fails.clear()
        self.c = TestClient(main.app)
        r = self.c.post("/auth/setup", json={
            "username": "owner@example.com", "password": "long-password"})
        assert r.status_code == 200, r.text

    def test_tj_session_selects_cloud(self):
        r = self.c.post("/api/quest/sessions", json={
            "store": "Trader Joe's", "mode": "quest", "driver": "cloud",
            "items": [{"name": "Organic Milk"}, {"name": "Eggs"}]})
        assert r.status_code == 200, r.text
        assert r.json()["driver"] == "cloud"


if __name__ == "__main__":
    unittest.main()
