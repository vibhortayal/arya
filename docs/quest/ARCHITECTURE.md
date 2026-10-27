# Architecture

## Principle

Perception at the edge, reasoning in the platform, the game on the phone.
Two data planes that never mix:

| Plane | Contents | Owner | Shared? |
|---|---|---|---|
| Platform | Store models: point clouds, camera paths, shelf graphs, product placements | The platform | Yes — every player of that store |
| Account | Lists, receipts, inventory, patterns, spend | The household | Never |

A walkthrough video upload goes to the platform plane. A receipt or list upload goes to the account plane. Store modeling is never tied to an account; personal parsing is never published.

## Pipelines

### 1. Store mapping (platform)

`walkthrough video → frames → VGGT → point cloud + camera path → shelf graph → playable store`

- Frames sampled ~1 fps from a continuous aisle stretch; blur and duplicate frames dropped. (90 frames covers a strong aisle run.)
- **VGGT / VGGT-Ω** infers camera poses, depth, and the dense point cloud in one pass. Output GLB.
- **SAM 3.1** segments individual products on key shelf frames.
- **Muse Spark** reads shelf labels and price cards on those frames and names the segments.
- A human-light review pass confirms placements. Result: a shelf graph — zones, shelves, product positions in cloud coordinates.
- The cloud is decimated for phone delivery; the graph carries the game logic, the cloud carries the look.

### 2. List intake (account)

`photo of note / whiteboard / paste / voice / Muse chat → structured list in a session`

- Handwriting and messy lists are a perception task, not a form. Output: items, quantities, and the store the user picked.
- **The Muse connector writes lists too** (owner requirement): "add oat milk and eggs to my Trader Joe's list" in chat lands in today's session for that store — created on the spot if none exists. The connector's add path already exists in the engine (`POST /api/list/add`, proven live); Quest makes it session-aware, so chat, the PWA, and the hunt all edit one list.
- Arya's pattern engine annotates the list: what the household usually buys, what is probably still in the pantry, what is due. The hunt loads with judgment, not just text.

### 2b. The Optimizer — step one before the game (owner requirement)

Every list, from every door, passes the optimizer before a hunt can start. It runs after the store is picked, because resolution needs that store's catalog plus the household dictionary. Three moves, in order:

1. **Merge.** The same product added repeatedly becomes one line with summed quantity ("milk" ×3 adds → Milk, qty 3). Always silent, always shown in the optimizer report.
2. **Correct.** Typos and fuzzy names ("bluberry", "OJ", "chix") resolve against the household dictionary and the store catalog. High-confidence corrections apply and are shown with an undo; nothing is corrected silently.
3. **Ask.** If a name can be two real products — blueberries: fresh organic vs frozen; milk: whole vs oat — the optimizer does not guess. If the household buys exactly one kind, it defaults and notes it; if it buys several, the player gets one-tap chips (the two kinds, or "both"). Unresolvable names stay as typed and flagged. This is the Curator's doctrine — never merge distinct products — applied at list time.

Output: the clean list plus a one-line report (in → out · merged · corrected · questions). Unanswered questions block the start button; "keep as typed" is always an available answer. Fuzzy matching is deterministic code first; Spark judges only the cases code cannot settle.

### 3. The hunt (client)

- Three.js renders the store cloud in the PWA. No install, no app store.
- The quest log is the list, ordered by the shelf graph into a route. Camera glides the camera path; the next item's position pulses; collect = tap (v1) or shelf check.
- Positioning v1 is model-relative: follow the trail, tap to collect. No indoor GPS, no live relocalization — that is the v2 headline feature.
- Quest mode (play) and Express mode (rush) are two modes on one state machine (see GAME-DESIGN.md).

### 4. Settle (account)

`receipt photo → Muse Spark → arithmetic verification → patterns, ledger, inventory`

- Totals must reconcile or the lines queue for review — the client proposes, Arya disposes.
- Returns net against purchases; patterns count kept items only.
- The verified haul scores the finished hunt and updates what the next hunt suggests.
- The finish snap is taken in the app, so the **Profile archive stores the receipt photo with its digitized record** (account plane, private). Receipts filed through Muse chat keep the standing rule: structured data only, the image stays with the user.

## Components

| Component | State | Notes |
|---|---|---|
| Arya engine (intake, dictionary, review queue, ledger, patterns, staple judge, Ask Arya) | **Live** — vibhortayal/arya | Per-account file state, token-gated connector, 60 tests |
| Muse connector for Arya | **Live** | Data enters Arya through the user's own Muse — zero perception spend server-side |
| Store registry + model store (platform plane) | New | Store ID, location, mapper credit, cloud + graph versions |
| Mapping pipeline (VGGT + SAM + Spark labeling) | Spike running | One TJ aisle; verdict gates scope |
| Hunt client (Three.js in the PWA) | Scaffold verified | PLY viewer + walk animation proven on synthetic data |
| Hunt generation (list + shelf graph → route) | To build | Deterministic code; no model spend |

## Cost rules

- Math, routing, and pattern facts are computed in code at $0.
- Muse Spark 1.3 Standard, low reasoning effort, cached prefixes, for volume judgment (staple judge, hunt narration). Personal data is Standard-only.
- Contributor tier is eval/synthetic only — it may train on inputs; real household data never touches it.
- Per-account daily spend cap already enforced in the engine ($10/day global ceiling today).
- VGGT runs on free/open tooling for the hackathon; production mapping is a batch GPU job per store, amortized across all its players.

## Known limits, stated

- VGGT weights are non-commercial licensed. Fine for the hackathon; a commercial launch needs a license path or a successor model.
- A walkthrough contains other shoppers. Platform contributions need a policy (faces, store permission) before public rollout — parked for post-hackathon.
- One aisle reconstructs well before a whole store does. The demo scopes to what the spike proves.
