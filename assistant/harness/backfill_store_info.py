"""Give filed receipts their store address and the other printed details by
re-reading the kept photo (everything but the item lines). Only store_info
and receipt_meta are written; lines and totals are untouched.
Run inside the api container (the key is in its environment):

  python -m harness.backfill_store_info vibhor15@gmail.com           # count only
  python -m harness.backfill_store_info vibhor15@gmail.com --yes     # read and save
  python -m harness.backfill_store_info vibhor15@gmail.com --yes --limit 3   # try three first

A receipt is read when it has a kept photo and no store_info yet. Each read
is one short model call booked on that account's ledger.
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from api import deps, state
from api.decode import service


def todo():
    return [r for r in state.own_receipts()
            if not r.get("store_info") and r.get("image_ref")]


def run(user, go=False, limit=None, client=None):
    done = failed = 0
    with state.as_user(user, None):
        rows = todo()
        print(f"{user}: {len(state.own_receipts())} receipts, {len(rows)} with a photo and no store address")
        if not go:
            print("dry run: nothing read (add --yes)")
            return 0
        for r in rows[: limit or len(rows)]:
            data = state.receipt_media(r["receipt_id"])
            if not data:
                failed += 1
                continue
            try:
                c = client or deps.new_client()
                info, meta = service.read_store_info(data, c, r.get("media_type") or "image/jpeg")
            except Exception as e:  # keep going; the receipt stays as it was
                print("  could not read", r["receipt_id"], str(e)[:80])
                failed += 1
                continue
            if (info or meta) and state.set_receipt_store_info(r["receipt_id"], info, meta):
                done += 1
            else:
                failed += 1
        print(f"saved: {done} | no address found or failed: {failed}")
    return done


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    if lim is not None:
        args = [a for a in args if a != str(lim)]
    run(args[0], "--yes" in sys.argv, lim)
