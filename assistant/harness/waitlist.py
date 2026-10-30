"""Owner tool for the sign-in waitlist (api/waitlist.py).

    python -m harness.waitlist list            # one address per line, oldest first
    python -m harness.waitlist remove a@b.com  # delete one address on request
    python -m harness.waitlist purge           # delete the whole list

Reads ARYA_DATA_DIR like the app. Purge the list once sign-in is open to
everyone, or 90 days after, whichever comes first.
"""
import sys

from api import waitlist


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "list":
        for r in sorted(waitlist.rows(), key=lambda r: r.get("at", 0)):
            print(r.get("email", ""))
    elif cmd == "remove" and len(argv) == 2:
        print("removed" if waitlist.remove(argv[1]) else "not on the list")
    elif cmd == "purge":
        print(f"deleted {waitlist.purge()} addresses")
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
