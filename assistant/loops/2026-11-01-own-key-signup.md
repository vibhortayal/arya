# 2026-11-01 Sign up with your own Meta key

Owner approved the mockup (claude.ai/artifact/B7rDvxNoEJz7DcWhNkJvx4) with three picks: one "Get your own account" entry, keep the email code, key accounts never fall back to Arya's keys. Built against the Product builder's agreed API (feat/own-key): /auth/status own_key_signup, POST /auth/own-key/start and /verify, GET /api/account/own-key `required`.

- `ui/KeySignup.tsx`: two-ways sheet (Join the waitlist / I have my own Meta key) and the key sign-up sheet: email, hidden key box, Meta key tips, terms tick, "Check key and email me a code", then the code step ("Meta accepted key …1234", Create my account). Server errors land on the right field (email has an account offers Sign in; 410 expired goes back to the form). Nothing is saved before the code.
- `screens/Login.tsx`: when own_key_signup is on (and registration is closed), the landing footer link is "Get your own account ›" and the sign-in sheet says "No account yet? Get your own account" in place of the waitlist line. Off: unchanged.
- Key accounts (`required`): Settings wording (runs on your key, Remove pauses the AI), Today card "Your Meta key stopped working" / "Add your Meta key" with Fix my Meta key (`OwnKeyAlert`). Ask already shows the fix card for own-key-fix (402/502).
- Gate it (owner): the Help topic "Use your own Meta key" shows only when /api/account/own-key says available; the Ask sign-up line is `[if byok]` in its own section (same flag as #390).
- Guide card and further Help: after BYOK is built and tested (owner). No demo preview, no Tour stop (owner).

Tests: keysignup.test.tsx (gate off keeps the waitlist, two ways, sign-in link, non-Meta key stopped, good path, server errors incl. 409 and 410), ownkey key-account test, Help gate tests. vitest 490 pass; Python failures identical by name to main (8). 390x844 run with this build against the live landing and mocked answers: /mnt/project-files/arya-byok-signup-build/.
