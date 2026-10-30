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
2. **The code emails** are sent by Supabase, not the app (also when the owner approves
   someone on the Waitlist screen). `send_code` asks for a code with `create_user: true`,
   so Supabase picks the template by whether that address has signed in before. Both are
   edited in the dashboard (Authentication, Emails), both are code only (`{{ .Token }}`,
   `{{ .ConfirmationURL }}` unused), both carry an "Open Arya" button that links the plain site
   (`https://arya.teamnightshift.org`, never a login link), both end with the not-monitored line, and both are styled
   with Arya's colours and type. The styled originals, with copy buttons, are in the owner's
   artifact https://claude.ai/artifact/MqVD7GHNGv14L5AW4NZWee and are repeated here. The
   sender and Reply-To for these emails are set in Supabase (Project Settings, Auth, SMTP).

   **Confirm signup** (first sign-in). Subject: `You're off the Arya waitlist: {{ .Token }}`

   ```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1B1B1E"><tr><td style="padding:28px 24px">
<div style="font-size:20px;font-weight:700;color:#C2410C;margin-bottom:20px">Arya</div>
<div style="font-size:22px;font-weight:700;line-height:1.25;margin-bottom:8px">You're off the waitlist.</div>
<div style="font-size:15px;line-height:1.5;color:#55555C;margin-bottom:20px">Welcome to Arya. Type this code into the app to sign in:</div>
<div style="background:#F4F4F6;border-radius:12px;padding:18px;text-align:center;font-size:34px;font-weight:700;letter-spacing:8px;font-family:Menlo,Consolas,monospace;color:#1B1B1E">{{ .Token }}</div>
<div style="margin-top:18px;text-align:center"><a href="https://arya.teamnightshift.org" style="display:inline-block;background:#C2410C;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:999px">Open Arya</a></div>
<div style="font-size:14px;line-height:1.5;color:#55555C;margin-top:18px">The code works for 1 hour and only once. If you didn't ask to sign in, you can ignore this email and nothing happens.</div>
<div style="border-top:1px solid #D9D9DE;margin-top:24px;padding-top:14px;font-size:12px;line-height:1.5;color:#8B8B93">Sent by Arya, the grocery list that learns your store.<br>This address is not monitored. For help, write to support@teamnightshift.org.</div>
</td></tr></table>
   ```

   **Magic Link** (returning sign-in). Subject: `Your Arya code: {{ .Token }}`

   ```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1B1B1E"><tr><td style="padding:28px 24px">
<div style="font-size:20px;font-weight:700;color:#C2410C;margin-bottom:20px">Arya</div>
<div style="font-size:22px;font-weight:700;line-height:1.25;margin-bottom:8px">Welcome back.</div>
<div style="font-size:15px;line-height:1.5;color:#55555C;margin-bottom:20px">Type this code into Arya to sign in:</div>
<div style="background:#F4F4F6;border-radius:12px;padding:18px;text-align:center;font-size:34px;font-weight:700;letter-spacing:8px;font-family:Menlo,Consolas,monospace;color:#1B1B1E">{{ .Token }}</div>
<div style="margin-top:18px;text-align:center"><a href="https://arya.teamnightshift.org" style="display:inline-block;background:#C2410C;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:999px">Open Arya</a></div>
<div style="font-size:14px;line-height:1.5;color:#55555C;margin-top:18px">The code works for 1 hour and only once. If you didn't ask to sign in, you can ignore this email and nothing happens.</div>
<div style="border-top:1px solid #D9D9DE;margin-top:24px;padding-top:14px;font-size:12px;line-height:1.5;color:#8B8B93">Sent by Arya, the grocery list that learns your store.<br>This address is not monitored. For help, write to support@teamnightshift.org.</div>
</td></tr></table>
   ```

## Google's screen names Arya (own Google sign-in, flagged)

With only the Supabase Google provider, Google's screen reads "continue to
<project>.supabase.co". Setting `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`
(VM `.env`) makes `/auth/google` use Arya's own authorization-code flow instead
(`api/google_oauth.py`, callback `/auth/google/callback`). Unset = the Supabase flow, unchanged.
Email codes and the waitlist are untouched.

Google Cloud setup (project "Arya", Google Auth Platform):
1. Branding: app name Arya, support email, authorized domain `teamnightshift.org`, home page
   `https://arya.teamnightshift.org`, privacy policy on that domain. Publish to production
   (only `openid email` scopes, so no sensitive-scope review; logo/name verification is separate).
2. Clients: create an OAuth client, type Web application, authorized redirect URI
   `https://arya.teamnightshift.org/auth/google/callback`.
3. Put the client ID and secret in the VM `.env`, then `docker compose up -d`.
