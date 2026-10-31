"""Add-tab intake — the list only (owner clarification 2026-10-27).

Add is for adding items to the shopping LIST. Receipts are a
separate thing: a receipt enters as an image (the hunt finish, the
Receipts view, or chat), never through here. Two paths:

- split_list_text: pasted or typed list text -> item names, in
  deterministic code ($0). Chat text has chatter in it; when the
  split yields nothing sensible, the route falls back to one Spark
  Standard extraction call (extract_items_model).
- read_list_photo: one Spark vision read (Standard, personal) that
  classifies the photo — a list (handwritten / whiteboard) yields
  its items; a receipt (store header, priced lines, totals) is
  reported as kind "receipt" and yields nothing, so the caller can
  offer to file it as a receipt instead. Items only: a list has no
  totals, so there is no arithmetic here.
"""
import base64, json, os, re
from api.meta_client import parse_json

PROMPT_PATH = os.path.join(os.path.dirname(__file__), "..", "..",
                           "prompts", "list_photo_v1.md")

_CHATTER_LINES = {"grocery list", "shopping list", "the list", "list",
                  "please", "thanks", "thank you"}
_CHATTER_FIRST = {"thanks", "thank", "hey", "hi", "hello", "please"}
_PREFIXES = ("please get ", "please buy ", "please add ", "add ",
             "buy ", "get ", "and ",
             "i need some ", "i need ", "we need some ", "we need ",
             "i want some ", "i want ", "get me some ", "get me ")


def load_list_photo_prompt():
    text = open(PROMPT_PATH).read()
    return text.split("SYSTEM:", 1)[1].strip()


def read_list_photo(image_bytes, client, media_type="image/jpeg"):
    """Photo -> {"kind": "list"|"receipt", "items": [names]}.
    Personal data: Standard mode only (enforced in meta_client)."""
    data_uri = (f"data:{media_type};base64,"
                + base64.b64encode(image_bytes).decode())
    messages = [{"role": "system", "content": load_list_photo_prompt()},
                {"role": "user", "content": [
                    {"type": "text",
                     "text": "Read this photo for the shopping list."},
                    {"type": "image_url",
                     "image_url": {"url": data_uri}}]}]
    out, _usage, _cost = client.chat(messages, mode="standard",
                                     personal=True)
    dec = parse_json(out)
    kind = dec.get("kind")
    if kind not in ("list", "receipt", "item", "unclear"):
        kind = "list"
    if kind == "item":
        name = _clean_piece(str(dec.get("item") or ""))
        if not _sensible(name):
            return {"kind": "unclear", "items": [],
                    "reason": "I couldn't tell what this is."}
        return {"kind": "item", "items": [], "item": name,
                "confident": bool(dec.get("confident"))}
    if kind == "unclear":
        return {"kind": "unclear", "items": [],
                "reason": str(dec.get("reason") or "").strip()[:120]}
    items = []
    if kind == "list":
        for raw in dec.get("items") or []:
            name = _clean_piece(str(raw))
            if _sensible(name):
                items.append(name)
    if kind == "list" and not items:
        return {"kind": "unclear", "items": [],
                "reason": "I couldn't find anything to add in that photo."}
    return {"kind": kind, "items": items}


# --- text splitting -----------------------------------------------------

def _clean_piece(s):
    s = _lead(s)
    s = _QTY_UNIT_TAIL.sub("", s)                  # trailing qty: x2, 2 L, x 2 kg
    s = _QTY_UNIT_HEAD.sub("", s)                  # leading qty: 2 x eggs, 2 kg rice
    s = re.sub(r"\s*[x×]\s*\d+\s*$", "", s)       # trailing qty: x2
    s = re.sub(r"^\d+\s*[x×]\s+", "", s)           # leading qty: 2 x eggs
    s = _COUNT_HEAD.sub("", s)                     # leading count: 3 avocados
    return s.strip(" :.!").strip()


