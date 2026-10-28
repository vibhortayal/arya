# Build plan — to Nov 4, 2026, 9:00 PM ET

## Gate

**The VGGT spike verdict.** A 90-second Trader Joe's aisle stretch (4:00–5:30 of the Chino Hills walkthrough), 90 frames, is in reconstruction now.

- **Pass** (cloud reads as the store, camera path is smooth): build the mini-hunt in full 3D per this plan.
- **Soft** (geometry holds, texture is washy): hybrid — 3D for the wide walk, real shelf photos pinned at item stops.
- **Fail**: pivot the client to the 2.5D map (top-down aisle graph + shelf photos), same hunt design, and say so honestly in the submission.

## Scope for the submission

IN:
1. One playable treasure hunt in one reconstructed TJ aisle (Three.js in the PWA).
2. List-in by photo: a handwritten note becomes the hunt's quest log via Muse.
2b. **The Optimizer (step one):** duplicate adds merge into quantities, typos correct against the dictionary with undo, genuine ambiguity (fresh vs frozen, organic vs not) asks with one-tap chips and blocks the start until answered. Deterministic code + the existing dictionary/Curator doctrine; Spark only for cases code cannot settle.
3. Three list items placed on the shelf graph by SAM 3.1 + Spark labeling, with the collect flow, timer, and finish state.
4. Receipt finish: snap → verified → hunt scored (engine endpoints already live).
5. **Community, demo-grade (owner call 2026-10-27: "the clincher for hackathon virality"):** a playable **Shop-Off** — two players, same store, same list, live race state, winner by verified receipt timestamp (photo finish); the household leaderboard; badges awarded live on the score screen from verified data; **Friends** (handle-based add/accept, challenge shortcuts) and **Profile** (handle, stats, badge shelf, mapper credits — public card only, private data never shown).
6. **Session-aware Muse connector:** chat adds land in today's session for the named store (engine add endpoint exists; session wrapper is the new work).
7. **Profile archive view:** receipt photos with their digitized records under Profile (engine already stores both sides; this is a view). Analysis: Spend is live; Patterns and Trends stay future — named placeholders in the UI, built post-hackathon.
8. Demo video + submission package per SUBMISSION.md.

OUT (rollout story only): whole-store maps, live relocalization, escape-room skin, public registration, global boards, mapper leaderboards.

## Sequence

| When | Work |
|---|---|
| Oct 27 | Spike verdict **PASS**; doc pack + DISCUSSION.md; Stages A (engine), B (playable UI), C (cloud driver, live) built and deployed; **final wireframes approved** (Quest + Brain B1–B6 — the build reference) |
| Oct 27–28 | Intake parity (Photo + Voice doors on the Meta API, demo account live); Brain restyle to the approved wireframes; shelf graph for the demo aisle (SAM 3.1 segments + Spark labels) |
| Oct 28 | Quest UI rebuild to the Hunt v2 wireframes (Discussion 45) — gated on owner approval of the wireframes; uncheck-after-grab is an acceptance item |
| Oct 30–31 | Hunt polish: route builder, quest log, Quest/Express refinements |
| Nov 1 (cont.) | List-in by photo wired to hunts; receipt finish wired to scoring; **feature freeze** |
| Nov 1–2 | **Wonder QA pass (owner-approved stage):** Playwright sweeps the frozen build (every screen and door, phone-size screenshots, console errors, flow transcripts) on the demo household and a test account only. Coverage includes full Quest playthroughs, not just screens: session start, the Optimizer (merge/correct/ask), a complete hunt on each scene driver (Cloud, Aisle, Strip) with collects and "Not here" Spotter reports, the receipt finish and scoring, Shop-Off create/join, Community boards, friends add/accept, and the badge/profile surfaces. Muse Wonder reviews the evidence — screenshots against the wireframes, transcripts, logs — and files findings (functional, UI, UX) with proposed fixes as code on a branch. Every finding is verified against the app before a fix lands; fixes go through the normal review gate (suite green, sweep re-run). The findings report (filed / verified / fixed / false positive) is kept as submission evidence |
| Nov 2 | Re-sweep clean; end-to-end rehearsal on the demo household; fix pass |
| Nov 3 | Demo video filmed in the store during a real shop (Discussion 36); submission package assembled |
| Nov 4 | Owner reviews the complete package; submit before 9:00 PM ET — only on his explicit go-ahead |

## Risks

- **Cloud quality** — gated above; two fallbacks ready.
- **Phone performance** — decimate the cloud; the graph, not the cloud, carries logic.
- **Time** — the engine (intake, ledger, patterns) is already live; the new surface is the hunt client only. If the client slips, the demo narrows to one aisle and three items rather than cutting the receipt finish.
