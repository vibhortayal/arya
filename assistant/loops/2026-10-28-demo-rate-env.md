# Demo rate limits via env (2026-10-28)

Owner posted the demo URL in Discord and asked for tighter demo limits,
env only. The api service now reads ARYA_DEMO_DOOR_RATE /
ARYA_DEMO_AUTH_RATE from the deploy .env (defaults unchanged: 240 door
calls and 120 session mints per IP per hour). Live VM .env sets 60 / 30.
The $2/day demo budget cap is unchanged and remains the hard backstop.
