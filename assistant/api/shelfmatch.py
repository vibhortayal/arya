"""Item -> shelf matching for Quest hunts (item–shelf matching).

A hunt stop used to sit wherever the route order put it, and the
cloud driver's label chip named the shelves nearest the marker's
path position — never the item. "Organic Milk" could sit under a
"Pasta Shelf" chip. This module matches each session item to a
shelf-graph label, so stops sit at the shelf the item belongs to:

1. Deterministic pass ($0): normalized token overlap between the
   item name and the graph's named labels, scored by token rarity
   across labels (a token found in one label outweighs a token
   found in many). A confident, unambiguous win matches here.
2. Model pass (the rest): ONE batched Muse Spark 1.3 Standard call
   — session lists are personal data, so Standard only
   (MODEL-POLICY rule 3) — with the unmatched items and the full
   named-label list. The model returns a label from the list or
   NONE; an invented label is discarded, never stored.
3. Verdicts are cached in shelf_matches.json keyed by graph +
   normalized item name (the judged.json pattern), nulls included,
   so a repeat item never costs a second call.

Matching never raises into session creation: a model failure leaves
items unmatched, and a session completes with unmatched stops.
Unmatched items keep their list order after the matched stops,
which walk in shelf order.
"""
import json, os, re

from api import state
from api.curator import _tokens

MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "pwa", "models")
UNIDENTIFIED = "Unidentified Shelf"
CACHE_FILE = "shelf_matches.json"

_SYSTEM = (
    "You match grocery list items to the shelf labels observed in "
    "one store. You are given the store's shelf labels and a list of "
    "items. For each item, answer with the ONE label from the list "
    "where a shopper would find that item, or null when no label "
    "fits. Never invent a label. Reply with JSON only, no prose: "
    "{\"matches\": {\"<item name>\": \"<label or null>\"}}"
)

_graphs = None          # key -> graph dict (module cache)
_label_index = {}       # key -> {label: {"u": float, "side": str|None}}


def _key(name):
    """Store identity across naming shapes: "Trader Joe's" (a
    session's display name) and "trader-joes" (the graph's store
    key) are the same store once punctuation is gone."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def load_graphs():
    """All shipped shelf graphs, keyed by store. Data-driven: a new
    store's graph is a new folder under pwa/models/, nothing here
    changes."""
    global _graphs
    if _graphs is not None:
        return _graphs
    graphs = {}
    base = os.path.abspath(MODELS_DIR)
    if os.path.isdir(base):
        for entry in sorted(os.listdir(base)):
            path = os.path.join(base, entry, "shelf-graph.json")
            if not os.path.isfile(path):
                continue
            try:
                graph = json.load(open(path))
            except Exception:
                continue
            graphs[_key(graph.get("store") or entry)] = graph
    _graphs = graphs
    return graphs


def graph_for(store_name):
    return load_graphs().get(_key(store_name))


def named_labels(graph):
    """The graph's named labels — the only labels an item may match.
    "Unidentified Shelf" regions and unlabelled regions are graph
    honesty, not destinations."""
    labels = []
    for stop in graph.get("stops", []):
        for shelf in stop.get("shelves", []):
            lab = shelf.get("label")
            if lab and lab != UNIDENTIFIED and lab not in labels:
                labels.append(lab)
    return labels


def label_index(graph):
    """label -> {"u", "side"}: where a matched stop sits. The first
    stop in walk order where the label appears wins; a later
    occurrence with a side replaces a side-less first sighting
    (the driver needs a side to place the marker)."""
    key = _key(graph.get("store"))
    if key in _label_index:
        return _label_index[key]
    index = {}
    for stop in graph.get("stops", []):
        for shelf in stop.get("shelves", []):
            lab = shelf.get("label")
            if not lab or lab == UNIDENTIFIED:
                continue
            cur = index.get(lab)
            if cur is None:
                index[lab] = {"u": stop["u"], "side": shelf.get("side")}
            elif cur["side"] is None and shelf.get("side") is not None:
                cur["side"] = shelf.get("side")
    _label_index[key] = index
    return index


# --- deterministic pass -------------------------------------------------

def _tokset(name):
    """Content tokens of a name, lightly singularized so "cookies"
    meets "Cookie" — the curator's tokenizer minus its units."""
    out = set()
    for t in _tokens(name or ""):
        if t.endswith("s") and len(t) > 3:
            t = t[:-1]
        out.add(t)
    return out


def _label_tokens(label):
    return _tokset(label) - {"shelf", "shelve"}


