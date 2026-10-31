"""Owner tool: email every feedback note saved so far, in one message, to
ARYA_OPS_EMAIL (needs RESEND_API_KEY too).

    python -m harness.feedback_mail
"""
import sys

from api import feedback, mailer


def main(argv):
    notes = list(reversed(feedback.list_all()))   # oldest first
    if not notes:
        print("no feedback saved yet")
        return 0
    ok = mailer.feedback_backlog(notes)
    print(f"emailed {len(notes)} note(s)" if ok else
          "not sent (are ARYA_OPS_EMAIL and RESEND_API_KEY set?)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
