"""Ask Arya guardrails (owner, 2026-11-04; design in
arya-ask-guardrails/FINDINGS-AND-DESIGN.md section 2).

Input guard: the latest message the person typed is checked against
high-confidence phrases only (an override verb with a target, a prompt
leak, secrets, other accounts). A hit gets a fixed refusal with no
model call and counts a strike. Three strikes in 24 hours pause Ask:
a demo visit (its session and its IP, hashed) for 24 hours, a real
account until the owner unlocks it in Ops. The owner is never locked.
Stored text (item and list names, the screen, a photo) never strikes:
the person may not have typed it.

Output guard: a reply that quotes the system prompt, holds something
shaped like a key, or links off Arya is swapped for the refusal (no
strike: that is the model's slip, not the person's).

Pure code, no model call, $0. Nothing here stores message text or an
IP address in clear."""
import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
import unicodedata

from api import state

log = logging.getLogger("arya.ask_guard")

STRIKES_TO_LOCK = 3
WINDOW_S = 24 * 3600
DEMO_LOCK_S = 24 * 3600
MAIL_PER_DAY = 20

REFUSAL = ("I can only help with your groceries and Arya. I can't share my "
           "instructions or anything about other accounts.")
LOCKED = ("Ask Arya is paused for this account after repeated attempts to get "
          "around its rules. Lists, Today and everything else still work.")
LOCKED_DEMO = LOCKED + " It comes back in 24 hours."

_IGNORE = r"(?:ignore|disregard|forget|override|bypass)"
_ALL = r"(?:all|any|every|the|your|my|previous|prior|above|earlier|preceding|system)"
_RULES = r"(?:instructions?|rules|prompts?|guidelines|directives|guardrails)"
_SHOW = r"(?:print|reveal|show|repeat|output|display|tell me|give me|dump|leak|write out|recite)"

# (family, pattern) on normalised text: whole phrases, never one word.
PATTERNS = [
    ("override", rf"\b{_IGNORE}\s+(?:{_ALL}\s+){{1,3}}{_RULES}\b"),
    ("override", rf"\b{_IGNORE}\s+(?:{_ALL}\s+)?(?:system|developer)\s+{_RULES}\b"),
    ("override", r"\b(?:developer|god|jailbreak|dan)\s+mode\b"),
    ("override", r"\byou\s+are\s+(?:now\s+)?(?:dan|in\s+jailbreak|jailbroken|an?\s+unrestricted)\b"),
    ("override", r"\bdo\s+anything\s+now\b"),
    ("override", r"\bjailbreak\s+(?:arya|you|yourself|this|the\s+(?:bot|assistant|ai))\b"),
    ("prompt_leak", rf"\b{_SHOW}\s+(?:me\s+)?(?:your|its|the)\s+(?:full\s+|whole\s+|exact\s+|hidden\s+|initial\s+|original\s+)?(?:system\s+prompt|system\s+message|system\s+instructions)\b"),
    ("prompt_leak", rf"\b{_SHOW}\s+(?:me\s+)?(?:all\s+)?(?:of\s+)?your\s+(?:full\s+|whole\s+|exact\s+|hidden\s+|initial\s+|original\s+)?(?:instructions|prompt|rules)\b"),
    ("prompt_leak", r"\bsystem\s+prompt\b.{0,40}\b(?:verbatim|word\s+for\s+word|exactly|in\s+full)\b"),
    ("prompt_leak", r"\b(?:about\s+arya|household\s+snapshot)\b.{0,30}\bverbatim\b"),
    ("prompt_leak", r"\bwhat\s+(?:is|was)\s+your\s+(?:system\s+prompt|initial\s+prompt)\b"),
    ("secrets", rf"\b(?:{_SHOW}|what\s+(?:is|are)|send|paste)\b.{{0,30}}\b(?:your|the|arya'?s|the\s+server'?s|meta'?s)\s+(?:\w+\s+)?(?:api|secret|access|private)\s*[-_ ]?\s*keys?\b"),
    ("secrets", r"\bmeta_api_key\b|\bmodel_api_key\b|\bresend_api_key\b"),
    ("secrets", rf"\b{_SHOW}\b.{{0,30}}\b(?:env(?:ironment)?\s+var(?:iable)?s?|\.env)\b"),
    ("other_users", r"\b(?:other|another|all|every)\s+(?:users?|accounts?|households?|people|customers)(?:'s|')?\s+(?:data|receipts|emails?|lists|passwords?|spend|purchases|information|info)\b"),
    ("other_users", r"\b(?:everyone|everybody)(?:'s|s)\s+(?:data|receipts|emails?|passwords?)\b"),
    # Spanish
    ("override", r"\b(?:ignora|olvida|omite)\s+(?:todas\s+)?(?:las\s+|tus\s+)?(?:instrucciones|reglas)\b"),
    ("prompt_leak", r"\b(?:muestra|muestrame|revela|imprime|dime)\s+(?:tu|el|las|tus)\s+(?:prompt|instrucciones|mensaje\s+del\s+sistema)\b"),
    ("secrets", r"\bclaves?\s+(?:de\s+)?api\b"),
    # Hindi
    ("override", r"(?:निर्देशों|नियमों)\s*(?:को)?\s*(?:अनदेखा|नज़रअंदाज़|नजरअंदाज|भूल)"),
    ("prompt_leak", r"सिस्टम\s*प्रॉम्प्ट"),
    ("secrets", r"एपीआई\s*की"),
]
_COMPILED = [(f, re.compile(p)) for f, p in PATTERNS]


