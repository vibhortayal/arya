# DESIGN — Arya PWA

Written from the built interface (Stage 6 UX pass, 2026-10-27), per the
Impeccable flow: DESIGN.md records the world that shipped, it does not
prescribe a world that did not. Direction source: the owner's brief —
the Apple UI design system (impeccable.style skill vendored at
`.claude/skills/impeccable/`; apple-ui-design-system tokens).

## World

A native-feeling phone surface. Arya is an Operate surface: the user is
mid-task, often one-handed, often in a store. The interface uses the
patterns the user's hand already knows: large titles, grouped inset
lists, a translucent tab bar, pill actions. Nothing on screen performs;
every element is a control or a fact.

Scene that forces the choices: a shopper in a bright store aisle,
phone in one hand, cart in the other. Light theme only: no dark variant
is defined or applied (`color-scheme: light`). The theme tokens come from
the approved wireframes (2026-10-27), and `tests/test_theme.py` pins them.

## Tokens (assistant/web/src/styles/styles.css)

- Type scale (design pass, 2026-10-29): 34 title, 22 card title, 17 row
  and button, 15 body, 13 section label, 12 tag and chip, 11 tab label.
  Weights 400 / 600 / 700; 800 only for big numbers and kickers. System
  stack (-apple-system, SF Pro Text).
- Colors: greyscale is structure. --bg #EFEFF1; --panel/--group #FFFFFF;
  --ink/--label #1B1B1E; --ink2/--secondary #55555C; --ink3 #8B8B93;
  --line #D9D9DE; --fill #F4F4F6.
- Accent: one orange (--acc #C2410C, soft #FDEEE8). It marks the active
  tab, primary pills, links and the game. The only other saturated color
  is danger (#c81e1e) for returns and recording state.
- Quest sub-palette (game/game.css, owner approved 2026-10-30): each
  color has one job. Green #237A40 (pressed edge #17562C) = grabbed or
  mapped: Got it, Found it here, Mapped, done ticks. Gold #FFC83D = the
  golden item. Orange = the app accent above (main buttons, Map it).
  Everything else is neutral: Simulated badges are #F1EEE8 with a
  #B8B2A7 dash, the selected list chip is outlined, not filled black.
  No blue, purple or teal in Quest chrome. The one exception is the 3D
  store: a simulated store is drawn as a blue blueprint, because there
  blue means "a guess, not a pin". Quest tags are at least 11px and
  weights stop at 800.
- Shape: groups radius 14, inputs radius 10, buttons and chips are
  pills (980). A 1px soft shadow on cards.
- Spacing: 4/8/16/24 rhythm; groups inset 16 from the screen edge;
  more space above a section label than below it.

## Components

- Grouped list: white rounded group, hairline row separators, rows
  min-height 44. The last row carries no separator.
- List row (the signature control): check circle (fills with a drawn
  check when bought; the name strikes through), name + reason line,
  quantity (tap the amount to change it), swipe to Move or Remove. Every
  part is a target; the name opens the item page. In a hunt, tapping the
  circle grabs the item.
- Tab bar: fixed, backdrop blur, four places the shopper picks (default
  Today, Lists, Quest, Ask) then More, with drawn SVG icons (1.8 stroke,
  one weight) + 11px labels. Active = accent. The tab bar hides during a
  hunt. There is no floating avatar (removed 2026-10-29).
- Chat: bubbles, round input, Talk and Photo chips (44px). Talk turns
  danger-red while listening. Ask does not speak aloud.
- Buttons: primary pill = accent with white text; secondary pill =
  fill. Chips = small pills for queue actions. Sheets drag down to
  dismiss.

## Motion

One authored moment: a view fades and rises 6px on tab change
(0.28s, cubic-bezier(0.22, 1, 0.36, 1)). Nothing else animates except
button presses. prefers-reduced-motion removes it.

## Rules that hold

- Body and secondary text meet 4.5:1 on the light theme (secondary is
  #55555C on #EFEFF1; use --ink3 only for decoration and placeholders).
- No emoji as icons; icons are drawn SVG in one stroke weight.
- No gradient text, no side-tab borders, no card-inside-card.
- Errors go to the toast (a dark pill under the header), never into
  content labels.
- Quantities and money use tabular numerals; quantities render whole.
