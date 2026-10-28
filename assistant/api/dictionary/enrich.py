"""Dictionary enrichment on the open-weights model (owner, 2026-10-28).

build.aggregate() emits every entry with category=None and no section
guess; nothing filled them. This batch fills both from item NAMES
only — names are the whole input, so the job is safe for any corpus
whose names may be shared (golden fixtures, the demo household,
platform sightings). A per-owner resolver dictionary stays on the
hosted labeler unless the owner amends the policy for names.

Flow: Muse Spark Open (open_client) proposes {category, section,
confidence} per entry. Proposals at or above MIN_CONF stand.
Below it, the hosted Spark client arbitrates — it sees the same
names only, also no facts (personal=False by construction: the
caller passes a client and this module never sets personal=True).

enrich_entries() mutates and returns the entries; callers persist.
label_corpus_agreement() is the eval: both labelers label the same
names independently and the report is the agreement rate plus the
disagreement pairs — the number the submission quotes.
"""
import json
import os

_PROMPT = open(os.path.join(os.path.dirname(__file__), "..",
                            "prompts", "item_categories_v1.md")).read()
CATEGORIES = {"fruit", "vegetable", "dairy", "bakery", "pantry",
              "frozen", "household", "other"}
SECTIONS = {"produce", "dairy & eggs", "meat & seafood", "bakery",
            "frozen", "pantry", "beverages", "snacks", "household",
            "personal care", "other"}
MIN_CONF = 0.7
BATCH = 25


def _label_batch(client, names):
    """names: [(item_id, name)] -> {item_id: {category, section,
    confidence}} — one chat call, JSON reply, strict vocabularies."""
    listing = "\n".join(f"[{iid}] {name}" for iid, name in names)
    text, _usage, _cost = client.chat(
        [{"role": "system", "content": _PROMPT},
         {"role": "user", "content": listing}],
        personal=False, temperature=0.0)
    start, end = text.find("{"), text.rfind("}")
    if start < 0:
        return {}
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return {}
    out = {}
    for v in data.get("labels", []):
        cat = str(v.get("category", "")).lower()
        sec = str(v.get("section", "")).lower()
        if v.get("item_id") and cat in CATEGORIES and sec in SECTIONS:
            try:
                conf = float(v.get("confidence", 0))
            except (TypeError, ValueError):
                conf = 0.0
            out[v["item_id"]] = {"category": cat, "section": sec,
                                 "confidence": max(0.0, min(1.0, conf))}
    return out


def label_names(client, names):
    """Label a list of plain names (ids are synthesized)."""
    pairs = [(f"n{i}", n) for i, n in enumerate(names)]
    got = {}
    for i in range(0, len(pairs), BATCH):
        got.update(_label_batch(client, pairs[i:i + BATCH]))
    return {names[int(iid[1:])]: lab for iid, lab in got.items()
            if iid[1:].isdigit() and int(iid[1:]) < len(names)}


def enrich_entries(entries, open_client, arbiter_client=None):
    """Fill category/section on entries that lack a category.

    Returns how many entries were labeled. Each labeled entry gains
    category, section_guess, and label_by ("spark-open" or
    "spark-arbiter") with label_conf. Entries that already carry a
    category are untouched (a human or earlier pass wins)."""
    todo = [e for e in entries if not e.get("category")]
    if not todo:
        return 0
    pairs = [(e["item_id"], e.get("canonical_name") or e["item_id"])
             for e in todo]
    proposed = {}
    for i in range(0, len(pairs), BATCH):
        proposed.update(_label_batch(open_client, pairs[i:i + BATCH]))
    weak = [(iid, name) for iid, name in pairs
            if iid not in proposed
            or proposed[iid]["confidence"] < MIN_CONF]
    arbitrated = {}
    if weak and arbiter_client is not None:
        for i in range(0, len(weak), BATCH):
            arbitrated.update(
                _label_batch(arbiter_client, weak[i:i + BATCH]))
    done = 0
    for e in todo:
        lab = arbitrated.get(e["item_id"]) or proposed.get(e["item_id"])
        if not lab:
            continue
        e["category"] = lab["category"]
        e["section_guess"] = lab["section"]
        e["label_conf"] = lab["confidence"]
        e["label_by"] = ("spark-arbiter" if e["item_id"] in arbitrated
                         else "spark-open")
        done += 1
    return done


def label_corpus_agreement(open_client, hosted_client, names):
    """Eval: both labelers label the same names; report agreement."""
    a = label_names(open_client, names)
    b = label_names(hosted_client, names)
    both = [n for n in names if n in a and n in b]
    agree_cat = [n for n in both if a[n]["category"] == b[n]["category"]]
    agree_sec = [n for n in both if a[n]["section"] == b[n]["section"]]
    disagree = [{"item": n, "open": a[n], "hosted": b[n]}
                for n in both if a[n]["category"] != b[n]["category"]]
    return {"names": len(names), "labeled_both": len(both),
            "category_agreement": (len(agree_cat) / len(both)
                                   if both else 0.0),
            "section_agreement": (len(agree_sec) / len(both)
                                  if both else 0.0),
            "disagreements": disagree}
