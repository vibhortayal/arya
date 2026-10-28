"""Localizer for a 90-frame grocery-store walkthrough.

Design:
  * SIFT features (CLAHE grayscale, RootSIFT) are stored concatenated for
    all index frames together with a frame-owner id per descriptor.
  * A query is matched once against the whole descriptor pool.  The Lowe
    ratio is evaluated against the first competitor from a non-neighbouring
    frame, because adjacent video frames legitimately share descriptors.
  * The best-voted frames are geometrically verified (homography and
    affine RANSAC inliers), blended with match count and thumbnail
    similarity, and the final u is interpolated between neighbouring
    verified frames.

Vendored VERBATIM into Arya (api/localizer.py) from the
localizer spike. Authored by Muse Wonder 1.0 (localizer spike,
2026-10-27; ~/workspace/arya-3d/localize-spike/, REPORT.md
there). The algorithm is unchanged: held-out eval (45 frames the
index never saw) — stop accuracy 42/45, neighborhood accuracy
45/45, median |du| 0.0027, 1.3-1.6 s per query on CPU.

Vendoring adaptations are paths only: DEFAULT_INDEX_PATH points
at the shipped artifact (models/trader-joes/localizer-index.npz,
built by tools/build_localizer_index.py) and DEFAULT_INDEX_DIR
at a frames directory that does not exist in this repo, so the
build-on-miss fallback can never fire on a server — a missing
artifact is a null match, and api/locate.py reports no_index.
Do not "improve" the algorithm here; improvements go through
the spike's eval first.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

DEFAULT_INDEX_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "models",
    "trader-joes", "frames"
)
DEFAULT_INDEX_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "models",
    "trader-joes", "localizer-index.npz"
)

TARGET_WIDTH = 800
MAX_FEATURES = 1200
MAX_PER_FRAME = 800
MIN_QUERY_FEATURES = 8

THUMB_W = 64
THUMB_H = 36

KNN_K = 4
RATIO_TEST = 0.80
MAX_MATCH_DISTANCE = 1.0
NEIGHBOR_RADIUS = 2
TOP_PRELIM_VERIFY = 8
RANSAC_REPROJ_THRESHOLD = 5.0

_FRAME_RE = re.compile(r"^frame_(\d+)\.jpe?g$", re.IGNORECASE)

_INDEX_CACHE: Dict[Tuple[str, int, int], Dict] = {}


def _seed_rng() -> None:
    try:
        cv2.setRNGSeed(0)
    except Exception:
        pass


_seed_rng()


def _parse_frame_u(filename: str) -> float:
    match = _FRAME_RE.match(os.path.basename(filename))
    if match is None:
        raise ValueError(f"not an index frame filename: {filename!r}")
    num = int(match.group(1))
    # Required derivation: u = (int(num) - 1) / 2 / 89.
    return float((num - 1) / 2 / 89)


def _thumbnail(bgr: np.ndarray) -> np.ndarray:
    if bgr is None or bgr.size == 0:
        return np.zeros((THUMB_H, THUMB_W, 3), dtype=np.uint8)
    if bgr.shape[1] == THUMB_W and bgr.shape[0] == THUMB_H:
        return np.asarray(bgr, dtype=np.uint8)
    interpolation = cv2.INTER_AREA if bgr.shape[1] >= THUMB_W else cv2.INTER_LINEAR
    resized = cv2.resize(bgr, (THUMB_W, THUMB_H), interpolation=interpolation)
    return np.asarray(resized, dtype=np.uint8)


def _extract_features(
    bgr: np.ndarray,
) -> Tuple[np.ndarray, Optional[np.ndarray]]:
    """Return (keypoint xy array, RootSIFT descriptors or None)."""
    empty_kps = np.empty((0, 2), dtype=np.float32)
    if bgr is None or bgr.size == 0 or len(bgr.shape) < 2:
        return empty_kps, None

    image = bgr
    height, width = image.shape[:2]
    if width > TARGET_WIDTH:
        scale = TARGET_WIDTH / float(width)
        new_height = max(1, int(round(height * scale)))
        image = cv2.resize(
            image, (TARGET_WIDTH, new_height), interpolation=cv2.INTER_AREA
        )

    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image

    if gray.shape[0] >= 8 and gray.shape[1] >= 8:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)

    sift = cv2.SIFT_create(
        nfeatures=MAX_FEATURES,
        nOctaveLayers=3,
        contrastThreshold=0.03,
        edgeThreshold=10,
        sigma=1.6,
    )
    keypoints, descriptors = sift.detectAndCompute(gray, None)
    if keypoints is None or descriptors is None or len(keypoints) == 0:
        return empty_kps, None

    descriptors = np.asarray(descriptors, dtype=np.float32)
    if descriptors.ndim != 2 or descriptors.shape[0] != len(keypoints):
        return empty_kps, None

    if len(keypoints) > MAX_PER_FRAME:
        order = sorted(
            range(len(keypoints)),
            key=lambda i: (
                -float(keypoints[i].response),
                float(keypoints[i].pt[0]),
                float(keypoints[i].pt[1]),
                float(keypoints[i].size),
                float(keypoints[i].angle),
            ),
        )
        selected = np.asarray(order[:MAX_PER_FRAME], dtype=np.int64)
        kps_xy = np.asarray(
            [keypoints[int(i)].pt for i in selected], dtype=np.float32
        )
        descriptors = descriptors[selected]
    else:
        kps_xy = np.asarray([kp.pt for kp in keypoints], dtype=np.float32)

    # RootSIFT: L1-normalise then take the square root.
    descriptors = np.asarray(descriptors, dtype=np.float32)
    sums = np.sum(descriptors, axis=1, keepdims=True)
    sums[sums <= 0.0] = 1.0
    descriptors = descriptors / sums
    descriptors = np.sqrt(descriptors)
    descriptors = np.ascontiguousarray(descriptors, dtype=np.float32)
    kps_xy = np.ascontiguousarray(kps_xy, dtype=np.float32)
    return kps_xy, descriptors


def _extract_from_path(
    image_path: str,
) -> Tuple[np.ndarray, Optional[np.ndarray]]:
    image = cv2.imread(os.fspath(image_path), cv2.IMREAD_COLOR)
    if image is None:
        return np.empty((0, 2), dtype=np.float32), None
    return _extract_features(image)


def build_index(index_dir, out_path):
    """Build and save the index artifact from the index frames.

    Args:
        index_dir: directory containing frame_XXXX.jpg index frames.
        out_path: destination path for the .npz artifact.

    Returns:
        The output path as a string.
    """
    index_dir_str = os.fspath(index_dir)
    out_path_str = os.fspath(out_path)
    if not os.path.isdir(index_dir_str):
        raise FileNotFoundError(f"index directory not found: {index_dir_str}")

    numbered: List[Tuple[int, str]] = []
    for name in os.listdir(index_dir_str):
        match = _FRAME_RE.match(name)
        if match is not None:
            numbered.append((int(match.group(1)), name))
    if not numbered:
        raise ValueError(f"no frame_XXXX.jpg files found in {index_dir_str}")
    numbered.sort(key=lambda item: (item[0], item[1]))

    frames: List[str] = []
    us: List[float] = []
    descriptor_parts: List[np.ndarray] = []
    keypoint_parts: List[np.ndarray] = []
    thumb_parts: List[np.ndarray] = []
    counts: List[int] = []

    for num, name in numbered:
        u_value = float((num - 1) / 2 / 89)
        path = os.path.join(index_dir_str, name)
        image = cv2.imread(path, cv2.IMREAD_COLOR)
        if image is None:
            print(f"warning: unreadable index frame skipped: {path}", file=sys.stderr)
            kps_xy = np.empty((0, 2), dtype=np.float32)
            descriptors = None
            thumb = np.zeros((THUMB_H, THUMB_W, 3), dtype=np.uint8)
        else:
            kps_xy, descriptors = _extract_features(image)
            thumb = _thumbnail(image)

        if descriptors is None:
            desc_arr = np.empty((0, 128), dtype=np.float32)
            kps_arr = np.empty((0, 2), dtype=np.float32)
        else:
            desc_arr = np.ascontiguousarray(descriptors, dtype=np.float32)
            kps_arr = np.ascontiguousarray(kps_xy, dtype=np.float32)

        frames.append(name)
        us.append(u_value)
        descriptor_parts.append(desc_arr)
        keypoint_parts.append(kps_arr)
        thumb_parts.append(thumb)
        counts.append(int(desc_arr.shape[0]))

        if len(frames) % 20 == 0:
            print(f"indexed {len(frames)}/{len(numbered)} frames", file=sys.stderr)

    descriptors_all = (
        np.concatenate(descriptor_parts, axis=0)
        if descriptor_parts
        else np.empty((0, 128), dtype=np.float32)
    )
    keypoints_all = (
        np.concatenate(keypoint_parts, axis=0)
        if keypoint_parts
        else np.empty((0, 2), dtype=np.float32)
    )
    counts_arr = np.asarray(counts, dtype=np.int64)
    offsets = np.zeros(len(frames) + 1, dtype=np.int64)
    if len(frames):
        np.cumsum(counts_arr, out=offsets[1:])
    owner = np.repeat(
        np.arange(len(frames), dtype=np.int32), counts_arr
    ) if frames else np.empty((0,), dtype=np.int32)
    thumbs_all = (
        np.stack(thumb_parts, axis=0)
        if thumb_parts
        else np.empty((0, THUMB_H, THUMB_W, 3), dtype=np.uint8)
    )

    parent = os.path.dirname(os.path.abspath(out_path_str))
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(out_path_str, "wb") as handle:
        np.savez(
            handle,
            version=np.asarray([1], dtype=np.int64),
            frames=np.asarray(frames, dtype=str),
            us=np.asarray(us, dtype=np.float64),
            counts=counts_arr,
            offsets=offsets,
            owner=np.asarray(owner, dtype=np.int32),
            descriptors=np.asarray(descriptors_all, dtype=np.float32),
            keypoints=np.asarray(keypoints_all, dtype=np.float32),
            thumbs=np.asarray(thumbs_all, dtype=np.uint8),
        )
    _INDEX_CACHE.clear()
    return out_path_str


def _load_index(index_path) -> Dict:
    path_abs = os.path.abspath(os.fspath(index_path))
    stat = os.stat(path_abs)
    cache_key = (path_abs, int(stat.st_mtime_ns), int(stat.st_size))
    cached = _INDEX_CACHE.get(cache_key)
    if cached is not None:
        return cached

    with np.load(path_abs, allow_pickle=False) as data:
        files = set(data.files)
        frames = [str(x) for x in data["frames"].tolist()]
        us = np.asarray(data["us"], dtype=np.float64)
        descriptors = np.asarray(data["descriptors"], dtype=np.float32)
        keypoints = np.asarray(data["keypoints"], dtype=np.float32)
        owner = np.asarray(data["owner"], dtype=np.int32)
        if "offsets" in files:
            offsets = np.asarray(data["offsets"], dtype=np.int64)
        else:
            offsets = np.zeros(len(frames) + 1, dtype=np.int64)
        thumbs = (
            np.asarray(data["thumbs"], dtype=np.uint8)
            if "thumbs" in files
            else None
        )

    if descriptors.ndim != 2:
        raise ValueError("corrupt index: descriptors must be 2-D")
    if keypoints.ndim != 2 or keypoints.shape[0] != descriptors.shape[0]:
        raise ValueError("corrupt index: keypoints/descriptors length mismatch")
    if owner.shape[0] != descriptors.shape[0]:
        raise ValueError("corrupt index: owner/descriptors length mismatch")

    index = {
        "frames": frames,
        "us": us,
        "descriptors": descriptors,
        "keypoints": keypoints,
        "owner": owner,
        "offsets": offsets,
        "thumbs": thumbs,
        "path": path_abs,
    }
    _INDEX_CACHE.clear()
    _INDEX_CACHE[cache_key] = index
    return index


def _ensure_index(index_path) -> bool:
    if os.path.exists(os.fspath(index_path)):
        return True
    try:
        if os.path.isdir(DEFAULT_INDEX_DIR):
            build_index(DEFAULT_INDEX_DIR, index_path)
            return os.path.exists(os.fspath(index_path))
    except Exception as exc:  # graceful failure -> null match result
        print(f"warning: could not build index: {exc}", file=sys.stderr)
    return False


def _geometric_inliers(
    src: np.ndarray, dst: np.ndarray
) -> Tuple[float, int, int]:
    """Return (blended geometric inliers, homography inliers, affine inliers)."""
    if src.shape[0] < 8:
        return 0.0, 0, 0
    src_pts = np.asarray(src, dtype=np.float32).reshape(-1, 1, 2)
    dst_pts = np.asarray(dst, dtype=np.float32).reshape(-1, 1, 2)

    homography_inliers = 0
    try:
        _seed_rng()
        result = cv2.findHomography(
            src_pts,
            dst_pts,
            cv2.RANSAC,
            RANSAC_REPROJ_THRESHOLD,
            maxIters=2000,
            confidence=0.99,
        )
        if result is not None:
            _, mask = result
            if mask is not None:
                homography_inliers = int(np.sum(mask))
    except Exception:
        homography_inliers = 0

    affine_inliers = 0
    try:
        _seed_rng()
        affine_result = cv2.estimateAffinePartial2D(
            src_pts,
            dst_pts,
            method=cv2.RANSAC,
            ransacReprojThreshold=RANSAC_REPROJ_THRESHOLD,
            maxIters=2000,
            confidence=0.99,
            refineIters=10,
        )
        if affine_result is not None:
            _, affine_mask = affine_result
            if affine_mask is not None:
                affine_inliers = int(np.sum(affine_mask))
    except Exception:
        affine_inliers = 0

    geo = max(float(homography_inliers), 0.85 * float(affine_inliers))
    return geo, homography_inliers, affine_inliers


def _verify_candidate(
    frame_idx: int,
    matches_list: List[Tuple[int, int, float]],
    query_kps: np.ndarray,
    index: Dict,
    query_thumb: Optional[np.ndarray],
    votes_count: int,
) -> Dict:
    frames: List[str] = index["frames"]
    us: np.ndarray = index["us"]
    index_kps: np.ndarray = index["keypoints"]
    thumbs = index.get("thumbs")

    good = len(matches_list)
    if good:
        query_idx = np.asarray([m[0] for m in matches_list], dtype=np.int64)
        train_idx = np.asarray([m[1] for m in matches_list], dtype=np.int64)
        src = query_kps[query_idx]
        dst = index_kps[train_idx]
        mean_dist = float(np.mean([m[2] for m in matches_list]))
    else:
        src = np.empty((0, 2), dtype=np.float32)
        dst = np.empty((0, 2), dtype=np.float32)
        mean_dist = 999.0

    geo, homography_inliers, affine_inliers = _geometric_inliers(src, dst)

    thumb_sim = 0.0
    if (
        query_thumb is not None
        and thumbs is not None
        and 0 <= frame_idx < int(thumbs.shape[0])
    ):
        diff = np.mean(
            np.abs(
                query_thumb.astype(np.float32)
                - thumbs[frame_idx].astype(np.float32)
            )
        ) / 255.0
        thumb_sim = float(max(0.0, 1.0 - float(diff)))

    score = float(geo + 0.15 * float(good) + 3.0 * thumb_sim)
    return {
        "frame_idx": int(frame_idx),
        "frame": frames[frame_idx],
        "u": float(us[frame_idx]),
        "votes": int(votes_count),
        "good": int(good),
        "geo": float(geo),
        "homography_inliers": int(homography_inliers),
        "affine_inliers": int(affine_inliers),
        "thumb_sim": float(thumb_sim),
        "score": float(score),
        "mean_dist": float(mean_dist),
    }


def match_image(image_path, index_path=DEFAULT_INDEX_PATH) -> Dict:
    """Match one image against the index.

    Returns:
        {"estimated_u": float|None, "confidence": float,
         "candidates": [{"frame", "u", "score"}, ... up to 5]}
    """
    null_result: Dict = {"estimated_u": None, "confidence": 0.0, "candidates": []}
    if image_path is None:
        return dict(null_result)

    try:
        image = cv2.imread(os.fspath(image_path), cv2.IMREAD_COLOR)
    except Exception:
        return dict(null_result)
    if image is None:
        return dict(null_result)

    try:
        query_kps, query_desc = _extract_features(image)
        query_thumb = _thumbnail(image)
    except Exception:
        return dict(null_result)
    if query_desc is None or query_kps is None or len(query_desc) < MIN_QUERY_FEATURES:
        return dict(null_result)

    if not _ensure_index(index_path):
        return dict(null_result)
    try:
        index = _load_index(index_path)
    except Exception as exc:
        print(f"warning: could not load index: {exc}", file=sys.stderr)
        return dict(null_result)

    frames: List[str] = index["frames"]
    us: np.ndarray = index["us"]
    descriptors: np.ndarray = index["descriptors"]
    owner: np.ndarray = index["owner"]
    n_frames = len(frames)
    if n_frames == 0 or descriptors.shape[0] == 0:
        return dict(null_result)

    matcher = cv2.BFMatcher(cv2.NORM_L2, crossCheck=False)
    try:
        knn = matcher.knnMatch(query_desc, descriptors, k=KNN_K)
    except Exception:
        return dict(null_result)

    votes = np.zeros(n_frames, dtype=np.int64)
    dist_sum = np.zeros(n_frames, dtype=np.float64)
    matches_per_frame: List[List[Tuple[int, int, float]]] = [
        [] for _ in range(n_frames)
    ]

    for pair in knn:
        if not pair:
            continue
        best = pair[0]
        if float(best.distance) > MAX_MATCH_DISTANCE:
            continue
        if int(best.trainIdx) < 0 or int(best.trainIdx) >= owner.shape[0]:
            continue
        best_frame = int(owner[int(best.trainIdx)])

        competitor_distance: Optional[float] = None
        for candidate in pair[1:]:
            if int(candidate.trainIdx) < 0 or int(candidate.trainIdx) >= owner.shape[0]:
                continue
            candidate_frame = int(owner[int(candidate.trainIdx)])
            if abs(candidate_frame - best_frame) > NEIGHBOR_RADIUS:
                competitor_distance = float(candidate.distance)
                break

        if competitor_distance is not None and not (
            float(best.distance) < RATIO_TEST * competitor_distance
        ):
            continue

        votes[best_frame] += 1
        dist_sum[best_frame] += float(best.distance)
        matches_per_frame[best_frame].append(
            (int(best.queryIdx), int(best.trainIdx), float(best.distance))
        )

    if not bool(np.any(votes)):
        return dict(null_result)

    prelim_order = sorted(
        [i for i in range(n_frames) if votes[i] > 0],
        key=lambda i: (
            -int(votes[i]),
            float(dist_sum[i] / votes[i]) if votes[i] else 999.0,
            int(i),
        ),
    )
    if not prelim_order:
        return dict(null_result)

    verified: Dict[int, Dict] = {}

    def verify(idx: int) -> None:
        if idx not in verified:
            verified[idx] = _verify_candidate(
                idx,
                matches_per_frame[idx],
                query_kps,
                index,
                query_thumb,
                int(votes[idx]),
            )

    for idx in prelim_order[:TOP_PRELIM_VERIFY]:
        verify(idx)
    top_frame = int(prelim_order[0])
    for delta in (-2, -1, 1, 2):
        neighbour = top_frame + delta
        if 0 <= neighbour < n_frames and votes[neighbour] > 0:
            verify(neighbour)

    def rank_key(info: Dict):
        return (
            -float(info["score"]),
            -int(info["votes"]),
            float(info["mean_dist"]),
            int(info["frame_idx"]),
        )

    ranked = sorted(verified.values(), key=rank_key)
    if not ranked:
        return dict(null_result)
    best = ranked[0]
    best_idx = int(best["frame_idx"])

    # Verify any not-yet-verified neighbours of the verified winner so
    # sub-frame interpolation uses measured scores for all of them.
    added = False
    for neighbour in range(
        max(0, best_idx - NEIGHBOR_RADIUS),
        min(n_frames, best_idx + NEIGHBOR_RADIUS + 1),
    ):
        if neighbour not in verified and votes[neighbour] > 0:
            verify(neighbour)
            added = True
    if added:
        ranked = sorted(verified.values(), key=rank_key)
        best = ranked[0]
        best_idx = int(best["frame_idx"])

    if float(best["score"]) <= 0.0 and int(best["votes"]) <= 0:
        return dict(null_result)

    # Confidence from inlier strength/ratio and margin over non-local rivals.
    best_geo = float(best["geo"])
    best_good = int(best["good"])
    second_nonlocal = 0.0
    for info in ranked:
        if abs(int(info["frame_idx"]) - best_idx) > NEIGHBOR_RADIUS:
            second_nonlocal = max(second_nonlocal, float(info["score"]))
    denom = float(best["score"]) + second_nonlocal
    margin = (
        (float(best["score"]) - second_nonlocal) / denom if denom > 0 else 0.0
    )
    margin = float(max(0.0, min(1.0, margin)))
    if best_geo > 0:
        strength = best_geo / (best_geo + 25.0)
    elif best_good > 0:
        strength = 0.5 * best_good / (best_good + 25.0)
    else:
        strength = 0.0
    ratio_factor = 0.7 + 0.3 * (
        min(1.0, best_geo / max(1, best_good)) if best_good else 0.0
    )
    margin_factor = 0.8 + 0.2 * margin
    confidence = float(
        max(0.0, min(1.0, strength * ratio_factor * margin_factor))
    )

    # Sub-frame interpolation over verified neighbours of the winner.
    spacing = 1.0 / 89.0
    if n_frames > 1:
        diffs = np.diff(us)
        positive = diffs[diffs > 0]
        if positive.size:
            spacing = float(np.median(positive))

    neighbour_infos = [
        info
        for info in ranked
        if abs(int(info["frame_idx"]) - best_idx) <= NEIGHBOR_RADIUS
    ]
    weights = np.asarray(
        [max(float(info["score"]), 0.0) for info in neighbour_infos],
        dtype=np.float64,
    )
    total_weight = float(np.sum(weights)) if weights.size else 0.0
    if neighbour_infos and total_weight > 0:
        refined = float(
            np.dot(
                weights,
                np.asarray(
                    [float(info["u"]) for info in neighbour_infos],
                    dtype=np.float64,
                ),
            )
            / total_weight
        )
    else:
        refined = float(best["u"])
    refined = min(
        max(refined, float(best["u"]) - 1.2 * spacing),
        float(best["u"]) + 1.2 * spacing,
    )
    refined = float(min(max(refined, 0.0), 1.0))

    candidates: List[Dict] = []
    seen = set()
    for info in ranked[:5]:
        candidates.append(
            {
                "frame": str(info["frame"]),
                "u": float(info["u"]),
                "score": float(info["score"]),
            }
        )
        seen.add(int(info["frame_idx"]))
    if len(candidates) < 5:
        for idx in prelim_order:
            if idx in seen:
                continue
            candidates.append(
                {
                    "frame": str(frames[idx]),
                    "u": float(us[idx]),
                    "score": float(0.15 * int(votes[idx])),
                }
            )
            seen.add(int(idx))
            if len(candidates) >= 5:
                break

    return {
        "estimated_u": float(refined),
        "confidence": float(confidence),
        "candidates": candidates,
    }


# Convenient aliases for external callers.
localize_image = match_image
match_query = match_image


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Grocery walkthrough localizer")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser("build", help="build the index")
    build_parser.add_argument("--index-dir", default=DEFAULT_INDEX_DIR)
    build_parser.add_argument(
        "--out", "--index", dest="out", default=DEFAULT_INDEX_PATH
    )

    match_parser = subparsers.add_parser("match", help="match one image")
    match_parser.add_argument("image_path")
    match_parser.add_argument("--index", dest="index", default=DEFAULT_INDEX_PATH)

    args = parser.parse_args(argv)

    if args.command == "build":
        out_path = build_index(args.index_dir, args.out)
        print(json.dumps({"index_path": str(out_path), "status": "ok"}))
        return 0

    result = match_image(args.image_path, index_path=args.index)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
