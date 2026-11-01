"""Extend the Add field's grocery word list with Meta Spark, once, at
build time (intelligence review 2026-11-01, 3.7: AI-made, but no model
call while someone types).

    python -m harness.build_grocery_lexicon            # dry run: prints the new names
    python -m harness.build_grocery_lexicon --apply    # writes api/list/lexicon.txt

Needs MODEL_API_KEY. One Spark call per section (about 15 calls, a few
cents). Every name is post-filtered with the same rule shared names
pass (api/list/suggest.plausible); names already in the file are kept
and nothing is removed, so a run can only add."""
import json
import os
import sys

from api.list import suggest
from api.meta_client import MetaClient

_PROMPT = ("You write the word list for a grocery list app's auto-complete. "
           "For the store section given, list up to 150 common item names a US "
           "household types into a shopping list: generic names, 1 to 4 words, "
           "title case, no brands, no sizes, no duplicates, no plurals of the "
           "same thing twice. JSON only: {\"names\": [\"...\"]}")


def sections(path):
    out, cur = {}, None
    with open(path) as fh:
        for ln in fh:
            ln = ln.strip()
            if ln.startswith("# ") and not ln.startswith("# Grocery") and "python" not in ln \
                    and not ln.startswith("# One name"):
                cur = ln[2:]
                out[cur] = []
            elif ln and not ln.startswith("#") and cur:
                out[cur].append(ln)
    return out


def main(apply=False):
    path = suggest._LEXICON
    have = sections(path)
    seen = {suggest.key(n) for names in have.values() for n in names}
    client = MetaClient()
    added = {}
    for sec in have:
        try:
            text, _u, _c = client.chat([{"role": "system", "content": _PROMPT},
                                        {"role": "user", "content": sec}],
                                       mode="standard", personal=False, reasoning_effort="low")
            names = json.loads(text[text.find("{"): text.rfind("}") + 1]).get("names") or []
        except Exception as exc:  # one bad section does not stop the rest
            print(f"{sec}: skipped ({exc})", file=sys.stderr)
            continue
        for n in names:
            n = str(n).strip()
            if suggest.plausible(n) and suggest.key(n) not in seen:
                seen.add(suggest.key(n))
                added.setdefault(sec, []).append(n)
    for sec, names in added.items():
        print(f"{sec}: +{len(names)}: {', '.join(names[:12])}{' ...' if len(names) > 12 else ''}")
    if not apply:
        print("dry run; --apply writes the file")
        return
    with open(path) as fh:
        head = [ln.rstrip("\n") for ln in fh if ln.startswith("# Grocery") or ln.startswith("# One name")
                or "python -m harness" in ln]
    lines = head[:]
    for sec, names in have.items():
        lines.append(f"# {sec}")
        lines += names + added.get(sec, [])
    with open(path, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"wrote {sum(len(v) for v in added.values())} new names")


if __name__ == "__main__":
    main(apply="--apply" in sys.argv)
