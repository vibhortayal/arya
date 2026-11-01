"""Plain email through Resend (owner, 2026-10-30): the waitlist
confirmation and the code that confirms deleting an account. Sign-in codes are not sent here: Supabase sends those.

Off until RESEND_API_KEY is set, so a missing key changes nothing. Sending
is best effort: a failure is logged and never blocks the person joining."""
import html
from api import settings as _settings
import json
import logging
import os
import threading

import time
import urllib.error
import urllib.request

log = logging.getLogger("arya.mailer")
_URL = "https://api.resend.com/emails"
_DEFAULT_FROM = "Arya <arya@mail.teamnightshift.org>"
_DEFAULT_REPLY_TO = "support@teamnightshift.org"


def reply_to():
    return os.environ.get("ARYA_MAIL_REPLY_TO") or _DEFAULT_REPLY_TO


def configured():
    return bool(os.environ.get("RESEND_API_KEY"))


def send(to, subject, text, body_html):
    """Hand one email to Resend. True if it accepted it."""
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        return False
    payload = {"from": os.environ.get("ARYA_MAIL_FROM") or _DEFAULT_FROM, "to": [to],
               "subject": subject, "text": text, "html": body_html}
    payload["reply_to"] = reply_to()   # replies ("remove") land in a real inbox
    req = urllib.request.Request(_URL, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + key,
                                          "Content-Type": "application/json",
                                          "User-Agent": "arya-api/1"})
    try:
        with urllib.request.urlopen(req, timeout=10):
            return True
    except (urllib.error.URLError, OSError, ValueError) as e:
        log.warning("mail failed: %s", type(e).__name__)
        return False


def waitlist_joined(email, app_url):
    """Tell someone they are on the waitlist. app_url is where the demo lives."""
    subject = "You're on the Arya waitlist"
    text = (
        "You're on the list.\n\n"
        "Thanks for asking to join Arya. We're letting people in a few at a time, and your spot is saved.\n\n"
        "There's nothing to do right now. The moment a spot opens for your household, "
        "we'll email you a code to sign in.\n\n"
        f"While you wait, you can try Arya with a sample household. No sign-up needed: {app_url}\n\n"
        "Joined by mistake? Ignore this email. We only write again to send your invitation.\n\n"
        f"You got this because {email} asked to join the Arya waitlist.\n"
        f"This address is not monitored. For help, or to be taken off the list, write to {reply_to()}.\n")
    e = html.escape(email)
    u = html.escape(app_url, quote=True)
    body = (
        '<div style="font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1b1b1e;max-width:520px;margin:0 auto;padding:22px">'
        '<div style="font-weight:800;font-size:22px;letter-spacing:-.02em;margin-bottom:12px">Arya</div>'
        '<h1 style="font-size:20px;margin:0 0 8px">You\'re on the list.</h1>'
        "<p>Thanks for asking to join Arya. We're letting people in a few at a time, and your spot is saved.</p>"
        "<p>There's nothing to do right now. The moment a spot opens for your household, we'll email you a code to sign in.</p>"
        "<p>While you wait, you can try Arya with a sample household. No sign-up needed.</p>"
        f'<p><a href="{u}" style="display:inline-block;background:#C2410C;color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:999px">Try the demo</a></p>'
        "<p>Joined by mistake? Ignore this email. We only write again to send your invitation.</p>"
        f'<p style="font-size:12.5px;color:#6b6b73;border-top:1px solid #ececf0;padding-top:12px">You got this because {e} asked to join the Arya waitlist.<br>This address is not monitored. For help, or to be taken off the list, write to {html.escape(reply_to())}.</p>'
        "</div>")
    return send(email, subject, text, body)


def account_delete_code(email, code, minutes):
    """The code that confirms erasing an account (owner, 2026-11-01).
    Accounts made by email code or Google have no password, so this
    email is how they prove it is really them. True if Resend took it."""
    subject = f"{code} is your code to delete your Arya account"
    text = (
        f"Someone asked to delete the Arya account for {email}.\n\n"
        f"Your code: {code}\n\n"
        "Type it in Settings to erase your lists, receipts, photos and sign-in for good. "
        f"It works for {int(minutes)} minutes.\n\n"
        "Didn't ask for this? Ignore this email. Your account stays as it is.\n\n"
        f"This address is not monitored. For help, write to {reply_to()}.\n")
    e, c = html.escape(email), html.escape(code)
    body = (
        '<div style="font:15px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1b1b1e;max-width:520px;margin:0 auto;padding:22px">'
        '<div style="font-weight:800;font-size:22px;letter-spacing:-.02em;margin-bottom:12px">Arya</div>'
        f"<p>Someone asked to delete the Arya account for <b>{e}</b>.</p>"
        "<p>Your code:</p>"
        f'<p style="font-size:30px;font-weight:800;letter-spacing:.18em;text-align:center;background:#f3f3f5;border-radius:12px;padding:14px 0;margin:8px 0 14px">{c}</p>'
        "<p>Type it in Settings to erase your lists, receipts, photos and sign-in for good. "
        f"It works for {int(minutes)} minutes.</p>"
        '<p style="color:#6b6b73">Didn\'t ask for this? Ignore this email. Your account stays as it is.</p>'
        f'<p style="font-size:12.5px;color:#6b6b73;border-top:1px solid #ececf0;padding-top:12px">This address is not monitored. For help, write to {html.escape(reply_to())}.</p>'
        "</div>")
    return send(email, subject, text, body)


