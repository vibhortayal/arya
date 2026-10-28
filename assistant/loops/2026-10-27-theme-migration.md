# Theme migration — the wireframes' orange, at the token layer (2026-10-27)

The owner compared the live app with the approved wireframes:
the colors differed. The earlier parity pass had matched
structure only. This pass migrates the color layer, and
verifies it the way that pass did not.

## The rule

From the wireframes, binding: **greyscale is structure; the
orange is the game.** The wireframe tokens are now the app's
tokens, verbatim (`pwa/styles.css` `:root`):

--acc #E4572E, --acc-soft #FDEEE8, --ink #1B1B1E, --ink2
#55555C, --ink3 #8B8B93, --line #D9D9DE, --line2 #ECECEF,
--bg #EFEFF1, --panel #FFFFFF, --fill #F4F4F6, --fill2
#E7E7EB; scene background #FAFAFA; COLLECT shadow
rgba(228,87,46,.35); receipt-button shadow
rgba(228,87,46,.32).

The app's semantic names (--accent, --label, --secondary,
--sep, --group, --fill, ...) are kept as aliases onto the
wireframe tokens, so every component that referenced them
migrated at once. --accent-press is a color-mix derivation of
--acc (the wireframes define no press shade; no value was
invented). --danger stays (destructive actions are not game
elements and the wireframes do not speak to them).

## Where the orange now sits (the wireframes' usage list)

Quest-flow primary buttons, the Today hero card (2px acc
border — already structural, now orange), the Quest mode card
(acc-soft ground + acc ring; Express stays greyscale), the
next-stop banner and stop cards, hunt markers (cloud: got
#E4572E / pending #55555C in scene.js; DOM drivers via the
tokens), route dots and game progress, GRAB (with the .35
shadow), the Finish receipt button (with the .32 shadow),
verified pills and game tags, "you" rows, the store-filter-on
state, the current tab icon, focus borders, verified text,
the Ask send button, the count badge. Picked chips (store
lens, community scopes, optimizer answers, session rail) wear
the wireframes' soft treatment — acc-soft ground, acc text,
acc ring — with ONE solid exception, the scene toggle's "on",
exactly as the wireframes draw it.

## Stragglers swept

The old green (#1c6b3c family) lived in the tokens, the
selection color, and the meta theme-color; Apple system
green/blue/orange lived in scene.js markers (#30c759,
#2f7cf6, #ff9f0a) and the Shelf Scan layer (#34c759, the blue
pop tint); the scene was a dark viewport (#101318 in the
wrap and the THREE scene/fog) — now #FAFAFA everywhere,
including the shelf-label chip (white pill) that rode on it.
No old-green or system-color hex remains in any first-party
pwa source; a test greps for all of them.

## Amber stays amber

The warning palette is NOT the accent: reported-missing now
renders as the wireframes' flag — #8a3b12 on #FFF1D6, border
#E8A33D (new .repflag class; the arrival pop and the stop
list use it) — the needs-your-eye card border is #E8A33D, and
the cloud marker's flag badge is #E8A33D.

## Verification (the step the first parity pass skipped)

- `tests/test_theme.py` (8 tests): token values equal the
  wireframe values exactly; aliases resolve onto them; scene
  backgrounds and both game shadows carry the wireframe
  values; the amber values are present and separate; NO
  pre-migration color survives in styles.css, scene.js,
  quest.js, app.js, index.html, or sw.js; the game-element
  applications (hero border, Quest mode card, chip states,
  cloud markers, repflag) are pinned.
- Computed styles in a real browser (headless Chromium):
  --acc computes to #E4572E, body background to #EFEFF1.
- Screenshot pass over Today, List, Hunt, Community, and
  Profile at phone size: orange appears only on game
  elements; everything else is the greyscale ramp. (Shots
  were taken against a scratch account; nothing was deployed.)
- One parity pin updated: the Finish snap label's exact
  markup gained the receiptbtn shadow class
  (tests/test_parity.py) — its intent (a real primary button,
  not a bare input) is unchanged.

Suite: **240 green**. SW cache **arya-v26**. **Not pushed,
not deployed** — parent reviews and ships.
