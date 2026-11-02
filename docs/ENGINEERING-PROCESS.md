# Engineering process: how we built Arya

Arya was built in nine days (Oct 27 to Nov 4, 2026) by one owner working with a team of AI agents, each with one job. This section shows how that worked and what it left behind. The pages here are the working documents themselves, lightly cleaned for the public: operator-only steps, server paths and key names are removed.

## How the work moved

The owner talks to one coordinator. The coordinator hands each piece of work to a role, and each role has its own place in the process:

- **Builders** open the pull requests. UI work starts with a phone-size mockup the owner approves first.
- **The Tester** runs each change at phone sizes and reports PASS or what to fix.
- **Ops** merges and deploys, checks the app's health afterwards, and rolls back if it fails.
- **The Doc maintainer** keeps the Help tab, guide, Ask knowledge, status and decisions in step with what shipped.
- **The Editor** reads reader-facing docs cold, as a judge would, before they merge.

The order for a change is: idea, name the role, approval, mockup (UI only), pull request, Tester, merge, doc check, smoke test on main, deploy, live checks.

## Where to read more

- [Agent rules](/docs/internal/agents): the contract every agent follows (hard rules, roles, workflow).
- [Decisions](/docs/decisions): every choice the owner made, with the date.
- [Status](/docs/internal/status): what was live and what was not, batch by batch.
- [Operations](/docs/internal/ops): how the app is watched.
- [Scale simulation](/docs/internal/scale-sim): the load test.
- [Submission draft](/docs/internal/submission-draft): the Devpost write-up.
- [Quest build plan](/docs/quest/build-plan) and [design discussion](/docs/quest/discussion): how the game was planned and argued out.
