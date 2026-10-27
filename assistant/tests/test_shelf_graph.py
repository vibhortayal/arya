"""Quest Stage D: tools/build_shelf_graph.py — SAM 3.1 segments a
walkthrough frame subset, Spark 1.3 labels the clustered shelf
regions, and the regions are projected onto the camera path as a
shelf graph for the cloud SceneDriver. The live API calls are the
pipeline run, not the tests: these tests cover the wire parser, the
side geometry, the clustering, and the graph assembly from
fixtures."""
import importlib.util, json, os, unittest

HERE = os.path.dirname(__file__)
ASSISTANT = os.path.abspath(os.path.join(HERE, ".."))
TJ_MODEL = os.path.join(ASSISTANT, "pwa", "models", "trader-joes")


def load_builder():
    spec = importlib.util.spec_from_file_location(
        "build_shelf_graph",
        os.path.join(ASSISTANT, "tools", "build_shelf_graph.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


W, H = 1036, 582
POSE = {"frame": "frame_0001.jpg",
        "extrinsic": [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
        "intrinsic": [[241.53, 0, 259], [0, 241.45, 147], [0, 0, 1]]}


def seg(x1, y1, x2, y2, conf=0.9, side="left"):
    return {"id": "0", "box": [x1, y1, x2, y2], "w": W, "h": H,
            "confidence": conf, "side": side}


class TestSamWireParser(unittest.TestCase):
    def setUp(self):
        self.b = load_builder()

    def test_boxes_parsed_masks_ignored(self):
        text = (
            "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334;"
            "c=0.75|><|mask;x=0;y=0;c=0.75;data=27,60,~!!!!M!0c[|>"
            ",1<|box;x1=10;y1=20;x2=99;y2=120;w=320;h=334|>"
            "<|mask;x=0;y=0;data=9,9,!abc|>\n")
        boxes = self.b.parse_sam_boxes(text)
        assert len(boxes) == 2
        assert boxes[0]["box"] == [211, 228, 270, 254]
        assert boxes[0]["confidence"] == 0.75
        assert boxes[0]["w"] == 320 and boxes[0]["h"] == 334
        assert boxes[1]["id"] == "1"
        assert boxes[1]["confidence"] is None

    def test_empty_lane_is_no_segments(self):
        assert self.b.parse_sam_boxes("") == []
        assert self.b.parse_sam_boxes("<0f>\n") == []


class TestSegmentSide(unittest.TestCase):
    def setUp(self):
        self.b = load_builder()
        self.forward = (0.0, 0.0, 1.0)   # identity pose walks +z

    def test_image_left_is_walkers_left(self):
        s = seg(0, 200, 200, 400)
        assert self.b.segment_side(s, POSE, self.forward) == "left"

    def test_image_right_is_walkers_right(self):
        s = seg(836, 200, 1035, 400)
        assert self.b.segment_side(s, POSE, self.forward) == "right"

    def test_dead_ahead_has_no_side(self):
        s = seg(468, 200, 568, 400)
        assert self.b.segment_side(s, POSE, self.forward) is None


class TestClusterRegions(unittest.TestCase):
    def setUp(self):
        self.b = load_builder()

    def test_band_merges_and_splits(self):
        segs = [
            seg(0, 100, 300, 190),          # left, upper band
            seg(20, 150, 320, 240),         # left, same band (close cy)
            seg(0, 420, 300, 520),          # left, lower band (far cy)
            seg(736, 100, 1035, 240, side="right"),
        ]
        regions = self.b.cluster_regions(segs)
        assert len(regions) == 3
        left = [r for r in regions if r["side"] == "left"]
        assert len(left) == 2
        merged = [r for r in left if r["segments"] == 2]
        assert len(merged) == 1
        assert merged[0]["box"] == [0, 100, 320, 240]

    def test_filters_noise_and_low_confidence(self):
        segs = [
            seg(0, 100, 300, 240),                       # kept
            seg(500, 100, 510, 110),                     # tiny: dropped
            seg(0, 0, 1035, 581),                        # frame: dropped
            seg(600, 100, 800, 240, conf=0.20),          # low c: dropped
        ]
        regions = self.b.cluster_regions(segs)
        assert len(regions) == 1
        assert regions[0]["segments"] == 1

    def test_region_cap_merges_nearest_bands(self):
        segs = []
        for i in range(8):   # 8 left bands, evenly spaced in cy
            y = 20 + i * 65
            segs.append(seg(0, y, 300, y + 40))
        old = self.b.BAND_GAP
        self.b.BAND_GAP = 0.05   # keep the 8 bands separate pre-cap
        try:
            regions = self.b.cluster_regions(segs)
        finally:
            self.b.BAND_GAP = old
        assert len(regions) <= self.b.MAX_REGIONS
        assert sum(r["segments"] for r in regions) == 8


class TestGraphAssembly(unittest.TestCase):
    def setUp(self):
        self.b = load_builder()

    def _entry(self, frame, pose, u, label):
        return {"frame": frame, "pose": pose, "u": u, "shelves": [
            {"box": [0, 10, 100, 90], "side": "left", "segments": 2,
             "cy": 0.3, "samConfidence": 0.7, "w": W, "h": H,
             "label": label, "labelConfidence": "high",
             "rawLabel": '{"label": "%s"}' % label}]}

    def test_stops_sorted_with_labels(self):
        entries = [self._entry("frame_0011.jpg", 5, 0.42, "Honey Shelf"),
                   self._entry("frame_0001.jpg", 0, 0.0, "Cheese Shelf")]
        graph = self.b.build_graph("trader-joes", entries, 6.822,
                                    {"frames": 2})
        assert graph["store"] == "trader-joes"
        assert graph["kind"] == "shelf-graph"
        stops = graph["stops"]
        assert [s["u"] for s in stops] == [0.0, 0.42]
        assert stops[0]["frame"] == "frame_0001.jpg"
        assert stops[0]["dist"] == 0.0
        assert abs(stops[1]["dist"] - 0.42 * 6.822) < 0.01
        shelf = stops[0]["shelves"][0]
        assert shelf["label"] == "Cheese Shelf"
        assert shelf["side"] == "left"
        assert shelf["imageSize"] == [W, H]
        json.dumps(graph)   # the document is JSON-serializable

    def test_unlabelled_region_keeps_null_not_a_guess(self):
        e = self._entry("frame_0001.jpg", 0, 0.0, "X Shelf")
        e["shelves"][0]["label"] = None
        e["shelves"][0]["rawLabel"] = "HTTP 500"
        graph = self.b.build_graph("trader-joes", [e], 6.822, {})
        assert graph["stops"][0]["shelves"][0]["label"] is None


class TestPathFractions(unittest.TestCase):
    def setUp(self):
        self.b = load_builder()

    def test_spike_pose_has_no_fraction(self):
        poses = []
        for k in range(24):
            cx = 0.06 * k
            cy = 0.9 if k == 12 else 0.0
            poses.append({"frame": f"frame_{k:04d}.jpg",
                          "extrinsic": [[1, 0, 0, -cx], [0, 1, 0, -cy],
                                        [0, 0, 1, 0.0]],
                          "intrinsic": [[240, 0, 259], [0, 240, 147],
                                        [0, 0, 1]]})
        fracs = self.b.path_fractions(poses)
        assert 12 not in fracs            # the planted spike is dropped
        assert fracs[0] == 0.0
        assert abs(fracs[23] - 1.0) < 1e-9
        us = [fracs[k] for k in sorted(fracs)]
        assert us == sorted(us)           # fractions never run backward


class TestLabelReplyParsing(unittest.TestCase):
    def setUp(self):
        self.b = load_builder()

    def test_json_reply(self):
        label, conf = self.b.parse_label_reply(
            '{"label": "Pasta & Sauce Shelf", "confidence": "high"}')
        assert label == "Pasta & Sauce Shelf" and conf == "high"

    def test_prose_around_json_still_parses(self):
        label, conf = self.b.parse_label_reply(
            'Sure: {"label": "Bread Shelf", "confidence": "low"}')
        assert label == "Bread Shelf" and conf == "low"

    def test_garbage_is_unlabelled(self):
        assert self.b.parse_label_reply("no idea") == (None, None)
        assert self.b.parse_label_reply("") == (None, None)


if __name__ == "__main__":
    unittest.main()
