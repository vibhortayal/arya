"""One-shot, re-runnable copy of the JSON store into arya.user_docs.

  ARYA_DATA_DIR=... DATABASE_URL=... python3 tools/migrate_json_to_pg.py          # dry run
  ARYA_DATA_DIR=... DATABASE_URL=... python3 tools/migrate_json_to_pg.py --apply  # copy + verify

Idempotent upserts; never deletes or edits a file. Skips the demo
household and the file-only names (api/pgstore.py). After --apply it
reads every row back and compares it with the file, and exits 1 on any
difference.
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from api import pgstore  # noqa: E402


def collect(base):
    """Yield (owner, name, path) for every JSON document in the store."""
    def jsons(d):
        for n in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            p = os.path.join(d, n)
            if n.endswith(".json") and os.path.isfile(p) and not n.startswith(".tmp-"):
                yield n, p
    for n, p in jsons(base):
        yield "", n, p
    users = os.path.join(base, "users")
    for u in sorted(os.listdir(users)) if os.path.isdir(users) else []:
        for n, p in jsons(os.path.join(users, u)):
            yield u, n, p


def main(argv):
    apply = "--apply" in argv
    base = os.environ.get("ARYA_DATA_DIR")
    if not base or not os.path.isdir(base):
        print("set ARYA_DATA_DIR to the data directory"); return 2
    todo = [(o, n, p) for o, n, p in collect(base)
            if n not in pgstore.FILE_ONLY and o not in pgstore.FILE_ONLY_OWNERS]
    for o, n, p in todo:
        print(("copy " if apply else "would copy ") + f"{o or '(root)'}/{n}  {os.path.getsize(p)} bytes")
    if not apply:
        print(f"{len(todo)} documents. Re-run with --apply."); return 0
    bad = 0
    for o, n, p in todo:
        with open(p) as fh:
            doc = json.load(fh)
        pgstore.write(o, n, doc)
        back = pgstore.read(o, n)
        if back != doc:
            bad += 1
            print(f"MISMATCH {o or '(root)'}/{n}")
    print(f"{len(todo)} documents copied, {bad} mismatches.")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
