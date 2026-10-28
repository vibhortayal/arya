"""Scrub people out of the shipped store-walk photos (owner,
2026-10-28: "we don't store images of people, only products" — the
walk video's frames too).

Each frame goes through the same SAM 3.1 people scrub as a kept
shopper frame (api/shelfscan.scrub_people), at full size, and is
rewritten in place. Fail closed: a frame whose scrub call fails is
left untouched and reported, and the run exits non-zero so it can be
re-run. Already-scrubbed frames are skipped (scrub.json records them).

Cost: two SAM calls per frame, about $0.005 a frame.

    MODEL_API_KEY=... python -m harness.scrub_walk_frames [--dry-run]
"""
import argparse, glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, "..", "pwa", "models", "trader-joes", "frames-web")


def main(argv=None, client=None, frames_dir=FRAMES):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="scrub and count, write nothing")
    args = ap.parse_args(argv)
    from api import shelfscan
    if client is None:
        from api.meta_client import MetaClient
        if not os.environ.get("MODEL_API_KEY"):
            sys.exit("MODEL_API_KEY is not set")
        client = MetaClient()
    log_path = os.path.join(frames_dir, "scrub.json")
    done = {}
    if os.path.exists(log_path):
        with open(log_path) as fh:
            done = json.load(fh)
    failed, people = [], 0
    for path in sorted(glob.glob(os.path.join(frames_dir, "*.jpg"))):
        name = os.path.basename(path)
        if name in done:
            continue
        with open(path, "rb") as fh:
            raw = fh.read()
        out, n = shelfscan.scrub_people(raw, client, max_side=10_000,
                                        quality=85)
        if out is None:
            failed.append(name)
            print(f"{name}: scrub failed, left as is")
            continue
        people += n
        print(f"{name}: {n} people scrubbed")
        if not args.dry_run:
            with open(path, "wb") as fh:
                fh.write(out)
            done[name] = n
            with open(log_path, "w") as fh:
                json.dump(done, fh, indent=1, sort_keys=True)
    print(f"done: {people} people scrubbed, {len(failed)} frames failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
