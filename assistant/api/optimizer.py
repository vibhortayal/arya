"""The Optimizer — Quest step one (ARCHITECTURE §2b).
Every list passes here before a hunt starts. Three moves, in order:
merge duplicate adds into summed quantities; correct typos against the
household dictionary (shown, never silent); ask when one name can be
two real products. Deterministic code only — the dictionary and the
Curator's identity rules (group_map, normalized names, content tokens)
are reused, not re-invented. No model calls, $0.
"""
import difflib

from api import state
from api.curator import _tokens

# Tokens that make two products DIFFERENT products: form, source, and
# preparation. Whole vs oat, fresh vs frozen, organic vs not — the
# Curator never merges across these, so the Optimizer never guesses
# across them either.
DISTINGUISHING = {"organic", "frozen", "fresh", "dried", "whole", "oat",
                  "almond", "soy", "raw", "smoked", "canned", "ground",
                  "sliced", "shredded", "greek", "nonfat", "skim"}

FUZZY_MIN = 0.80  # conservative: below this, a name stays as typed


def _entries():
    return [e for e in state.dictionary()["entries"]
            if e.get("kind") != "fee"
            and e.get("resolution", {}).get("status") != "unresolved"]


def _names_of(e):
    return [e["canonical_name"]] + list(e.get("aliases") or [])


def _signature(entry):
    toks = set()
    for n in _names_of(entry):
        toks |= set(_tokens(n))
    return frozenset(t for t in toks if t in DISTINGUISHING)


def _squash(word):
    """Singularize for comparison only: berries -> berry, eggs -> egg."""
    if word.endswith("ies") and len(word) > 3:
        return word[:-3] + "y"
    if word.endswith("s") and len(word) > 1:
        return word[:-1]
    return word


def _ratio(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def _candidates(typed_name):
    """Dictionary entries the typed name could mean: exact normalized
    matches first, else token coverage either way or a close difflib
    ratio (on the name, or per token with plurals squashed — "bluberry"
    reaches "blueberries" and nothing wilder does)."""
    norm = state._norm_name(typed_name)
    typed = set(_tokens(typed_name))
    exact, fuzzy = [], []
    for e in _entries():
        names = _names_of(e)
        if any(state._norm_name(n) == norm for n in names):
            exact.append(e)
            continue
        for n in names:
            toks = set(_tokens(n))
            # Coverage runs one way only: every typed token is in the
            # product's name ("eggs" -> "Organic Eggs" is a candidate).
            # A product whose name is a strict subset of what was typed
            # is a different, broader thing — "pasta sauce" is not
            # "Pasta 1 lb" — so it is never a candidate (never guess).
            cover = bool(typed and toks and typed <= toks)
            close = _ratio(norm, state._norm_name(n)) >= FUZZY_MIN
            token_close = bool(typed) and all(
                any(_ratio(_squash(t), _squash(et)) >= 0.75 for et in toks)
                for t in typed)
            if cover or close or token_close:
                fuzzy.append(e)
                break
    return exact, fuzzy


def _collapse(entries, gm):
    """One representative entry per dictionary group — two SKUs of the
    same eggs are one candidate, not two."""
    by_group = {}
    for e in entries:
        by_group.setdefault(gm.get(e["item_id"], e["item_id"]), e)
    return sorted(by_group.values(), key=lambda e: e["item_id"])


def _pick(cands, name, gm):
    """Decide one typed name against its candidate products.
    Returns ("item", entry) | ("question", [entries]) | ("unresolved", None)."""
    if not cands:
        return "unresolved", None
    if len(cands) == 1:
        return "item", cands[0]
    sigs = {}
    for e in cands:
        sigs.setdefault(_signature(e), []).append(e)
    if len(sigs) > 1:
        # Candidates differ by a distinguishing token. A typed token
        # selects its own product; no typed token means a real choice.
        typed_sig = {t for t in _tokens(name) if t in DISTINGUISHING}
        pick = [s for s in sigs if typed_sig and s and typed_sig <= set(s)]
        if len(pick) == 1 and len(sigs[pick[0]]) == 1:
            return "item", sigs[pick[0]][0]
        reps = [sigs[s][0] for s in sorted(sigs, key=lambda s: sorted(s))]
        return "question", reps
    # Same distinguishing signature: the closest spelling wins, and
    # the correction is reported by the caller.
    norm = state._norm_name(name)
    best = max(cands, key=lambda e: difflib.SequenceMatcher(
        None, norm, state._norm_name(e["canonical_name"])).ratio())
    return "item", best


def optimize(raw_items, store=None):
    gm = state.group_map()
    items, feeds = [], {}
    corrected, questions, unresolved = [], [], []
    in_count = 0

    def add(name, qty, group, typed, flag=None):
        for it in items:
            if it["group"] == group:
                it["qty"] += qty
                feeds[group].append(typed)
                return
        line = {"name": name, "qty": qty, "checked": False, "group": group}
        if flag:
            line[flag] = True
        items.append(line)
        feeds[group] = [typed]

    for raw in raw_items or []:
        if isinstance(raw, str):
            name, qty = raw, 1
        elif isinstance(raw, dict) and raw.get("name"):
            name, qty = raw["name"], raw.get("qty", 1)
        else:
            continue
        name = (name or "").strip()
        if not name:
            continue
        qty = max(1, int(qty or 1))
        in_count += 1
        exact, fuzzy = _candidates(name)
        # An exact match on the base name does not end the inquiry:
        # "blueberries" IS a product and ALSO the stem of the organic
        # and frozen ones. All candidates stand; _pick decides.
        pool, seen = [], set()
        for e in exact + fuzzy:
            if e["item_id"] not in seen:
                pool.append(e)
                seen.add(e["item_id"])
        kind, picked = _pick(_collapse(pool, gm), name, gm)
        if kind == "question":
            questions.append({
                "item": name,
                "candidates": [{"item_id": e["item_id"],
                                "name": e["canonical_name"]}
                               for e in picked]})
        elif kind == "unresolved":
            unresolved.append(name)
            add(name, qty, "name:" + state._norm_name(name), name,
                flag="unresolved")
        else:
            rep = gm.get(picked["item_id"], picked["item_id"])
            canon = state.names().get(rep, picked["canonical_name"])
            if name != canon:
                corrected.append({"from": name, "to": canon})
            add(canon, qty, rep, name)
    by_group = {i["group"]: i for i in items}
    merged = [{"name": by_group[g]["name"], "qty": by_group[g]["qty"],
               "from": srcs}
              for g, srcs in feeds.items() if len(srcs) > 1]
    report = {"in": in_count, "out": len(items), "merged": merged,
              "corrected": corrected, "questions": questions,
              "unresolved": unresolved}
    return {"items": items, "report": report}
