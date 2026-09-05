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

# Boots style log — round 2, pass 1

Six footage-driven corrections from the round-2 analysis (american-kids,
flex, shake-that, spicy-margarita, figure-catalog-notes). All still 3D-only
attitude work in kfAttitude/poseLift/PROFILES + the placeFoot boot block.

- Points/taps steepened 55 -> 68 (footage 70-80; target 65-70), with
  POINT/TOUCH/TOE badges routed explicitly through the toe-anchored branch;
  back touches settle shallower at 52 (charleston catalog). Verified:
  twinkle-toes points measure 68 settled; 10:35 @49.15 holds 68, @49.4 the
  blend into the & close is still 47 toe-anchored (steep in scrubbed stills).
- Heel touches softened -30 -> -22 toe-up (american-kids: small 20-25 lift,
  not a showy 45). tush-push heel @4.1 shows the modest sole sliver.
- Kicks are LOW knee-flicks: poseLift 0.35 for KICK (was 1.0 via pose air),
  kick profile arc 0.5 + snapLift 0.15 (was 1.0/0.3); pitch -32 kept.
  picnic-polka kicks: held lift 0.35, travel apex 0.64 — under shin height
  (was apex ~1.3, above the boot shaft).
- Universal &-count contact (catalog rule 1): &-timed closes/togethers/ball
  steps (fractional-beat keyframe, un-mirrored dxo 0.3-1.2, |dyo| < 0.6)
  land pitch 44 toe-anchored — chasse/shuffle togethers, KBC dabs, coaster
  &s. tush-push cha-triple &s and the cha-cha-cha Lindy chasse &s all read
  44 ball contact; whole-count closes stay flat.
- Cross turnout: weighted flat cross landings (un-mirrored dxo < -0.15) yaw
  out 30 for front crosses, 15 behind (vines stay a loose stagger);
  attitude only, position untouched; figures meta can modulate via
  k.turnout. amame front crosses ±30 / behind ±15 with correct mirroring;
  black-velvet jazz-box cross no longer lands parallel.
  GOTCHA fixed en route: kf.dxo stores the parser's MIRRORED dx, so a
  left-foot close is dxo -0.85 and a left cross is +0.4 — all landing-shape
  detection must un-mirror by foot sign first (round-1's beside check only
  survived because it used abs()).
- heelPop seeds fully developed on any seek (|dt| > 0.34 beat rewinds
  since by 1 beat) so scrubbed stills show the free-heel texture; the pop
  also layers onto yaw-only attitudes so a crossed free boot still peels.
  Cold seek to tush-push 9.6: free R boot popped in a single-shot still.

Verification: screenshots via a background browser tab on the live app
(viewBox pinned to '150 110 220 200' for close-ups), state driven manually
with setSynced(false)/seek/render x2, numerics via footState().att. NOTE:
loadDance's async music setup can seek(0) shortly after a sheet loads —
wait ~0.5s (or re-seek) before composing a still. __sim smoke: 32 beats of
canadian-stomp + sambas-and-sailors, no exceptions.
node tests/run.js: 172/172 green.
