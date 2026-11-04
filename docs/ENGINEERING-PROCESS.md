# Engineering process: how we built Arya

Arya was built in nine days (Oct 27 to Nov 4, 2026) by one person working with a team of AI agents, each with one job. This section shows how that worked and what it left behind. The pages here are the working documents themselves, lightly cleaned for the public: operator-only steps, server paths and key names are removed.

## How the work moved

I talk to one coordinator. The coordinator hands each piece of work to a role, and each role has its own place in the process:

- **Builders** open the pull requests. UI work starts with a phone-size mockup I approve first.
- **The Tester** runs each change at phone sizes and reports PASS or what to fix.
- **Ops** merges and deploys, checks the app's health afterwards, and rolls back if it fails.
- **The Doc maintainer** keeps the Help tab, guide, Ask knowledge, status and decisions in step with what shipped.
- **The Editor** reads reader-facing docs cold, as a judge would, before they merge.

The order for a change is: idea, name the role, approval, mockup (UI only), pull request, Tester, merge, doc check, smoke test on main, deploy, live checks.

## Where to read more

- [Agent rules](../AGENTS.md): the contract every agent follows (hard rules, roles, workflow).
- [Decisions](DECISIONS.md): every choice I made, with the date.
- [Status](../STATUS.md): what was live and what was not, batch by batch.
- [Operations](../assistant/docs/OPS.md): how the app is watched.
- [Scale simulation](../assistant/docs/SCALE-SIM.md): the load test.
- [Submission draft](../assistant/docs/SUBMISSION-DRAFT.md): the portal write-up.
- [Quest build plan](archive/quest/BUILD-PLAN.md) (archived) and [design discussion](quest/DISCUSSION.md): how the game was planned and argued out.
