# Sign-in and the waitlist

Arya is invite-only while `ARYA_REGISTRATION_OPEN=0`. Mockup the owner approved
(2026-10-30): https://claude.ai/artifact/PbmjdCuX1TVqkcFGZPJR9E

## What a person sees

- **Public sheet** (Sign in on the landing): email code first, Google second,
  "I already have a code", and "Not invited yet? Join the waitlist". No password form.
- **Email code, not invited:** the answer is the same for every address (no probing), so
  the code step says "If <email> is invited, a code is on its way" and offers
  "No email after a minute? You may not be invited yet" with a Join the waitlist button.
- **Google, not invited:** Google proves the address, so the sheet says
  "Not on the list yet" and one tap joins the waitlist (`/auth/supabase` answers 403
  with `{detail, email}`; `pwa/auth-callback.js` keeps the address for the page).
- **Team sign-in:** `/team` (or `/?team=1`) shows the password form for beta testers
  and test agents. Hiding it is tidiness, not security: `/auth/login` stays rate limited
  (8 wrong tries per 15 minutes per IP) and new accounts stay closed. The form also
  stays on the public sheet while the first account is set up, while registration is open,
  and where email sign-in is not set up. Agents that call the API can use API tokens.

## Emails

1. **"You're on the Arya waitlist"** is sent by the app through Resend when an address is
   first added (`api/mailer.py`). Off until `RESEND_API_KEY` is set. Env:
   `RESEND_API_KEY`, `ARYA_MAIL_FROM` (default `Arya <arya@mail.teamnightshift.org>`),
   `ARYA_MAIL_REPLY_TO` (default `support@teamnightshift.org`, forwarded by Cloudflare
   Email Routing), `ARYA_PUBLIC_URL` (the app's web address for the "Try the demo" link,
   `https://arya.teamnightshift.org`). A failed send is logged and never blocks joining.
2. **The code email** is sent by Supabase (Magic Link template, `{{ .Token }}`), and also
   when the owner approves someone on the Waitlist screen. Its subject and body are edited
   in the Supabase dashboard (Auth, Email Templates). Suggested wording for the invite:
   subject "You're off the Arya waitlist"; body "You're in. A spot opened up. Your sign-in
   code: {{ .Token }}. Open Arya, tap Sign in, enter this email, then tap "I already have a
   code". The code works for one hour. After that, tap "Email me a code" for a fresh one.
   You can also use Continue with Google with this same address." The same template is used
   for every code email, so a neutral subject such as "Your Arya sign-in code" also works.
   End the body with: "This address is not monitored. For help, write to support@teamnightshift.org." Replies and the sender address for these emails are set in Supabase (SMTP settings).
