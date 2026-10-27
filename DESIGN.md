# DESIGN — Arya PWA

Written from the built interface (Stage 6 UX pass, 2026-10-27), per the
Impeccable flow: DESIGN.md records the world that shipped, it does not
prescribe a world that did not. Direction source: the owner's brief —
the Apple UI design system (impeccable.style skill vendored at
`.claude/skills/impeccable/`; apple-ui-design-system tokens).

## World

A native-feeling iOS surface. Arya is an Operate surface: the user is
mid-task, often one-handed, often in a store. The interface uses the
patterns the user's hand already knows: large titles, grouped inset
lists, a translucent tab bar, pill actions. Nothing on screen performs;
every element is a control or a fact.

Scene that forces the choices: a shopper in a bright store aisle,
phone in one hand, cart in the other. Light mode is the store; dark
mode is the kitchen at night. The system follows the phone's setting.

## Tokens (assistant/pwa/styles.css)

- Type: system stack (-apple-system, SF Pro Text). Large title 34/700,
  section label 13/600 uppercase secondary, body 17, row sub 14.
- Colors (semantic, both modes): --bg #f2f2f7 / #000; --group #fff /
  #1c1c1e; --label #1c1c1e / #f2f2f7; --secondary #636366 / #aeaeb2;
  --sep hairline rgba; --fill for inputs and chips.
- Accent: one deep green (--accent #1c6b3c light, #1e7a3e dark;
  --accent-text #176b36 / #52c878). Green is the household's color:
  groceries, go, fresh. It is the only saturated color except danger
  (#c81e1e / #ff6961) for returns and recording state.
- Shape: groups radius 14, inputs radius 10, buttons and chips are
  pills (980). No shadows in dark mode; a 1px soft shadow in light.
- Spacing: 4/8/16/24 rhythm; groups inset 16 from the screen edge;
  more space above a section label than below it.

## Components

- Grouped list: white (or #1c1c1e) rounded group, hairline row
  separators, rows min-height 44. The last row carries no separator.
- List row (the signature control): check circle (30px, fills green
  with a drawn check when bought; the name strikes through), name +
  reason line, quantity stepper (36px round buttons, tabular qty),
  remove (×). Every part is a target; the name opens the item page.
- Tab bar: fixed, backdrop blur saturate(180%), four tabs with drawn
  SVG icons (1.7 stroke, one weight) + 10px labels. Active = accent.
- Chat: bubbles (green right for the user, fill left for Arya, small
  centered system lines for applied actions), round input, mic and
  speaker icon buttons (44px). Mic turns danger-red while listening.
- Buttons: primary pill = accent with white text; secondary pill =
  fill. Chips = small pills for queue actions.

## Motion

One authored moment: a view fades and rises 6px on tab change
(0.28s, cubic-bezier(0.22, 1, 0.36, 1)). Nothing else animates except
button presses. prefers-reduced-motion removes it.

## Rules that hold

- Body and secondary text meet 4.5:1 in both modes (secondary is
  #636366 on #f2f2f7, #aeaeb2 on #1c1c1e — not the lighter system grays).
- No emoji as icons; icons are drawn SVG in one stroke weight.
- No gradient text, no side-tab borders, no card-inside-card.
- Errors go to the toast (a dark pill under the header), never into
  content labels.
- Quantities and money use tabular numerals; quantities render whole.