def _lead(s):
    """A piece without its bullet, numbering, filler and lead-in
    ("add", "please buy", "some"): what the quantity is read from."""
    s = (s or "").strip()
    s = re.sub(r"^[\-\*•–—]+\s*", "", s)          # bullets
    s = re.sub(r"^\d+\s*[.\)\:\-](?!\d)\s*", "", s)  # numbering: 1. 2) (not 1.5)
    s = re.sub(r"^\[\s?[xX ]?\]\s*", "", s)       # checkboxes
    for _ in range(3):
        stripped = re.sub(r"^(oh|okay|ok|so|well|um|uh|hmm)[,\s]+",
                          "", s, flags=re.I)
        if stripped == s:
            break
        s = stripped
    if s.lower().strip(".,!") in ("oh", "okay", "ok", "so", "well",
                                  "um", "uh", "hmm"):
        return ""
    low = s.lower()
    for p in _PREFIXES:
        if low.startswith(p):
            s = s[len(p):]
            break
    if s.lower().startswith("some "):
        s = s[5:]
    return s


# A unit typed next to a count ("milk 2 L", "2 kg rice", "rice x 2 kg").
# Free text once it is on the list; this set is only what the typed
# parser trusts as a unit so "2 percent milk" stays a name.
_UNITS = ("l|liter|liters|litre|litres|ml|kg|kgs|g|gram|grams|lb|lbs|oz|"
          "gal|gallon|gallons|pack|packs|dozen|bunch|bunches|bag|bags|"
          "box|boxes|can|cans|bottle|bottles|jar|jars")
# With a unit the amount may carry one decimal ("1.5 lb salmon"); a
# bare count stays whole.
_UNIT_TAIL = (r"\s*(?:[x×]\s*)?(?<![\d.])(\d+(?:\.\d+)?)\s*(" + _UNITS + r")\b\.?\s*[.!]*\s*$")
_UNIT_HEAD = (r"^(?<![\d.])(\d+(?:\.\d+)?)\s*(?:[x×]\s*)?(" + _UNITS + r")\b\.?\s+")
_QTY_UNIT_TAIL = re.compile(_UNIT_TAIL, re.I)
_QTY_UNIT_HEAD = re.compile(_UNIT_HEAD, re.I)
_QTY_TAIL = re.compile(r"\s*[x×]\s*(\d+)\s*[.!]*\s*$")
_QTY_HEAD = re.compile(r"^(\d+)\s*[x×]\s+")
# "3 avocados": a count before a word, but never a name that starts
# with a number ("2 percent milk", "7 up", "12 grain bread").
_COUNT_HEAD = re.compile(r"^(\d{1,2})\s+(?!(?:percent|pct|up|grain|bean|spice|layer|minute|inch)\b)(?=[^\W\d_])", re.I)
UNIT_MAX = 16


def clean_unit(unit):
    """A unit as stored: free text, one short line, no conversion."""
    return " ".join(str(unit or "").split())[:UNIT_MAX].strip()


def piece_qty_unit(piece):
    """(quantity, unit) a typed piece carries: "eggs x 2" -> (2, ""),
    "milk 2 L" -> (2, "L"), "2 kg rice" -> (2, "kg"). Quantity is 1 and
    unit "" when it carries none. _clean_piece strips both from the
    name; this reads them, so the two stay a pair."""
    s = _lead(piece)
    m = _QTY_UNIT_TAIL.search(s) or _QTY_UNIT_HEAD.match(s)
    if m:
        return amount(m.group(1)), m.group(2)
    m = _QTY_TAIL.search(s) or _QTY_HEAD.match(s) or _COUNT_HEAD.match(s)
    return (max(1, min(int(m.group(1)), 99)), "") if m else (1, "")


def amount(v):
    """An amount with a unit: 0.1 to 99, one decimal at most, whole
    numbers as int ("1.5" -> 1.5, "2" -> 2)."""
    n = max(0.1, min(round(float(v), 1), 99.0))
    return int(n) if n == int(n) else n


def piece_qty(piece):
    """The quantity a typed piece carries ("eggs x 2", "2 x eggs"),
    1 when it carries none."""
    return piece_qty_unit(piece)[0]


def _sensible(name):
    """A split piece is an item, not chatter: it has a letter (any
    script), is at most five words (an item is short; a sentence is
    prose), is not a known chatter line, and does not open with a
    greeting."""
    if not name or len(name) > 60:
        return False
    if not re.search(r"[^\W\d_]", name):  # any script, not only A-Z
        return False
    if name.lower().strip(":") in _CHATTER_LINES:
        return False
    words = name.split()
    if len(words) > 5:
        return False
    first = re.sub(r"[^a-z]", "", words[0].lower())
    if first in _CHATTER_FIRST:
        return False
    return True