# --- owner heads-up when someone joins the waitlist (owner, 2026-10-31) ---
_notify_lock = threading.Lock()
_notify_sent = []          # times of recent owner mails (this process)
_notify_capped_at = None   # when the "paused" notice last went out


def notify_to():
    """Dedicated address first, else the ops address. Empty = off."""
    return (os.environ.get("ARYA_WAITLIST_NOTIFY_EMAIL") or os.environ.get("ARYA_OPS_EMAIL") or "").strip()


def waitlist_owner_notice(email, app_url, now=None):
    """Mail the owner that a new address joined. Called only for a new
    address (a repeat never gets here). At most ARYA_WAITLIST_NOTIFY_PER_HOUR
    (default 10) mails an hour; past that one "paused" notice goes out and
    the rest stay silent (they are all on the Waitlist screen). Best effort;
    never raises, never logs the address."""
    try:
        to = notify_to()
        if not to or not configured():
            return False
        now = time.time() if now is None else now
        cap = max(1, int(_settings.get("waitlist_notify_per_hour")))
        global _notify_capped_at
        with _notify_lock:
            _notify_sent[:] = [t for t in _notify_sent if now - t < 3600]
            if len(_notify_sent) >= cap:
                if _notify_capped_at is not None and now - _notify_capped_at < 3600:
                    return False
                _notify_capped_at = now
                paused = True
            else:
                _notify_sent.append(now)
                paused = False
        where = "Settings, then Waitlist, at " + app_url
        stamp = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(now))
        if paused:
            subject = "[Arya] Many waitlist joins: emails paused for an hour"
            text = (f"More than {cap} people joined the waitlist within an hour, so single emails "
                    f"are paused until it calms down. Everyone is on the list: {where}\n")
        else:
            subject = "[Arya] New waitlist join"
            text = f"{email} asked to join the waitlist at {stamp}.\n\nReview: {where}\n"
        body = "<pre style=\"font:14px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap\">" + html.escape(text) + "</pre>"
        return send(to, subject, text, body)
    except Exception as e:  # noqa: BLE001
        log.warning("waitlist owner notice failed: %s", type(e).__name__)
        return False

# --- feedback to the owner (owner, 2026-10-31) -----------------------------
# Each new feedback note is mailed to ARYA_OPS_EMAIL. Off while that or
# RESEND_API_KEY is unset. Best effort: never blocks the person sending.
# A day cap (ARYA_FEEDBACK_MAIL_CAP, default 20, per process) keeps the demo
# box from filling the inbox; the daily ops report still counts every note.
_mail_day = {"day": "", "n": 0}


def _fmt_note(n):
    when = time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(n.get("at", 0)))
    who = n.get("user", "") + (f" <{n['contact']}>" if n.get("contact") else "")
    return n.get("kind", ""), who, when, n.get("text", "")


def feedback_note(note):
    to = os.environ.get("ARYA_OPS_EMAIL", "")
    if not to or not configured():
        return False
    day = time.strftime("%Y-%m-%d", time.gmtime())
    if _mail_day["day"] != day:
        _mail_day.update(day=day, n=0)
    if _mail_day["n"] >= int(_settings.get("feedback_mail_cap")):
        return False
    _mail_day["n"] += 1
    kind, who, when, text = _fmt_note(note)
    body = f"New {kind} from {who}\n{when}\n\n{text}\n"
    return send(to, f"[Arya] New {kind}: {text[:60]}", body,
                '<pre style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">'
                + html.escape(body) + "</pre>")


def feedback_backlog(notes):
    """One email with every note given (oldest first)."""
    to = os.environ.get("ARYA_OPS_EMAIL", "")
    if not to or not configured() or not notes:
        return False
    parts = []
    for n in notes:
        kind, who, when, text = _fmt_note(n)
        parts.append(f"[{kind}] {who}, {when}\n{text}")
    body = f"{len(notes)} feedback note(s) so far:\n\n" + "\n\n---\n\n".join(parts) + "\n"
    return send(to, f"[Arya] All feedback so far ({len(notes)})", body,
                '<pre style="font:14px/1.5 -apple-system,Segoe UI,sans-serif;white-space:pre-wrap">'
                + html.escape(body) + "</pre>")
