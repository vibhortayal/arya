# Run Arya on your own computer

For judges and anyone who wants to try Arya locally with their own Meta key.
The live demo needs none of this: https://arya.teamnightshift.org, then "Try it
now".

## What do I need?
- **Docker** with Compose (Docker Desktop, or Docker Engine and the Compose
  plugin). Nothing else: no Python, no Node.
- **A Meta Model API key** for the AI parts. Make one at dev.meta.ai (API keys,
  then Create API key); it starts with `LLM_`. It is optional: without it the
  app and the demo household open and work, but anything that reads a photo,
  answers in Ask or listens to your voice says "This copy of Arya has no Meta key, so AI features are off".
- A phone-size window. On a laptop, make the browser about 390 px wide. Camera
  and microphone steps need a phone, and a phone browser only allows the camera
  on https. On a phone reaching your computer over plain `http://` on your
  network, use the receipt upload instead of the camera.

## How do I start it?
Get the code with a shallow clone, which is small and fast. A normal
`git clone` also works and brings the full history (much larger):

```bash
git clone --depth 1 https://github.com/vibhortayal/arya.git && cd arya
```

Then, from the repository root:

```bash
cp .env.local.example .env       # then put your key on the MODEL_API_KEY line
docker compose up --build
```

Open http://localhost:8080. The first build takes a few minutes. On the first
visit a "Create your account" sheet opens. That makes the one real account on
this copy: a username (lowercase letters, digits and `_ % + @ -`, and `.` after the first character) and a password. Use it
to snap or upload your own receipts and see them read and saved, which is
Arya's core feature. Or tap **Close** on the sheet and then **Try it now** for the demo
household. The demo keeps nothing: it reads a receipt live on the screen but does not
save it. Ask, photos of a list and voice work there with your key. The first start also writes the demo
household into a Docker volume; later starts keep what is there.

## How do I get a Meta API key?
To run the live model calls from your own checkout, make a Meta Model API key
just for this (dev.meta.ai, API keys, Create API key). Put it on the
`MODEL_API_KEY` line of your local `.env`. Never commit a filled `.env`: the
`MODEL_API_KEY=` line in `assistant/deploy/.env.example` is blank on purpose.
The key is sent only to `api.meta.ai`. Meta keys have no spending cap of their
own, so set a usage limit on your Meta billing page, and delete the key at Meta
when you are done. Photo receipts: see `ARYA_PHOTO_READER` below.

## Settings (`.env`)
Only one is required.

| Setting | What it does | Default |
|---|---|---|
| `MODEL_API_KEY` | Your Meta key. Receipts, Ask, voice, notes and store scans use it | empty (AI off) |
| `ARYA_STORE` | Where data is kept. `json` means files in a Docker volume | `json` |
| `ARYA_PHOTO_READER` | `auto`: Muse Spark reads a photo first, Muse Wonder re-reads one the checks flag. Or `spark`, `wonder` | `auto` |
| `ARYA_SPARK_TIER` | Spark runs on Meta's Standard plan | `standard` |
| `GOOGLE_PLACES_API_KEY` | Optional. Store picker suggestions from the Google Places API. Empty means no suggestions | empty |
| `BASETEN_API_KEY` | Optional. Muse Spark Open, the staple judge's second seat. Leave empty to skip that check | empty |
| `ARYA_LOCAL_PORT` | Use another port if 8080 is taken | `8080` |

Ignore everything else in `assistant/deploy/.env.example`: Supabase, email,
Google, push and the other settings are for the live site. They default off.

## What does it cost me?
Every model call runs on your key and your Meta account. The demo household
keeps its visit limit locally too: about $0.40 of live reads per visit and
$2 a day for the demo (`ARYA_DEMO_SESSION_BUDGET_USD`,
`ARYA_DEMO_DAILY_BUDGET_USD`). Pricing is in
[`assistant/docs/MODEL-POLICY.md`](../assistant/docs/MODEL-POLICY.md).

## How do I stop it, reset it or change the port?
- After editing `.env`, run `docker compose up -d`. `docker compose restart` does
  not re-read `.env`.
- Stop: press Ctrl+C, or `docker compose down`. Your data stays.
- Start over (wipes the volume; the next start writes the demo household again):
  `docker compose down -v`.
- Another port: set `ARYA_LOCAL_PORT` in `.env`.

## How is it different from the live site?
- One container, plain `http://localhost`, no Caddy and no certificate. The
  session cookie is set to work over plain http (`ARYA_INSECURE_COOKIE=1`).
- JSON files in a volume instead of Supabase. No email, so you sign in with the
  username and password you made on the first visit.
- Demo Town (the simulated neighborhood, labelled simulated) is on, as on the
  live demo, and registration is open, so **Start my own list** on the landing
  page makes any number of accounts. Groups are on, so two local accounts can
  share a list. There is no waitlist, no Google and no email code. The
  `compose.yaml` here does not touch the live deploy, which uses
  `assistant/deploy/docker-compose.yml`.

Next, a step-by-step tour of every feature on your copy:
[`docs/TRY-THE-FEATURES.md`](TRY-THE-FEATURES.md).

