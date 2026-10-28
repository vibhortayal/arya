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
    try:
        dec = json.loads(out)
    except Exception:
        dec = json.loads(out[out.find("{"): out.rfind("}") + 1])
    kind = dec.get("kind")
    if kind not in ("list", "receipt"):
        kind = "list"
    items = []
    if kind == "list":
        for raw in dec.get("items") or []:
            name = _clean_piece(str(raw))
            if _sensible(name):
                items.append(name)
    return {"kind": kind, "items": items}


# --- text splitting -----------------------------------------------------

def _clean_piece(s):
    s = (s or "").strip()
    s = re.sub(r"^[\-\*•–—]+\s*", "", s)          # bullets
    s = re.sub(r"^\d+\s*[.\)\:\-]\s*", "", s)     # numbering: 1. 2)
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
    s = re.sub(r"\s*[x×]\s*\d+\s*$", "", s)       # trailing qty: x2
    s = re.sub(r"^\d+\s*[x×]\s+", "", s)           # leading qty: 2 x eggs
    return s.strip(" :.!").strip()


_QTY_TAIL = re.compile(r"\s*[x×]\s*(\d+)\s*[.!]*\s*$")
_QTY_HEAD = re.compile(r"^(\d+)\s*[x×]\s+")


def piece_qty(piece):
    """The quantity a typed piece carries ("eggs x 2", "2 x eggs"),
    1 when it carries none. _clean_piece strips the quantity from the
    name; this reads it, so the two stay a pair."""
    s = (piece or "").strip()
    m = _QTY_TAIL.search(s) or _QTY_HEAD.match(s)
    return max(1, min(int(m.group(1)), 99)) if m else 1


def _sensible(name):
    """A split piece is an item, not chatter: it has a letter, is at
    most five words (an item is short; a sentence is prose), is not
    a known chatter line, and does not open with a greeting."""
    if not name or len(name) > 60:
        return False
    if not re.search(r"[A-Za-z]", name):
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


def split_list_items(text):
    """Typed or pasted list text -> item names. Splits on lines,
    semicolons, and commas; strips bullets, numbering, checkboxes,
    lead-ins ("add", "please buy"), and trailing quantities.
    Duplicates collapse, order is kept."""
    out, seen = [], set()
    for piece in _pieces(text):
        name = _clean_piece(piece)
        if _sensible(name) and name.lower() not in seen:
            seen.add(name.lower())
            out.append((name, piece_qty(piece)))
    return out


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
    "thanks, and conversation. Never invent an item.")


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
