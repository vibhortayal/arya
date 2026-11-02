"""Every dollar limit and cap the owner can change from the Ops screen
(2026-11-01). A value set in Ops lives in site.json ("settings", and
"overrides" per account) and applies within seconds on every worker. A
value never set in Ops falls back to the environment variable, then to
the default below: nothing changes until the owner changes it.

Ops values are held to a safe range, so a typo cannot switch protection
off. The environment is trusted as before (0 still means off there)."""
import os

from api import site_flags

# key: env name, default, (lo, hi) Ops range, kind, label, group, note
REGISTRY = {
    "hourly_freeze_usd": ("ARYA_USER_HOURLY_FREEZE_USD", 1.0, (0.1, 50), "usd", "Hourly freeze", "account",
                          "Pauses an account's paid reads when it spends more than this in one hour."),
    "freeze_hours": ("ARYA_USER_FREEZE_HOURS", 24, (1, 168), "int", "Freeze length (hours)", "account", ""),
    "heavy_monthly_usd": ("ARYA_USER_HEAVY_MONTHLY_USD", 3.0, (0.5, 100), "usd", "Heads-up per month", "account",
                          "A quiet notice on the usage screen."),
    "monthly_ceiling_usd": ("ARYA_USER_MONTHLY_CEILING_USD", 5.0, (1, 200), "usd", "Monthly ceiling", "account",
                            "Paid reads pause until the 1st."),
    "own_key_hourly_usd": ("ARYA_OWN_KEY_HOURLY_USD", 5.0, (0.5, 100), "usd", "Hourly freeze, own key", "account",
                           "A load guard on accounts reading with their own Meta key."),
    "daily_budget_usd": ("ARYA_DAILY_BUDGET_USD", 10.0, (1, 100), "usd", "Daily budget, real app", "app", ""),
    "demo_daily_budget_usd": ("ARYA_DEMO_DAILY_BUDGET_USD", 2.0, (0.5, 100), "usd", "Daily budget, demo", "app", ""),
    "demo_session_budget_usd": ("ARYA_DEMO_SESSION_BUDGET_USD", 0.40, (0.05, 5), "usd", "Per demo visit", "app", ""),
    "scan_daily_frames": ("ARYA_SCAN_DAILY_FRAMES", 120, (10, 1000), "int", "Store-scan frames per day", "caps",
                          "Per account, about $0.013 a frame."),
    "own_key_signups_per_day": ("ARYA_OWN_KEY_SIGNUPS_PER_DAY", 25, (1, 1000), "int", "Own-key sign-ups per day",
                                "caps", "New accounts that bring their own Meta key."),
    "places_daily_lookups": ("ARYA_PLACES_DAILY_LOOKUPS", 50, (5, 1000), "int", "Store lookups per day", "caps",
                             "Per own-key account (Google Places)."),
    "kroger_daily_calls": ("ARYA_KROGER_DAILY_CALLS", 800, (10, 5000), "int", "Kroger calls per day", "caps", ""),
    "mcp_rate": ("ARYA_MCP_RATE", 600, (10, 5000), "int", "MCP calls per hour", "caps", "Per token."),
    "feedback_mail_cap": ("ARYA_FEEDBACK_MAIL_CAP", 20, (1, 200), "int", "Feedback emails per day", "caps", "To you."),
    "waitlist_notify_per_hour": ("ARYA_WAITLIST_NOTIFY_PER_HOUR", 10, (1, 100), "int", "Waitlist emails per hour", "caps", ""),
    "demo_auth_rate": ("ARYA_DEMO_AUTH_RATE", 120, (10, 2000), "int", "Demo sign-ins per hour", "caps", ""),
}
ACCOUNT_KEYS = tuple(k for k, v in REGISTRY.items() if v[5] == "account")
EFFORTS = ("low", "medium", "high")


def _cast(key, v):
    if isinstance(v, bool):
        return None
    kind = REGISTRY[key][3]
    try:
        return int(v) if kind == "int" else float(v)
    except (TypeError, ValueError):
        return None


def default(key):
    env, dflt = REGISTRY[key][0], REGISTRY[key][1]
    raw = os.environ.get(env)
    v = _cast(key, raw) if raw not in (None, "") else None
    return dflt if v is None else v


def in_range(key, v):
    lo, hi = REGISTRY[key][2]
    return v is not None and not isinstance(v, bool) and lo <= v <= hi


def get(key, user=None):
    """Account override, then the Ops value, then env, then default."""
    doc = site_flags.raw()
    if user and key in ACCOUNT_KEYS:
        v = _cast(key, (doc.get("overrides") or {}).get(str(user).lower(), {}).get(key))
        if in_range(key, v):
            return v
    v = _cast(key, (doc.get("settings") or {}).get(key))
    return v if in_range(key, v) else default(key)


def by_env(env_name, fallback):
    for k, spec in REGISTRY.items():
        if spec[0] == env_name:
            return get(k)
    return fallback


def validate(key, v):
    """None hands the setting back to the environment. Raises ValueError."""
    if key not in REGISTRY:
        raise ValueError(f"unknown setting {key}")
    if v is None:
        return None
    n = _cast(key, v)
    if not in_range(key, n):
        lo, hi = REGISTRY[key][2]
        raise ValueError(f"{key} must be between {lo} and {hi}")
    return n


def snapshot():
    """Everything the Ops screen needs, with the source of each value."""
    doc = site_flags.raw()
    mine = doc.get("settings") or {}
    out = {}
    for k, (env, dflt, rng, kind, label, group, note) in REGISTRY.items():
        out[k] = {"value": get(k), "default": default(k), "env": env, "range": list(rng), "kind": kind,
                  "label": label, "group": group, "note": note, "set": k in mine and in_range(k, _cast(k, mine[k]))}
    return out
