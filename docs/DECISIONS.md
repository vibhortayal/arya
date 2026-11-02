# Decisions log

One line for each decision the owner made, so context is not lost between
threads. Builders and designers read this before building or mocking up, and
add a line when the owner decides something new. Newest first. "Thread" is the
role or thread that took the decision. A PR number means the change that
carries it; "none" means it is a rule, not a code change. Dates marked "~" were
backfilled and are approximate. Rows backfilled from memory name the thread as best known; fix any that are wrong.

## How to add an entry
Date (UTC), the decision in one or two plain sentences, the PR or issue, and
the thread. Do not paste secrets. If the owner reverses a decision, add a new
line and mark the old one "superseded by" the new date.

## Entries

| Date | Decision | PR or issue | Thread |
|---|---|---|---|
| 2026-11-02 | "Build for Your World" framing and no money plan: README, JUDGES and SUBMISSION-DRAFT open with who Arya is for, what it does and how it frees time and mental space (a problem the owner had personally); new `docs/PRINCIPLES.md`; no plan to make money for now (revenue and partner text removed from BUSINESS.md and ROADMAP.md); the goal is that people use it and help each other. | none | Owner via coordinator |
| 2026-11-02 | Editor findings on source docs: "Ask Arya", "navigation tab" and "Map my store" in README, JUDGES, the playbook and WHAT-WE-BUILT; 23 celebration characters; PRODUCT, SPEC, IMPLEMENTATION and USER-JOURNEYS carry dated updates for the new tabs and no automatic "Everything else". USER-JOURNEYS screenshots to be re-walked, not retaken yet. | none | Doc maintainer |
| 2026-11-02 | US first: README and JUDGES.md say "Built and tested with US receipts, dollars and stores first; other markets not tested." Never write "US only". | none | Owner via coordinator |
| 2026-11-02 | Kroger: no Kroger logo (primary or integration) anywhere in the app or docs; the quest shows plain text "Kroger: Aisle 2 · …". Kroger's primary logos need prior written approval outside "Add to Cart". Terms wording: "uses Kroger's public Products API under Kroger's Developer Terms of Service" and "not affiliated with or endorsed by Kroger"; never "complies with" until every clause is met. Terms (Apr 9, 2019) read in full; our own cap is 800 calls a day; open gaps: attribution wording unchecked; Kroger's published limit unread; API tokens are now blocked from /api/stores/kroger-aisle and kroger-trip (token block list in demo_guard.py, owner go 2026-11-02; the MCP connector tools never call Kroger), which closes the 5.e.2 gap. | none | Owner via coordinator |
| 2026-11-02 | Document the Kroger aisle hint (judge review finding 11): README Quest bullet, Help and Ask lines, and "No prices are fetched from..." in the README. It is on live, optional for a self-run copy (own Kroger keys), nothing stored. | #454 | Doc maintainer |
| 2026-11-02 | Docs workflow with three roles: Researcher (market research thread), Doc maintainer, Editor (the Fable 5.1 thread "Edit docs as a judge would", which reads the repo cold). The Editor checks each new or rewritten reader-facing docs PR before it merges. Written in AGENTS.md. | #452 | Coordinator |
| 2026-11-02 | The bottom bar is called the "navigation tab", and its editor is "Customize navigation tab" (was "Customize bar" and "Make the bar yours"). The Today editing card is "Customize your \"Today\" screen". Applied in the app text, Tour, guide, Help, Ask knowledge and docs. (12:15Z) | #446 | Doc maintainer |
| 2026-11-02 | Own Meta key (BYOK) is not used. The code stays in the repo, unfinished and switched off, and is not part of the demo. Do not set `ARYA_KEY_VAULT_SECRET`. Supersedes the "built and tested, currently disabled" line below. (12:17Z) | #447, #391, #393 | Doc maintainer |
| 2026-11-02 | "Used it" on a use-soon item moves the item to Suggestions. Arya never adds an item to a list by itself, and an item already on a list gets no use-by question. Supersedes the 2026-10-29 "Used it" line. (05:50Z) | #444 | Builder |
| 2026-11-02 | Local judge setup: a judge runs Arya with `docker compose up --build` and their own Meta key. Demo Town on, registration open (no waitlist), groups on, no Google. | #432, #441 | Builder |
| 2026-11-02 | Everything in "After the hackathon" is ideas the owner is thinking about, not commitments. What ships now is a limited-scope MVP. | #430 | Doc maintainer |
| 2026-11-02 | Own Meta key (bring your own key) stays in the docs as built and tested, currently disabled: not enough time to polish the rollout, and the owner is still deciding when to turn it on. Superseded by 2026-11-02 12:17Z (not used). | #430, #391, #393 | Doc maintainer |
| 2026-11-02 | Stores moved off the Spending screen; each (i) explains only its own row. | #440 | UI/UX designer and builder |
| 2026-11-02 | Muse is first on the "Use Arya from your own AI app" setup screen, with other apps folded away. | #426 | UI/UX designer and builder |
| 2026-11-02 | Bottom bar is Today, Spending, Quest, Ask Arya, More. Lists lives under More. | #416 | UI/UX designer and builder |
| 2026-11-02 | No automatic "Everything else" list; it exists only if the user makes one. | #419 | Product and backend builder |
| 2026-11-02 | Every item belongs to a list. An add uses the list you name, else the only list (auto-filed), else asks "Which list?". With no lists, create one first. | #427 | Product and backend builder, UI/UX |
| 2026-11-02 | Receipt line edit: any group member may edit a line (name, quantity, price); only the person who filed the receipt may delete it. The printed total never changes. | #414 | Product and backend builder |
| 2026-11-02 | The licence stays parked. The organizers say no specific licence is required and any source-available licence is fine if the repo is public, so the repo stays "all rights reserved" and public for now. | #438 | Owner, Doc maintainer |
| 2026-11-02 | Open-source and model disclosure: README "Built with" table and `NOTICE.md`, including Muse Spark Open under the Muse Model License and the line "Built with Muse Spark Open". | #438 | Doc maintainer |
| 2026-11-02 | Voice add uses a Listening card with one "Stop and send" and Cancel; no live words. | #410 | UI/UX designer and builder |
| 2026-11-02 | Push reminders are ON, with a greyed Reminders row where it cannot be used. | #408 | UI/UX designer and builder |
| 2026-11-02 | OAuth sign-in and API webhooks are skipped before Nov 4. | none | Coordinator |
| 2026-11-02 | A coordinator relay counts as the owner's word for every role. | #385 | Doc maintainer |
| 2026-11-01 | Muse Spark Open is "hosted on Baseten" in every doc; the README gains a tech stack and deployment table. | #425 | Doc maintainer |
| 2026-11-01 | Privacy wording: never write "Meta may train" in the app or docs. Spark and Wonder run in Meta's Standard mode (content not used to train Meta models), and nothing more is claimed. A community tier is only an idea. | #380, #428 | Doc maintainer, Security review |
| 2026-11-01 | Spark runs on the Standard tier (not Contributor). The live setting is `ARYA_SPARK_TIER=standard` on `muse-spark-1.3`. | none | Coordinator |
| 2026-11-01 | Deploy freeze from Nov 4, 6PM ET until the owner lifts it. Ops may deploy `main` after the Tester's smoke test and a green `/health`, and rolls back on failure. | none | Ops |
| 2026-11-01 | Hide the Contributor-tier warning in app copy: Ops strings no longer say "may train". | #432 | Product and backend builder |
| ~2026-10-31 | No freeze dates. Only the Nov 4 submission date stands (the deploy freeze above is the one exception). | none | Coordinator |
| ~2026-10-31 | Demo is a fresh private sandbox for every visitor; no deploy during judging. | none | Demo and submission readiness |
| ~2026-10-29 | List and Quest are both core. PWA only, React screens only, no per-user spend cap. | none | Coordinator |
| 2026-10-29 | "Used it" on a use-soon item adds it back to a list: the usage-chosen list, else the "Which list?" picker. Superseded by 2026-11-02 05:50Z (goes to Suggestions). | #96 | Expiry thread |
