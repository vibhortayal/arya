"""The Quest game's profile, kept on the server (usability audit,
owner-approved 2026-10-29: one source for level, streak and stickers).

The game owns the shape (web/src/game/core/meta.ts Profile); the server
stores it whole and reads three things from it:
- xp: points earned in the game. The account's points are receipt-closed
  hunt points plus this, so Settings, Quest progress and the game all
  show one level.
- weeks: ISO weeks with a real trip ("2026-W44"). They join the receipt
  weeks in one streak, counted by the game's rule (two rest weeks).
- stickers: the one sticker album.
Practice never reaches here: the game does not save it."""
from datetime import date, timedelta

from api import state

DOC = "quest_game.json"
MAX_BYTES = 200_000


def load():
    p = state._load(DOC, None)
    return p if isinstance(p, dict) else None


def save(profile):
    """Validate and keep the game's profile; returns it, or raises
    ValueError for something that is not one."""
    import json
    if not isinstance(profile, dict):
        raise ValueError("profile must be an object")
    if len(json.dumps(profile)) > MAX_BYTES:
        raise ValueError("profile too large")
    xp = profile.get("xp", 0)
    if not isinstance(xp, (int, float)) or xp < 0:
        raise ValueError("xp must be a number, 0 or more")
    for k in ("weeks", "stickers"):
        v = profile.get(k, [])
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            raise ValueError(f"{k} must be a list of strings")
    state._save(DOC, profile)
    return profile


def xp():
    p = load() or {}
    try:
        return max(0, int(p.get("xp", 0)))
    except (TypeError, ValueError):
        return 0


def weeks():
    """The game's played weeks as (year, week) pairs."""
    out = set()
    for w in (load() or {}).get("weeks", []) or []:
        try:
            y, n = str(w).split("-W")
            out.add((int(y), int(n)))
        except ValueError:
            pass
    return out


def streak(weeks_played, today=None):
    """The game's weekly streak (meta.ts streak): this week counts once
    played, and up to two missed weeks rest the streak instead of
    breaking it when an older played week sits behind them."""
    cur = today or date.today()
    if cur.isocalendar()[:2] not in weeks_played:
        cur -= timedelta(days=7)  # this week is still open
    n = used = pending = 0
    for _ in range(520):
        if cur.isocalendar()[:2] in weeks_played:
            n += 1
            used += pending
            pending = 0
        elif n > 0 and used + pending < 2:
            pending += 1
        else:
            break
        cur -= timedelta(days=7)
    return n
