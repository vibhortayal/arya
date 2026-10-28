"""Zero-entry teach: name the section in one shelf photo.

The guided mapper always knew its segments in advance — somebody
had to type the aisle's name and side before a photo could teach
anything, and a brand-new store had no way in at all (owner,
2026-10-28: "no user is going to enter data"). This reader is the
way in: one people-scrubbed frame, one vision read, and the section
names itself.

The read runs on the SCRUBBED jpeg (people already blurred by the
route's scrub step), never on a raw frame — the same privacy rule
as every other map capture. Model choice follows MODEL-POLICY:
a high-volume helper read, so Muse Spark Standard, low effort.
"""
import base64, json, re

_SYSTEM = """You look at one photo of a grocery store shelf or aisle, taken by a shopper who is mapping the store, and you name the section it shows.

Answer with ONLY a JSON object, no other text:
{"label": "<section name>", "items": ["<product>", "..."]}

Rules for "label":
- If an aisle sign is readable, use it exactly, like "Aisle 4".
- Otherwise name the section for what is shelved, like "Frozen", "Produce", "Dairy wall", "Pasta and sauces", "Bakery".
- At most 40 characters. No quotes inside it.
Rules for "items":
- Up to 8 product or category names clearly visible on the shelves.
- Skip anything you cannot actually read or recognize.
If the photo shows no shelf or aisle (a floor, a cart, a checkout, people), answer {"label": "", "items": []}."""


def _clean_label(raw):
    label = re.sub(r"\s+", " ", str(raw or "")).strip().strip('"').strip()
    return label[:60]


def _clean_items(raw):
    out = []
    for it in raw if isinstance(raw, list) else []:
        name = re.sub(r"\s+", " ", str(it or "")).strip()
        if name and name.lower() not in {x.lower() for x in out}:
            out.append(name[:60])
        if len(out) == 8:
            break
    return out


def parse_read(text):
    """The model's answer, defensively. Raises ValueError when there
    is no JSON object in it at all; an empty label is a valid read
    (the photo showed no shelf), not an error."""
    m = re.search(r"\{.*\}", text or "", re.DOTALL)
    if not m:
        raise ValueError("the section read came back unreadable")
    try:
        data = json.loads(m.group(0))
    except ValueError:
        raise ValueError("the section read came back unreadable")
    if not isinstance(data, dict):
        raise ValueError("the section read came back unreadable")
    return {"label": _clean_label(data.get("label")),
            "items": _clean_items(data.get("items"))}


def read_section(client, jpeg, media_type="image/jpeg"):
    """One vision read of a scrubbed shelf frame. Returns
    {"label": str, "items": [str]}; label is "" when the frame
    shows no shelf. Raises ValueError on an unreadable answer."""
    data_uri = (f"data:{media_type};base64,"
                + base64.b64encode(jpeg).decode())
    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": [
            {"type": "text", "text": "Name the section in this photo."},
            {"type": "image_url", "image_url": {"url": data_uri}}]}]
    text, _usage, _cost = client.chat(messages, mode="standard")
    return parse_read(text)
