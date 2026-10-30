"""Plain email through Resend (owner, 2026-10-30), used for the waitlist
confirmation. Sign-in codes are not sent here: Supabase sends those.

Off until RESEND_API_KEY is set, so a missing key changes nothing. Sending
is best effort: a failure is logged and never blocks the person joining."""
import html
import json
import logging
import os
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
        log.warning("mail to a waitlist address failed: %s", type(e).__name__)
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