def normalise(text):
    """Lower case, accents off (Latin only), quotes and spaces tidied."""
    s = unicodedata.normalize("NFKD", str(text or ""))
    s = "".join(c for c in s if not (unicodedata.combining(c) and ord(c) < 0x0900))
    s = unicodedata.normalize("NFC", s).lower()
    s = s.replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", s).strip()


def check(text):
    """The pattern family a typed message hits, or None."""
    s = normalise(text)
    if not s:
        return None
    for family, rx in _COMPILED:
        if rx.search(s):
            return family
    return None


def latest_user_text(history):
    """The newest message the person typed (a string), or ""."""
    for m in reversed(history if isinstance(history, list) else []):
        if isinstance(m, dict) and m.get("role") == "user":
            c = m.get("content")
            return c if isinstance(c, str) else ""
    return ""


# ---- output guard ----------------------------------------------------

_KEYISH = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}|\bLLM[|_][A-Za-z0-9_|-]{10,}"
                     r"|\b[A-Fa-f0-9]{40,}\b|[A-Za-z0-9+/]{48,}={0,2}")
_URL = re.compile(r"https?://([^/\s)\]>\"']+)", re.I)
_OK_HOSTS = ("teamnightshift.org",)


def _host_ok(host):
    h = host.lower().split(":")[0].rstrip(".")
    return any(h == d or h.endswith("." + d) for d in _OK_HOSTS)


def bad_reply(reply, system_text):
    """Why a reply must not be shown (a short code), or None."""
    r = str(reply or "")
    if not r:
        return None
    sys_norm = re.sub(r"\s+", " ", system_text or "")
    flat = re.sub(r"\s+", " ", r)
    for i in range(0, max(0, len(flat) - 60) + 1, 15):
        part = flat[i:i + 60]
        if len(part) == 60 and part in sys_norm:
            return "prompt"
    if _KEYISH.search(r):
        return "key"
    if any(not _host_ok(m.group(1)) for m in _URL.finditer(r)):
        return "link"
    return None


# ---- strikes and locks ------------------------------------------------

_lock = threading.Lock()


def _path():
    return os.path.join(state.base_dir(), "ask-locks.json")


def _load():
    try:
        with open(_path()) as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        doc = {}
    if not isinstance(doc, dict):
        doc = {}
    doc.setdefault("rows", {})
    doc.setdefault("mail", {})
    return doc


def _save(doc):
    state.write_json_atomic(_path(), doc)


def _salt(doc):
    if not doc.get("salt"):
        doc["salt"] = secrets.token_hex(16)
    return doc["salt"]


def _h(salt, value):
    return hashlib.sha256((salt + "|" + str(value)).encode()).hexdigest()[:12]


def keys_for(user=None, demo=False, session=None, ip=None):
    """The lock keys for a caller: a real account by name; a demo visit
    by its session and its IP, both hashed, so a new demo cookie from
    the same address stays locked."""
    if not demo:
        return ["user:" + str(user)] if user else []
    with _lock:
        doc = _load()
        had = bool(doc.get("salt"))
        salt = _salt(doc)
        if not had:
            _save(doc)
    out = []
    if session:
        out.append("demo:" + _h(salt, session))
    if ip:
        out.append("ip:" + _h(salt, ip))
    return out


