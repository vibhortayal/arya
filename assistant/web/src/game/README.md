# Quest game (spike)

Quest turns a grocery list into a trip through the store: a store map
with a route, sections to clear, fog over parts nobody has mapped, a
golden item, and a finish with points, stickers, a weekly streak and
store growth. There are no timers, no lives and nothing to lose.

This folder is self-contained, so the Arya app can adopt it as is.

## Layout

| Path | What it is |
| --- | --- |
| `core/` | Plain TypeScript rules with no React, DOM or engine: the layout template, route, trip reducer, progression and data source. Tested in `core.test.ts`. |
| `fx/` | Feel: particles, coin pop, fly-to-basket, confetti (`juice.ts`) and synth sounds, buzz and voice guide (`feel.ts`). |
| `ui/` | React screens: hub, store picker, play (Pixi store map and section view), finish, album, and the practice coach. |
| `QuestGame.tsx` | The root component and its screen state machine. |
| `store.ts` | Where the profile is kept between trips. |
| `assets.ts` | Where pictures come from. |
| `lab/` | A standalone page to play it with no sign-in. |

## Play it

```
npx vite --config vite.lab.config.ts    # http://localhost:5174/quest-lab.html  (?reset = new player)
npx vite build --config vite.lab.config.ts
```

The lab is kept out of the app build and its service worker.

## Use it in the app

```tsx
const QuestGame = lazy(() => import("../game"));   // Pixi and the game load only on demand
<QuestGame source={appSource} store={serverProfileStore} onExit={...} />
```

- **`QuestSource`** (`core/source.ts`) is the only way data comes in or out:
  - `lists`, `nearbyStores` and `findStores` feed the hub and picker.
  - `open(store, list)` returns the layout and items.
  - `report()` sends finds, shelf reports and route feedback.
  - `SampleSource` is the offline sample. The app's source would read the user's lists and the store map API, and post reports to it, where two matching reports update the map.
- **`ProfileStore`** (`store.ts`) holds the profile. The lab keeps it in localStorage; the app would keep it per user on the server.
- **Practice** runs on `SilentSource` and never changes the profile (this is tested).
- **Pictures** default to `/assets/...`, which is the PWA mount, so the app needs no setup.

## Rules worth knowing

- A spot (the shelf ring) is shown only for a section that is really mapped. Simulated stores only show "usually ..." hints.
- The golden item is never in fog.
- A real store keeps the feedback quiet (a tick and the points) and saves the big celebrations for checkout. Practice gets the full show.
- Undo is available for 4 seconds after each grab.
- A set-aside item can be tried again before checkout.
