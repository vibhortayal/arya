"""Item extras (Pack slice, contract C2).

A planned item can carry a few small, optional facts beyond name and
quantity: a note ("12 ct"), a brand or variant, who added it, where the
item came from, and an aisle label. They ride along from the Pack screen
through the Optimizer into the hunt session. Deterministic code only:
no model, no Meta call, and no import of meta_client.
"""

EXTRA_KEYS = ("note", "variant", "by", "src", "aisle")
SRC_ALLOWED = ("list", "typed", "starter", "usual", "due", "carried",
               "queued", "added")
MAX_LEN = 60
_CAPS = {"by": 24}


def clean_extras(raw):
    """The valid extras of a raw item dict, as {key: str}.

    Each value must be a string; it is stripped and capped (60
    characters, 24 for "by"). Empty values and unknown keys are
    dropped. "src" must be one of SRC_ALLOWED."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k in EXTRA_KEYS:
        v = raw.get(k)
        if not isinstance(v, str):
            continue
        v = v.strip()[:_CAPS.get(k, MAX_LEN)].strip()
        if not v:
            continue
        if k == "src" and v not in SRC_ALLOWED:
            continue
        out[k] = v
    return out


def apply_extras(line, raw):
    """Copy the cleaned extras of raw onto line. A value already on
    the line wins (first non-empty wins). Returns line."""
    for k, v in clean_extras(raw).items():
        if not line.get(k):
            line[k] = v
    return line