def _live(row, now):
    """A row's lock, if it still holds (a demo lock ends by itself)."""
    if not row or not row.get("locked_at"):
        return False
    until = row.get("until")
    return until is None or until > now


def locked(keys):
    """The first live lock among keys, as (key, row), or None."""
    now = time.time()
    doc = _load()
    for k in keys or []:
        row = doc["rows"].get(k)
        if _live(row, now):
            return k, row
    return None


def strike(keys, family, demo=False):
    """Count one strike on every key. Returns (strikes in the window,
    True when this strike locked)."""
    if not keys:
        return 0, False
    now = time.time()
    newly = []
    top = 0
    with _lock:
        doc = _load()
        for k in keys:
            row = doc["rows"].get(k) or {}
            hits = [s for s in row.get("strikes", []) if now - s.get("at", 0) < WINDOW_S]
            hits.append({"at": int(now), "kind": family})
            row["strikes"] = hits
            row["demo"] = bool(demo)
            if len(hits) >= STRIKES_TO_LOCK and not _live(row, now):
                row["locked_at"] = int(now)
                row["until"] = int(now + DEMO_LOCK_S) if demo else None
                row["kinds"] = sorted({s["kind"] for s in hits})
                newly.append(k)
            doc["rows"][k] = row
            top = max(top, len(hits))
        _save(doc)
    who = keys[0]
    log.warning("arya.ask_guard strike user=%s kind=%s n=%d", who, family, min(top, STRIKES_TO_LOCK))
    if newly:
        _mail_lock(keys[0], family, demo)
    return top, bool(newly)


def unlock(key):
    """The owner's unlock: the lock and its strikes go. True if found."""
    with _lock:
        doc = _load()
        if doc["rows"].pop(key, None) is None:
            return False
        _save(doc)
    return True


def list_locks():
    now = time.time()
    doc = _load()
    out = []
    for k, row in doc["rows"].items():
        if _live(row, now):
            out.append({"key": k, "locked_at": row.get("locked_at"), "until": row.get("until"),
                        "kinds": row.get("kinds", []), "demo": bool(row.get("demo"))})
    return sorted(out, key=lambda r: -(r["locked_at"] or 0))


def locked_users():
    """Real account names with a live Ask lock (for the Ops accounts list)."""
    return {r["key"][5:] for r in list_locks() if r["key"].startswith("user:")}


# ---- the owner's email ------------------------------------------------

def alert_email():
    return (os.environ.get("ARYA_ALERT_EMAIL") or "").strip()


def _mail_lock(key, family, demo):
    """One email per key per day, 20 a day in all. No message text, no
    IP, no keys: who, when, the strike kinds and where to unlock."""
    to = alert_email()
    from api import mailer
    if not to or not mailer.configured():
        return False
    day = time.strftime("%Y-%m-%d", time.gmtime())
    with _lock:
        doc = _load()
        m = doc["mail"]
        if m.get("day") != day:
            m.clear()
            m.update({"day": day, "count": 0, "keys": []})
        if key in m["keys"] or m["count"] >= MAIL_PER_DAY:
            return False
        m["keys"].append(key)
        m["count"] += 1
        row = doc["rows"].get(key) or {}
        _save(doc)
    who = ("a demo visit (" + key + ")") if demo else key[5:] if key.startswith("user:") else key
    kinds = ", ".join(row.get("kinds") or [family])
    when = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(row.get("locked_at") or time.time()))
    subject = "Arya: Ask locked for " + who
    text = (f"Ask Arya was paused for {who} at {when} after {STRIKES_TO_LOCK} attempts to get "
            f"around its rules ({kinds}).\n\n"
            + ("It unlocks by itself in 24 hours." if demo else "It stays paused until you unlock it.")
            + "\nUnlock it in Arya: Settings, Ops and health, Ask locks.\n")
    html = "<p>" + text.replace("\n\n", "</p><p>").replace("\n", "<br>") + "</p>"
    try:
        return mailer.send(to, subject, text, html)
    except Exception:  # never let the alert break the reply
        log.warning("ask_guard mail failed")
        return False