## Can I run it without Docker?
This route was followed step by step from a fresh clone by the Tester, without a
key (the receipt step was not run). The Docker route above was run twice on a Linux server with no Meta key. A cold
build (about 55 seconds) from a fresh shallow clone, in a browser at 390x844:
start, `/health`, creating an account, signing in again, the demo, the no-key Ask
and receipt messages and Start shopping all worked. An earlier run with cached
build layers, through direct requests: editing `.env` and the port setting worked.
The cold build needed that test machine's proxy certificate added, because its
network re-signs HTTPS (see "What if something goes wrong?"). Reading a receipt,
photos, voice and a working Ask answer need a real key and were not run on either
route. Still untested: a real Meta key, Docker Desktop on a Mac or Windows
laptop, and a real phone.

You need Python 3.12 or newer (3.13 worked) and Node 22. From the repository root:

```bash
python3 -m venv .venv && .venv/bin/pip install -r assistant/api/requirements.txt
cd assistant/web && npm ci && npm run build && cd ..
../.venv/bin/python -m harness.make_demo_household data
MODEL_API_KEY=<your key> ../.venv/bin/python -m uvicorn api.main:app --port 8000
```

In `MODEL_API_KEY=<your key>`, put your key in place of `<your key>`, or nothing
at all for no-key mode (`MODEL_API_KEY=`). Pasting the angle brackets as they
are fails in bash. The snippet leaves your shell in `assistant/`.

Open http://localhost:8000; http://localhost:8000/health answers `ok` when the
server is up. These steps were tested on Linux only; macOS and Windows have not
been tried. Without a key, Ask shows the "no Meta key" message;
on this route its last words, "docker compose up -d", do not apply: set
`MODEL_API_KEY` and start uvicorn again. To open it from a phone at
`http://<your computer's IP>:8000`, make uvicorn listen on your network address (its
`--host` option) and set `ARYA_INSECURE_COOKIE=1` before it; without that, sign-in may not stick
over plain http. I have not tested this on a phone. For front-end work, `npm run dev` in
`assistant/web` starts Vite.

## Let your AI agent set it up
If you use a coding agent that can run commands on your computer, paste this
prompt to it. It uses the no-Docker route, which the Tester followed from a
fresh clone (without a key). Read the prompt first: it asks the agent to run
commands on your machine.

```text
Set up Arya on my computer so I can try it. Repository:
https://github.com/vibhortayal/arya

1. Clone the repository into a new, empty folder, cd into it, and open
   docs/RUN-IT-YOURSELF.md.
2. Follow the section "Can I run it without Docker?" step by step. If
   something goes wrong, troubleshoot it as you normally would to get Arya
   running, and use "What if something goes wrong?" in the guide. Do not
   edit any file that git tracks; the folders the guide's commands create
   (.venv, node_modules, the web build, the data folder) are expected.
3. Use the no-key demo mode: run the uvicorn command with MODEL_API_KEY= left
   empty (nothing after the equals sign). Do not ask me for a
   key, a password or any secret, and do not paste or print one.
4. When the server is up, tell me the local address (http://localhost:8000),
   that /health answers "ok", and the sign-in steps: tap Close on the "Create
   your account" sheet, then tap "Try it now" for the demo household. Tell me
   to make the browser about 390 px wide.
```

Without a key, anything that reads a photo or answers in Ask says "This copy of
Arya has no Meta key, so AI features are off". That is expected.

## How do I run the tests?
```bash
(cd assistant && ../.venv/bin/python -m unittest discover -s tests)
(cd assistant/web && npm test)
```
Current counts and known failures: [`STATUS.md`](../STATUS.md). One web test,
`pack.test.tsx` "arrow keys pack and skip", is flaky in a full run and passes alone. CI is
manual-only (`.github/workflows/tests.yml`).

## What if something goes wrong?
- **"This copy of Arya has no Meta key, so AI features are off. Put your key from
  dev.meta.ai after MODEL_API_KEY= in the .env file, then run: docker compose up -d"**
  `MODEL_API_KEY` is empty, or the container was not recreated after you
  edited `.env`. Fix `.env`, then `docker compose up -d`.
- **Receipts says "Reading paused" and there is no key.** The same cause as
  above: add the key and run `docker compose up -d`.
- **Port already in use.** Set `ARYA_LOCAL_PORT` to a free port.
- **A model error with a key set.** The key was rejected or has no credit;
  check it at dev.meta.ai.
- **The build fails to download packages, with a certificate error (pip or npm).** A
  proxy that re-signs HTTPS is the usual cause. Build on a network without one, or
  add your proxy's certificate to Docker.
- **Docker Hub answers `429 Too Many Requests`.** The pull limit for your address
  is used up. Wait a few minutes and run the build again, or run `docker login`.
- **Status check.** `http://localhost:8080/health` answers when the app is up.

This is not the feature "Use your own Meta key" in the live app's Settings,
which is unfinished, switched off and not used (see [After the hackathon](ROADMAP.md)). Here
the key is the server's key, set in `.env`.
