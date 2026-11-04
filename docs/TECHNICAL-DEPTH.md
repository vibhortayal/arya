# Design decisions, and what comes next

I built Arya as one well-defended single-server app on purpose. The window was for the product, not for a fleet of servers. This page has three parts: what is built and holds up for a few dozen people at once, what I know is weak, and the plan to grow past that. The dated choices are in the [decision log](DECISIONS.md), what was made and when is on the [build page](WHAT-WE-BUILT.md), and the unbuilt ideas are in the [roadmap](ROADMAP.md). What runs today is in [Architecture](../assistant/docs/ARCHITECTURE.md).

## What is built?

- **Code does money, timing and lists at no model cost.** The ledger, patterns and derived list are rebuilt from the receipts, with no model involved, so they cannot drift. Every model call goes through one module that enforces the personal-data rule. (Architecture 0.3, 0.4)
- **Safe writes on one box.** Atomic JSON writes, a per-file lock, a per-request memo, and a full Postgres copy of every account document on the live site. (Architecture 0.5)
- **Layered spend control.** A daily ceiling for the app, a separate one for the demo, a per-visit share, per-account monthly and hourly limits, and an Ops switch to pause paid reads or change the photo reader without a deploy. Every call writes a ledger row. ([Model policy](../assistant/docs/MODEL-POLICY.md))
- **Background work that survives a restart.** Receipt batches and store scans keep a pending list on disk and resume after a deploy.
- **Live sync that already spans processes.** Shared-list changes use Postgres `LISTEN/NOTIFY`, one listener per process. (Architecture 0.8)
- **A demo that cannot touch real data.** Each visit writes to an in-memory sandbox with a size cap.
- **Security basics.** Hashed session and token secrets, a strict script CSP, upload caps at the proxy, throttled sign-in, and people pixelated out of shelf photos before anything is stored.
- **Measured.** A [scale simulator](../assistant/docs/SCALE-SIM.md) and a read-only performance pass on 2026-11-02. The Today screen takes about 65 ms alone, about 1.1 s with 10 people at once and about 4 s with 30. That was on a development machine, not the live server.

## What do I know is weak?

These are the findings from my own architecture audit of 2026-11-01 that still hold. Each is tied to a phase of the [scalability design](SCALABILITY-DESIGN.md). Two audit items are already closed: `/health` reports the running commit, and the photo reader is Spark first (see the [model map](../JUDGES.md#which-model-does-which-job)). That second change took the cost pressure off receipt batches.

| What | Why it matters | Fixed in |
|---|---|---|
| One process, one interpreter lock, no cap on model reads in the request thread pool | A burst of photo reads can slow pages that never call a model | Phases 4 and 6 |
| The spend guard reads the whole ledger file on each paid call; password sign-in hashes on the event loop | Both block other requests while they run, and the ledger grows with use | Phase 2 for the ledger; the hashing is not in the plan yet |
| Spend checks are "check, then spend", with no reservation | Parallel reads can overshoot a limit | Phase 6 |
| The ledger is an estimate from a price table, never reconciled with the provider's console | What Arya thinks it spent and what was billed can differ | Not in the plan yet; a manual weekly check |
| Postgres mode stores documents whole, with no version column or pool | Two processes could lose an update silently | Phase 2, before any second process |
| Sessions, demo visits, rate buckets and the receipt queue live in memory or files | A deploy drops every demo visit | Phases 3 and 5 |
| One worker reads every account's receipt batch in order; no cap on batches parked on disk | One big import makes the next person wait | Phase 5 |
| Store-map photos are base64 in one JSON file rewritten per photo | The first wall the simulator found | Phase 7 |
| Saves mirror the whole document to Postgres inside the request | A slow database slows a list tick | Phase 1 |
| `restore.sh` wipes the data folder before extracting; the off-site backup is set up by hand | A bad archive or a lost VM could lose data | Phase 0 |
| Tests run in CI only on demand (my choice, to keep the loop fast) | A broken merge can reach the server unless someone runs the suite | Not a scaling item; revisit after judging |
| Concurrency rules are by convention (each writer must remember the lock) | Easy to get wrong as more people touch the code | Phase 2 |

## What is the plan to grow it?

[Scalability design](SCALABILITY-DESIGN.md) has nine phases (0 to 8, the numbers the table above uses). Each phase is switched on by settings. Each has a rollback and a number to measure:

0. Baseline: request timing, a metrics endpoint and a live load test.
1. Hot cache: a short-lived cache, and the Postgres mirror off the request path.
2. Postgres master: Postgres as the master copy, with versioned updates.
3. Shared short-lived state: sessions, demo visits and rate buckets in a shared store.
4. Several processes.
5. Queue and workers: a job queue for receipt, scan and reminder jobs.
6. Model gateway: concurrency caps and spend reservation.
7. Object storage for photos.
8. Cloud provider.

Versioned writes come before a second process, and nothing runs before judging ends. It is a plan, not a promise.