def split_list_text(text):
    return [name for name, _qty in split_list_items(text)]


def _pieces(text):
    """Every raw piece of typed list text, in order (lines and
    semicolons, then commas, then "and" for sentence-style chunks)."""
    for chunk in re.split(r"[\n;]+", text or ""):
        low = chunk.strip().lower()
        sentence = ("," in chunk or low.startswith(_PREFIXES)
                    or low.count(" and ") >= 2)
        pieces = chunk.split(",")
        if sentence:
            pieces = [bit for piece in pieces
                      for bit in re.split(r"\s+and\s+", piece)]
        yield from pieces


def split_list_items_units(text):
    """Typed or pasted list text -> (name, qty, unit). Splits on lines,
    semicolons, and commas; strips bullets, numbering, checkboxes,
    lead-ins ("add", "please buy"), and trailing quantities and units.
    Duplicates collapse, order is kept."""
    out, seen = [], set()
    for piece in _pieces(text):
        name = _clean_piece(piece)
        if _sensible(name) and name.lower() not in seen:
            seen.add(name.lower())
            qty, unit = piece_qty_unit(piece)
            out.append((name, qty, unit))
    return out


def _is_prose(name):
    """A piece too long to be an item: five words or more than 60 characters."""
    return len(name) > 60 or len(name.split()) > 5


def split_text_lines(text):
    """The strict split for the open API: (items, skipped). A line with a
    sentence in it is dropped whole, so the tail of a comma-split sentence
    never becomes an item. Other pieces that are not items (a bare number)
    are skipped one by one."""
    items, skipped, seen = [], [], set()
    for line in re.split(r"[\n;]+", text or ""):
        if not line.strip():
            continue
        if any(_is_prose(_clean_piece(p)) for p in _pieces(line)):
            skipped.append(line.strip()[:30])
            continue
        for name, qty, unit in split_list_items_units(line):
            if name.lower() not in seen:
                seen.add(name.lower())
                items.append((name, qty, unit))
        skipped.extend(skipped_pieces(line))
    return items, skipped


def split_list_items(text):
    """Same split as (name, qty) pairs."""
    return [(n, q) for n, q, _u in split_list_items_units(text)]


def skipped_pieces(text, limit=5):
    """Typed pieces the split dropped as not-an-item (a bare number,
    punctuation, a sentence), so the app can say what it left out
    instead of dropping them silently. Empty pieces do not count."""
    out = []
    for piece in _pieces(text):
        raw = piece.strip()
        if raw and not _sensible(_clean_piece(piece)):
            out.append(raw[:30])
    return out[:limit]


_EXTRACT_SYSTEM = (
    "You extract shopping-list items from a chat message. Reply "
    "with JSON only, no prose: {\"items\": [\"<item name>\", ...]}. "
    "Item names are plain and short (\"oat milk\", \"eggs\"). "
    "Extract only things the writer wants to buy; skip greetings, "
    "thanks, and conversation. Never invent an item. The message may be in "
    "any language: keep each item name in the writer's own words, "
    "never translate it, and leave out verbs like \"add\".")


def extract_items_model(text, client):
    """The fallback when the deterministic split finds nothing
    sensible in the text: one Spark Standard call. Never raises —
    a failed call yields no items."""
    try:
        out, _usage, _cost = client.chat(
            [{"role": "system", "content": _EXTRACT_SYSTEM},
             {"role": "user", "content": text}],
            mode="standard", personal=True, reasoning_effort="low")
    except Exception:
        return []
    try:
        dec = json.loads(out[out.find("{"): out.rfind("}") + 1])
    except Exception:
        return []
    items = []
    for raw in dec.get("items") or []:
        name = _clean_piece(str(raw))
        if _sensible(name):
            items.append(name)
    return items


# --- one item, one row ----------------------------------------------------

def item_slug(name):
    """The id part of a typed item: lowercase, runs of anything but
    letters and digits become one dash. ASCII names give the ids they
    always did; other scripts (Hindi, Cyrillic...) keep their letters,
    so two such names never collapse into one empty id."""
    import unicodedata
    out = []
    for ch in (name or "").lower():
        keep = ch.isalnum() if ch.isascii() else unicodedata.category(ch)[0] in "LMN"
        out.append(ch if keep else "-")
    return re.sub(r"-+", "-", "".join(out)).strip("-")


