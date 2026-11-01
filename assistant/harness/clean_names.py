"""Clean receipt item names in one account's name book (api/dictionary/clean.py).
Run inside the api container (the key is in its environment):

  python -m harness.clean_names vibhor15@gmail.com            # dry run: count + before/after sample
  python -m harness.clean_names vibhor15@gmail.com --apply    # write the dry run's names, turn on for new receipts
  python -m harness.clean_names vibhor15@gmail.com --undo     # put every old name back, turn off

The dry run makes the model calls (one per 25 items) and saves the plan
in the account's data folder; --apply writes that saved plan, so what you
saw is what you get, with no second model call. Receipts are never edited.
"""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from api import deps, state
from api.dictionary import clean


def run(user, mode="dry", client=None):
    from api import groups
    # A household group shares one name book: clean that one.
    with state.as_user(user, groups.group_id_for(user)):
        if mode == "undo":
            res = clean.undo()
            print(f"names put back: {res['restored']} | kept because you set them: {res['kept_by_you']}")
            return res
        if mode == "apply":
            p = clean.load_plan()
            if not p or p.get("version") != clean.VERSION:
                print("no saved dry run: run without --apply first")
                return None
            res = clean.apply(p)
            print(f"renamed: {res['renamed']} | sent to To check: {res['to_check']}")
            print("new receipts are cleaned from now on (undo with --undo)")
            return res
        items = clean.candidates()
        print(f"{user}: {len(items)} items still show receipt text")
        p = clean.plan(client or deps.new_client(), items)
        clean.save_plan(p)
        print(clean.summary(p))
        print("\ndry run: nothing changed (add --apply to write these names)")
        return p


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    mode = "apply" if "--apply" in sys.argv else "undo" if "--undo" in sys.argv else "dry"
    run(args[0], mode)
