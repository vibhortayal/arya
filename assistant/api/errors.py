"""What a shopper may read when a call fails (owner, 2026-11-01).

Meta API failures already carry a plain sentence (meta_client.ModelError).
Anything else that looks like raw machine text (an HTTP status line, a
JSON payload, a Python or network error) is logged here and replaced by
a plain sentence, so no route echoes it to the app."""
import logging
import re

log = logging.getLogger("arya.errors")

GENERIC = "Arya couldn't finish that just now. Try again in a minute."
_RAW = re.compile(r"HTTP \d{3}|[{}\[\]]|Traceback|Errno|urlopen|<urlopen|errno|Exception|Error\b|"
                  r"content_policy|status_code|https?://|\bjson\b", re.I)


def safe_detail(e, limit=200):
    from api.meta_client import ModelError
    text = str(e).strip()
    if isinstance(e, ModelError):
        return text[:limit]
    if not text or _RAW.search(text):
        log.warning("hid raw error from the app: %r", text[:500])
        return GENERIC
    return text[:limit]