def has_non_latin(text):
    """True when the text holds a letter outside Latin script."""
    import unicodedata
    return any(ch.isalpha() and "LATIN" not in unicodedata.name(ch, "LATIN")
               for ch in text or "")


def _key(name):
    """Case, spacing, punctuation and a plural "s" do not make a new
    item: "Eggs", "eggs" and "egg " share one key."""
    words = [w for w in item_slug(name).split("-") if w]
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s")
                    and not w.endswith("ss") else w for w in words)


def _names_of(e):
    return [n for n in [e.get("canonical_name")] + list(e.get("aliases") or []) if n]


def _transposed_or_one_edit(a, b):
    """True when b is a with two neighbouring letters swapped
    ("mlik" / "milk"), or, for words of six letters or more, one
    letter added, dropped or changed. Short words need the swap:
    "pear" is not "peas"."""
    if a == b or abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diff = [i for i in range(len(a)) if a[i] != b[i]]
        if len(diff) == 2 and diff[1] == diff[0] + 1 \
                and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]:
            return True
        return len(diff) == 1 and len(a) >= 6
    if min(len(a), len(b)) < 6:
        return False
    short, long_ = sorted((a, b), key=len)
    return any(long_[:i] + long_[i + 1:] == short for i in range(len(long_)))


def _fix_typos(key, vocab):
    """Each typed word that is no tracked word, but is one slip from
    exactly one tracked word, becomes that word."""
    out = []
    for w in key.split():
        if w in vocab or len(w) < 4:
            out.append(w)
            continue
        near = {v for v in vocab if _transposed_or_one_edit(w, v)}
        out.append(near.pop() if len(near) == 1 else w)
    return " ".join(out)


def _link(key, tracked):
    """tracked: [(item_id, key)]. Exact key first. Else the typed words
    must be inside exactly one tracked name and be at least half of it:
    "milk" finds "whole milk" but not "chocolate almond milk", and two
    candidates ("whole milk", "almond milk") mean no link at all."""
    for item_id, k in tracked:
        if k == key:
            return item_id
    words = set(key.split())
    # A pack size is not part of the name: "milk" is half of "whole
    # milk 1 gal" and "avocado" all of "avocados 4 ct" (retest
    # 2026-10-31 #6: "mlik" and "3 avocados" made new rows).
    hits = {item_id for item_id, k in tracked
            if (core := _core(k)) and words <= core and len(words) * 2 >= len(core)}
    return hits.pop() if len(hits) == 1 else None


_SIZE_WORDS = {"oz", "fl", "lb", "lbs", "ct", "count", "gal", "qt", "pt", "g", "kg", "ml", "l",
               "pk", "pack", "dozen", "doz"}


def _core(key):
    """A tracked key's words without its pack size ("1 gal", "32 oz")."""
    return {w for w in key.split() if w not in _SIZE_WORDS and not re.fullmatch(r"\d+(\.\d+)?[a-z]{0,3}", w)}


def existing_item_id(name, dictionary_entries, flags):
    """The item a typed name already is, or None. A tracked item
    (canonical name or alias) wins; then a typed item already on the
    list. Exact after normalizing first; then a typed name that is
    wholly inside one tracked name ("milk" -> "Whole Milk"); then the
    same after fixing a one-slip typo ("mlik"). It never picks between
    two candidates, so "milk" is not guessed into "almond milk"."""
    key = _key(name)
    if not key:
        return None
    tracked = [(e["item_id"], _key(n)) for e in dictionary_entries
               for n in _names_of(e)]
    typed = [(item_id, _key(f.get("name"))) for item_id, f in flags.items()
             if item_id.startswith("manual-") and f.get("name")]
    for pool in (tracked, typed):   # tracked wins, then typed items
        for item_id, k in pool:
            if k == key:
                return item_id
    hit = _link(key, tracked)
    if hit:
        return hit
    vocab = {w for _i, k in tracked + typed for w in k.split()}
    fixed = _fix_typos(key, vocab)
    if fixed != key:
        for pool in (tracked, typed):
            for item_id, k in pool:
                if k == fixed:
                    return item_id
        return _link(fixed, tracked)
    return None
