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

## Iteration 3 — button trim

Hypothesis: 11 text buttons on the transport row + 10 always-visible music
controls is the "wall of buttons" the owner wants trimmed; auto-match being
the default music path means the manual sync tools can hide until needed.

Change:
- Transport: Play becomes a compact teal icon button (▶ / ❚❚ — the only JS
  wiring change: two `textContent` sites), restart/prev/next become 38px
  icon buttons (↺ ◁ ▷), all tooltipped with their keyboard shortcuts.
- The five view toggles (Loop / Follow / 3D / Groove / Clicks) merge into
  one segmented cluster — same ids, same `.toggled` class, ~40% narrower
  than five loose buttons, and reads as one "view settings" unit.
- Tempo keeps slider + live "N bpm" value; the redundant "Tempo" label goes.
- Music card: Sync to video stays as the single surfaced music toggle;
  Count-1 input, Set to now, From lyrics, ±1s/±0.1s nudges, and Tap tempo
  collapse behind a "Fine-tune sync" `<details>` disclosure.

Screenshots: closed state shows a 4-icon transport + one cluster + slider;
open disclosure shows every manual tool intact. Verified by dispatching
events on every control: next/prev/restart seek correctly, all five toggles
flip state and class, play glyph swaps ▶/❚❚, nudges move `music.start`
±1s, sync toggles, and Space/←/→ still work. `node tests/run.js` 96/96.

Verdict: keep. Nothing lost, transport row went from 11 mixed-width text
buttons to 4 icons + 1 cluster + slider.

## Iteration 4 — hierarchy polish

Hypothesis: with palette, floor and controls done, the page still needs the
"one designed product" pass: the now-playing readout should be the hero
after the floor, and the leftovers (sprawling legend, cramped filters)
betray the old design.

Change: step readout up to 1.05rem/500 under the 2.3rem serif count
numeral; cards get a hairline warm inner highlight + soft drop shadow;
legend tightened to one 0.72rem line with a lamp-warm glow dot; search
filter row wraps at a sane 88px minimum instead of squeezing labels into
"Copperk / Any leve / Min co".

Found while screenshotting: a pre-existing grid blowout (also on main) —
the right column's intrinsic width pushed `scrollWidth` to 1307px at a
1280px viewport, so both columns hung past the page edge. `min-width: 0`
on the grid children fixes it; the layout now ends flush at 1280
(`scrollWidth` 1280).

Screenshots: full page at count 5 mid-dance (teal "5 6" line highlighted in
the sheet, trail dashes on the walnut), search results list for "texas"
(20 CopperKnob rows, teal titles on warm panels), fine-tune disclosure open
and closed. Controls verified by dispatching events on every button and
Space/arrow keys after the restructure; `node tests/run.js` 96/96.

Verdict: keep. Final inventory — always visible: play, restart, prev,
next, Loop/Follow/3D/Groove/Clicks cluster, tempo slider, dance Search,
music Auto match + Search, Sync to video. Behind one disclosure: count-1
input, Set to now, From lyrics, four nudges, Tap tempo. Behind the
existing loader disclosure: paste box + Parse and load. Nothing removed.
