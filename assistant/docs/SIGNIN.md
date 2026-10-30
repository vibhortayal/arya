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
   edited in the dashboard (Authentication, Email Templates), both are code only
   (`{{ .Token }}`, `{{ .ConfirmationURL }}` unused), and both end with the not-monitored
   line. The project is shared with khelo, so these templates apply to khelo's sign-ins too.

   **Confirm signup** (first sign-in, the "off the waitlist" email).
   Subject: `You're off the Arya waitlist`. Body:

   ```
   <h2>You're in. A spot opened up.</h2>
   <p>Welcome to Arya. Open Arya, tap <b>Sign in</b>, enter this email, then tap <b>I already have a code</b> and enter:</p>
   <p style="font-size:32px;font-weight:800;letter-spacing:6px">{{ .Token }}</p>
   <p>The code works for one hour. After that, tap <b>Email me a code</b> for a fresh one. You can also use <b>Continue with Google</b> with this same address.</p>
   <p style="color:#6b6b73;font-size:13px">This address is not monitored. For help, write to support@teamnightshift.org.</p>
   ```

   **Magic Link** (returning sign-in). Subject: `Your Arya code`. Body:

   ```
   <h2>Your Arya code</h2>
   <p>Enter this code to sign in:</p>
   <p style="font-size:32px;font-weight:800;letter-spacing:6px">{{ .Token }}</p>
   <p>It works for one hour. If you did not ask for it, you can ignore this email.</p>
   <p style="color:#6b6b73;font-size:13px">This address is not monitored. For help, write to support@teamnightshift.org.</p>
   ```

   The sender and Reply-To for these emails are set in Supabase (Project Settings, Auth, SMTP).
