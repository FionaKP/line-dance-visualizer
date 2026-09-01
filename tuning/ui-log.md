# UI redesign log — rustic-modern pass (`ui-rustic`)

Brief: "a more rustic but still modern and clean feel", wood-style floor,
"trim down the buttons as much as possible without removing complete
functionality." Same discipline as perspective-log.md: hypothesis → change →
screenshot verdict. Screenshots taken in the browser pane at 1280px viewport.

## Baseline (main)

Near-black blue (`#0f1117`) with periwinkle accent, blue-grey grid floor,
11 visible buttons on the transport row + 10 music controls always visible.
Verdict recorded for comparison: the floor reads as graph paper, not a floor;
the periwinkle fights the red/tan boots; controls row is a wall of text
buttons.

## Iteration 1 — palette A/B

Hypothesis: a warm dark-brown base ("modern honky-tonk") will flatter the
red/tan leather boots more than the current cool near-black, without losing
the modern dark-app feel. Accent is the second question: the periwinkle
`#8b9cf9` is the most un-rustic thing on the page.

A/B'd live via CSS-var overrides before touching source:

- **A1 — warm espresso + brass accent** (`--bg #191310`, accent `#d9a441`):
  warm and cohesive, but the brass accent sat too close to the right boot's
  tan; active stepsheet lines and the count numeral stopped popping.
- **A2 — warm espresso + turquoise accent** (accent `#4fb3a9`): the classic
  leather-and-turquoise western pairing. Accent reads clearly against every
  brown in the scheme and against both boots; still feels contemporary.
- **B — keep near-black, warm-tinted** (`--bg #14100d`): safer but the page
  read as "dark mode with a wood photo", not a designed rustic app; panels
  lost separation from the floor.

Verdict: **A2 wins.** Warm espresso base, warm off-white text, turquoise
accent. Committed as the token change plus the slab-serif display stack
(Rockwell / 'Iowan Old Style' / Georgia) for headings and the count numeral.
