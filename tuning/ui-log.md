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

## Iteration 2 — wood-plank floor

Hypothesis: the blue graph-paper grid is the least floor-like thing on the
page; a dark-walnut plank pattern whose boards are exactly one floor unit
(50px) tall can *be* the beat grid in one axis, with a faint overlay line
keeping the cross axis readable.

Change: `#wood` pattern in the SVG defs — 250×200 tile, four 50px board
rows, tileable wavy grain strokes, 1px top-edge highlights, 2px long seams,
staggered butt joints; the old `#grid` pattern demoted to a faint warm
cross-axis overlay. Warmed the weight glow to lamp-light (`#ffe3b0`) and
added a screen-space radial vignette between the world and dancer layers so
the floor edges fall away without dimming the boots.

- Screenshot v1 (tilted, at rest): read as **brick wall**, not floorboards —
  butt joints were as heavy as the long seams and every board in a row was
  the same tone. Fix: joints at 1px/0.55 opacity vs 2px seams, plus
  per-board tone rects between joints.
- Screenshot v2 (tilted, at rest): reads as a wood floor; boots, glow and
  badges keep strong contrast.
- Screenshot v3 (flat 2D, mid-dance at count 3&4): planks at the follow
  rotation angle still read as floor; foot prints and trails clear.
- Screenshot v4 (3D tilt, mid-turn at beat 10.6, floor rotated −122°): the
  turquoise turn arc pops against the walnut; grain does not shimmer or
  alias at odd angles.

Verdict: keep. Boards-as-beat-grid works; the faint overlay carries the
other axis.