def deterministic_match(item_name, graph):
    """The graph label an item plainly belongs to, or None.
    Score = sum over shared tokens of 1/(labels containing the
    token): a rare token ("milk", in one label) is strong evidence;
    a common one ("cheese", in three) is not, on its own. A match
    needs score >= 0.5 and a clear winner after tie-breaks
    (score, then the tighter label, then walk order)."""
    item_tokens = _tokset(item_name)
    if not item_tokens:
        return None
    labels = named_labels(graph)
    index = label_index(graph)
    tokenized = {lab: _label_tokens(lab) for lab in labels}
    df = {}
    for toks in tokenized.values():
        for t in toks:
            df[t] = df.get(t, 0) + 1
    scored = []
    for lab, toks in tokenized.items():
        shared = item_tokens & toks
        if not shared:
            continue
        score = sum(1.0 / df[t] for t in shared)
        scored.append((-score, len(toks), index[lab]["u"], lab))
    if not scored:
        return None
    scored.sort()
    best = scored[0]
    if -best[0] < 0.5:
        return None
    if len(scored) > 1 and scored[1][:3] == best[:3]:
        return None     # dead heat — the model pass may separate them
    return best[3]


# --- model pass -----------------------------------------------------------

def model_match(client, item_names, graph):
    """One batched Standard call: {item_name: label|None} covering
    every requested item (an item the reply omits counts as no
    match). Labels are validated against the graph — an invented
    label is dropped. Returns None when the call or the parse
    failed, so a transient failure is never cached as a verdict.
    Never raises."""
    labels = named_labels(graph)
    if not item_names or not labels:
        return {}
    listing = "\n".join(f"- {n}" for n in item_names)
    user = ("Shelf labels:\n" + "\n".join(f"- {lab}" for lab in labels)
            + "\n\nItems:\n" + listing)
    try:
        text, _usage, _cost = client.chat(
            [{"role": "system", "content": _SYSTEM},
             {"role": "user", "content": user}],
            mode="standard", personal=True, reasoning_effort="low")
    except Exception:
        return None
    start, end = text.find("{"), text.rfind("}")
    if start < 0:
        return None
    try:
        data = json.loads(text[start:end + 1])
    except (json.JSONDecodeError, ValueError):
        return None
    valid = set(labels)
    raw = data.get("matches") or {}
    return {name: (raw.get(name) if raw.get(name) in valid else None)
            for name in item_names}


# --- cache ------------------------------------------------------------------

def _cache():
    return state._load(CACHE_FILE, {})


def _save_cache(cache):
    state._save(CACHE_FILE, cache)


# --- entry point --------------------------------------------------------------

def annotate_items(items, store_name, client=None):
    """Match a session's items to the store's shelf graph, in place
    order: matched stops first in walking (shelf_u) order, unmatched
    after in their original list order. Every item of a graphed
    session gains shelf_label / shelf_u / shelf_side / match_source
    (nulls when unmatched). A store with no graph returns the items
    untouched. Never raises."""
    graph = graph_for(store_name)
    if graph is None or not items:
        return items
    index = label_index(graph)
    gkey = _key(graph.get("store"))
    cache = _cache()
    gcache = cache.setdefault(gkey, {})
    cache_dirty = False

    pending = []
    for it in items:
        it["shelf_label"] = None
        it["shelf_u"] = None
        it["shelf_side"] = None
        it["match_source"] = None
        lab = deterministic_match(it["name"], graph)
        if lab is not None:
            _apply(it, lab, index, "exact")
            continue
        norm = state._norm_name(it["name"])
        if norm in gcache:
            if gcache[norm] is not None:
                _apply(it, gcache[norm], index, "model")
            continue
        pending.append(it)

    if pending and client is not None:
        verdicts = model_match(client, [it["name"] for it in pending],
                               graph)
        for it in pending if verdicts is not None else []:
            lab = verdicts.get(it["name"])
            norm = state._norm_name(it["name"])
            if norm not in gcache:
                gcache[norm] = lab
                cache_dirty = True
            if lab is not None:
                _apply(it, lab, index, "model")
    if cache_dirty:
        _save_cache(cache)

    matched = sorted((it for it in items if it["shelf_u"] is not None),
                     key=lambda it: it["shelf_u"])
    unmatched = [it for it in items if it["shelf_u"] is None]
    return matched + unmatched


def _apply(it, label, index, source):
    spot = index[label]
    it["shelf_label"] = label
    it["shelf_u"] = spot["u"]
    it["shelf_side"] = spot["side"]
    it["match_source"] = source
