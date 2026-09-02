# Boots style log — round 1

Goal: boot-level texture from the video corpus (heel pops, steeper points,
lock tucks, landing rolls, toe-led sweeps, sharper kicks). All 3D-only behind
the existing bootIn gate; 2D glyphs untouched; every transient zeroes at
raw = 1 so landings stay exactly on the beat.

Method: pane hidden (screenshots unavailable), so stills were made by cloning
the #floor SVG with inlined page CSS, rasterizing to canvas in-page, and
POSTing the JPEG to a scratchpad helper server; seeks driven manually with
setSynced(false)/setPlaying(false) and state.effTilt/state.azim pinned per
shot. Numeric spot-checks via footState()/kfAttitude() in the console.

## Iteration 1 — the whole spec in one pass

- Free-heel pop (placeFoot boot block + updateHeelPop tracker next to
  glowAnim): settled flat unweighted boot eases to pitch +14 toe-anchored,
  bend 1 -> 0.5, over 0.15 beat from each weight transfer. Deterministic,
  restarts cleanly on backward seeks. amame @4.3 side view: tan free boot
  heel clearly hovering, weighted red boot dead flat. Caught a verification
  gotcha: a single big seek resets the pop timer (weight change is only seen
  at render time), so stills need a two-step seek (just after the transfer,
  then the target beat) to show the developed pop.
- Toe point steepened 42 -> 55 (still toe-anchored), and TOUCH tight beside
  the other boot (|dxo| < 1.1, |dyo| < 0.3 — dancer-frame offsets now carried
  on keyframes as dxo/dyo) pigeons inward yawOff 12 (sign checked: -12 for R
  = toes-in, matching split_toes_out's aOff convention). amame touch @43.5:
  boot stands en pointe on the contact ring, convincing from a 40-deg azim.
- LOCK attitude row: pitch +35 toe-anchored, bend 0.4. ten-thirty-five @25.4
  from behind: locked red boot tucked tight, dark heel tread facing camera,
  heel popped high over the support boot. Reads springy, matches amame.
- Landing rolls in moveAttitude: plain step gets -12 * sin(pi*(raw-.7)/.3)
  (heel-first, peaks raw .85, exactly 0 at raw 1 — verified numerically:
  pitch -10.98 @ raw~.9, null at the landing keyframe); rock profile gets
  +18 * sin(pi*raw) ball-first (peaked +17.7 mid-window, 0 at landing).
- SWEEP pitch 10 -> 30 (roll + yaw fan kept): amame sweep @2.72 shows the
  toe dipped through the whole arc — compass, not kick.
- KICK pitch -20 -> -32: picnic-polka kick @32.15 in profile reads toe-up
  ~35 with the existing snapLift; sharp flick, not a hover.

2D check: 3D toggled off @ the same kick — pads/heels/badge unchanged (all
new work sits in att / the boot block, which 2D never consumes).
node tests/run.js: 172/172 green (no parser/tempo changes).
