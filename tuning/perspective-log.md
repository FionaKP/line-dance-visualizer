# Perspective tuning log (boots-3d)

Learner log for the tilted 3D view. Each iteration: hypothesis -> change ->
measurements -> screenshot judgment -> verdict.

## Measurement method

`window.__simPlay(fromBeat, beats, warmBeats=4)` (installed via devtools, not in
source): patches `performance.now` so `render()` sees a fixed 60fps clock,
advances `state.t` at the dance bpm, warms up 4 beats so the tilt/azimuth eases
settle, then reads `__viewStats` plus azimuth-only stats (maxAzimRate /
avgAzimRate / azimMin..azimMax in deg and deg/s). Deterministic and
reproducible, immune to background-tab rAF throttling. Real-playback spot
checks are done separately with the pane fronted; the two kinds of numbers are
never compared to each other.

Standard suite on the default Choosin' Texas sheet (96 bpm, 24-beat walls),
using wall 2 so no warmup range crosses the t=96 wrap (the wrap teleports the
dancer home and spikes maxCamSpeed ~10 u/s — pre-existing app behavior, not a
perspective artifact; excluded from comparisons):

- `wall2  = __simPlay(24, 24)` full wall: rumba box, two half-turn shuffles, hook, skates
- `turns  = __simPlay(32, 8)`  section 2, the two half-turn shuffles
- `hook   = __simPlay(40, 8)`  section 3, back-step + hook + shuffle + skates

## Baseline (commit 5c1ea75)

VIEW3D: tilt 32, shaft 14, liftPx 26, azimBase 12, azimGain 22, azimRate 0.015,
tiltRate 0.05, speedGate 0.5.

- wall2: maxRot 212.9, avgRot 32.1, maxCam 2.97, avgCam 0.76, maxAzim 23.2, avgAzim 5.4, azim range [4.0, 21.8]
- turns: maxRot 212.8, avgRot 70.8, maxAzim 23.1
- hook:  maxRot 212.1, avgRot 11.8, maxAzim 22.9

Reading: total rotation rate is dominated by the follow-rotation chasing the
half-turns (~213 deg/s peaks, would exist in 2D follow mode too). The azimuth
law itself is gentle (peak ~23 deg/s, uses ~18 deg of its range over a wall).

Screenshot judgment at stills (t=3.5 shuffle, 17.6 hook, 21 skate, svg zoomed
2.2x via viewBox for inspection): tilt and lift read okay, badges fine, BUT the
boot shafts are invisible.

## Iteration 1 — boot shafts are fully occluded by the foot glyphs

**Hypothesis:** the `bootL`/`bootR` paths are drawn *before* `footL`/`footR`
in the #dancer layer, and the shaft (7.4px at tilt 32) lies entirely inside the
glyph's screen bbox, so the "boots" contribute nothing. Drawing them on top of
the glyphs and lengthening the shaft should make the 3D read without adding
clutter (still a single thin rounded stroke per foot).

DOM check confirmed occlusion: bootL path spanned y 194->207 while the glyph
covered y ~170-217 at the same x, glyph drawn later.

**Change:** move the two boot paths after the foot groups in the #dancer
layer; shaft 14 -> 20.

**Measurements:** geometry-only change, stats unchanged from baseline (law
untouched); verified wall2 suite matches baseline within noise.

**Screenshot judgment:** live-DOM prototype (appendChild + VIEW3D.shaft=22):
at t=3.5 and 17.6 each shoe now shows a short vertical shank rising from the
heel — clearly a boot, still thin. 22 looked a touch long on standing feet;
baked 20. 2D toggle check: boots hidden (opacity 0 when sinTilt < 0.03),
classic top-down view intact.

**Verdict:** KEEP.

## Iteration 2 — rate-limit the azimuth drift (commit 2bd4b3e)

**Hypothesis:** the plain exponential ease is the wrong motion profile for a
"camera operator": it spikes (rate proportional to error, ~23 deg/s the moment
the target jumps) and then crawls, never expressing the full swing. A
proportional pull with a hard deg/s cap should cut the peak while finishing
the swing sooner.

**Change:** azimRate 0.015 -> 0.03, new VIEW3D.azimVmax = 14 (deg/s cap),
`state.azim` update clamped to azimVmax*dt.

**Measurements (wall2 suite):** maxAzimRate 23.2 -> 14.0, azim range
[4.0,21.8] -> [3.4,22.9], avgAzimRate 5.4 -> 6.3, maxRotRate 212.9 -> 208.7.
A/B of caps: 10 too flat (range 13.9 deg), 20+rate .04 expressive (range 27.9)
but peak 20 deg/s felt like the top of the comfortable band; kept 14.

**Screenshot judgment:** grid drift at swing peaks reads steady, no snap.

**Verdict:** KEEP.

## Iteration 3 — slow the velocity filter the azimuth sees (commit d0dadfb)

**Hypothesis:** quarter-beat azim traces showed 4-deg zigzags during rock/
recover (10 -> 14 -> 10 within ~1.2s): the tc~0.2s velocity smoothing passes
rock-period direction reversals, so the camera dithers on moves with zero net
travel. A tc~0.55s filter should cancel rock pairs while sustained walks still
integrate.

**Change:** the hardcoded 0.08 velSm smoothing became VIEW3D.velSmooth = 0.03
(URL-tunable).

**Measurements:** azim trace over wall 2 went from zigzag to single smooth
humps (log kept the raw traces out for brevity; rerun `__trace(24,24)` to
reproduce). wall2 range widened to [1.6, 27.2]; sectional avgAzimRate fell
(turns 5.8 -> 4.4, hook 4.8 -> 4.1) — calmer where travel is fake, more
expressive where it is real. maxAzimRate stays pinned at the 14 cap.

**Screenshot judgment:** swing-peak still at beat 25.6 shows the floor swung
noticeably during the side-step travel; no wobble artifacts in stills.
2D toggle re-checked: no squish, no boots, azimGoal forced 0.

**Verdict:** KEEP.

### Note on real-playback stats

With the browser pane backgrounded, rAF throttles to ~1 frame/s, so real
playback gave 12 frames in 12s and nonsense rates (maxRot 745 from multi-beat
seek-sized deltas). Real-playback __viewStats are only meaningful with the tab
truly visible at 60fps; all comparisons above use the deterministic sim.

## Iteration 4 — walking-heavy sheet evaluation (no change needed)

**Hypothesis:** the azimuth law was designed on a compact dance; long walks
(the case the perspective exists for) might overreact or drift the feet out
of frame.

**Method:** pasted a 32-count "Walkabout Test" sheet (walks fwd/back x3
sections, side steps, quarter-turn walls; parses to 4 walls of 32 with two
benign warnings). Suite on wall 2 (beats 32-64), plus `__frameBounds` which
tracks worldToScreen of both feet every frame.

**Measurements:**
- fwd/back walks (32-40): azim sits 12-15.2, maxRot 17.7 — the law correctly
  ignores straight travel; motion reads through the feet, not the camera.
- side section (40-48): azim sweeps 1.1 -> 30.7 at the 14 deg/s cap — clear
  directional lean, no overshoot or flip-flop.
- long fwd walks + rocks (48-56): azim 0.8 -> 12 (tail of left-side travel),
  settles flat at base 12 through the walks; rocks no longer wobble it.
- wall-turn beat (56-64): maxRot 230.8 — the follow-rotation, same class of
  peak as the half-turn shuffles.
- frame containment over the whole wall: feet stay in x 200-316, y 160-277 of
  the 520x440 viewBox; zero overflow. The CAM_MAX_LEAD leash generalizes.

**Verdict:** law generalizes to walks; no change. (Also decided: leave the
follow-rotation lerp (viewTheta 0.06) alone — its ~210 deg/s half-turn peaks
dominate maxRotRate, but that behavior predates the 3D view, is shared with
the 2D mode, and was tuned by the owner in f5c321e. Out of scope.)

## Iteration 5 — tilt A/B (negative) + stronger lift cue

**Tooling note:** the shared browser pane became unusable for screenshots
(tab-front contention with another agent), so visual A/Bs moved to
`tuning/snap.html` — a snapshot rig served by the app server that loads the
app in an iframe, applies VIEW3D URL overrides, seeks, and inlines the floor
SVG so `chrome --headless --screenshot` can rasterize stills. That gave the
first genuinely high-res looks at the view.

**Tilt A/B:** stills at tilt 26/32/36/40 (hook beat 17.6, skate beat 21 with
azim 24). 40 sells the most depth but visibly squashes the shoe glyphs
(squish 0.766) and shortens fore-aft step shape; 26 barely reads as 3D; 32 vs
36 is a wash. KEPT tilt 32 — negative result, recorded so the next tuner
doesn't re-run it.

**Lift cue:** at high-res the hook's raised foot read as "up-screen" (could be
farther away) more than "raised": the shadow gap is subtle on the dark floor.
liftPx 26 vs 34 A/B: 34 clearly more emphatic, but the raised glyph collided
with its badge pill. Baked liftPx 32 AND made badges ride up with the lifted
foot (renderBadge offsets by s.lift * liftPx * sinTilt). Hook still now shows
badge - clear gap - raised boot - shaft - standing boot below. In 2D the badge
offset is zero (sinTilt = 0) so nothing changes.

**Measurements:** wall2/turns/hook suite identical to iteration 3 (geometry
only).

**Verdict:** KEEP (lift + badge); tilt unchanged.

## Iteration 6 — swing-direction experiment (negative) + honest shadows

**Swing sign:** hypothesis — swinging *away* from travel keeps the travel
vector lateral on screen (unsquished), so it might be more legible than the
current swing-toward law. Measured total on-screen displacement of the dancer
mid through the rumba box and the full wall for azimGain +22 vs -22:
273 vs 276 px (section), 922 vs 919 px (wall). Informationally a wash — the
camera leash, not the rotation, carries travel visibility. KEPT swing-toward
(shows the dancer's leading side); recorded so nobody re-litigates the sign.

**Touch poses under tilt:** added `?sheet=walk` to tuning/snap.html (loads the
Walkabout Test sheet through the app's own paste panel). Touch stills at beats
3.7/11.7 read correctly: toe down, faded raised heel, badge clear.

**Shadows:** the lifted-foot shadow both grew and darkened with lift
(0.15 + 0.25*lift, rx/ry growing) — physically backwards, and at high-res it
read as a dark hole in the floor under every hook/touch. Changed to soften and
shrink with lift (opacity 0.28 - 0.12*lift, rx 14-3*lift, ry 24-5*lift):
grounded feet sit a touch heavier, raised feet leave a soft pool. The lift
cue itself lives in the glyph-shadow gap, which is unchanged. 2D check
(tilt=0 still): classic look, lift-as-size cue dominates as before.

**Measurements:** view dynamics untouched; wall2/turns/hook suite identical.
`node tests/run.js`: 74/74 (parser/tempo untouched, ran it anyway).

**Verdict:** KEEP shadows; swing sign unchanged.

## Final state (after 6 iterations)

VIEW3D: tilt 32, shaft 20, liftPx 32, azimBase 12, azimGain 22, azimRate 0.03,
tiltRate 0.05, speedGate 0.5, velSmooth 0.03, azimVmax 14.

Final deterministic numbers (60fps sim, warm 4 beats, wrap excluded):

- Choosin' Texas full loop (beats 4-95): maxRot 209.0 / avgRot 33.2,
  maxCam 2.97 / avgCam 0.76, maxAzim 14.0 / avgAzim 6.1, azim [-1.8, 27.2]
- Choosin' Texas wall 2: maxAzim 14.0 (baseline 23.2), azim range 25.6 deg
  (baseline 17.8), avgRot 33.0 (baseline 32.1)
- Walkabout wall 2: maxRot 230.8 (the wall quarter-turn), avgRot 8.3,
  maxAzim 14.0, azim [1.1, 30.6], feet always in x 200-316 / y 160-277

Remaining maxRot peaks are the pre-existing follow-rotation on the dance's own
half/quarter turns (shared with 2D, owner-tuned in f5c321e); the azimuth law
is capped at 14 deg/s everywhere.

## What I'd try next

- The wrap teleport at loop end (t=96 -> 0) spikes maxCamSpeed to ~10 u/s;
  a short camera cross-fade or snap-with-fade at the loop seam would clean up
  the one remaining jolt (pre-existing, not 3D-specific).
- A gentle deg/s cap on the follow-rotation whip during half turns (~209
  deg/s peak) IF the owner wants turns calmer in 3D; needs care since it is
  shared with the 2D view and lag makes facing read wrong.
- Boot shaft anchor is screen-vertical from the heel; at steep foot angles it
  hugs the glyph edge (visible in the skate stills). A 1-2px anchor nudge
  toward the glyph centroid would seat it better.
- The snap rig (tuning/snap.html) can grow a filmstrip mode (N stills at
  fixed beat intervals in one page) for judging motion continuity visually.

# Round 2: turn following

Owner's brief: following the boots' turns directly is too jarring — the view
should turn the SAME direction as the boots but delayed and slower, boots
visibly rotating on screen first.

## Method updates

The round-1 devtools harness is now checked in as `tuning/simharness.js`
(inject with a script tag, then `__sim(fromBeat, beats, warm=4)` /
`__ab(view3dOverrides, segments)`). `__analyze` adds per-turn metrics from the
frame trace: `maxErr` (deg of boot rotation visible on screen, i.e. view lag),
`peakRate` (deg/s of the follow pan), `catchupBeats` (turn start until the
view settles within 5 deg). `__viewStats` grew `maxFollowRate`/`maxLagDeg`.
`__loadPivotSheet()` loads a 16-count turn-torture sheet (full pivot = two
same-direction halves 2 beats apart, lone halves both ways, a quarter).
`tuning/snap.html` gained the filmstrip mode round 1 wished for:
`?strip=start,step,count` renders N stills off a continuous 60fps fake-clock
sim (warmed 4 beats), so camera dynamics in stills are physically consistent.

**Harness gotcha fixed in source:** consecutive fake-clock sims made
`performance.now` jump backwards between runs; `dt` went to -15 s and the
clamp arithmetic inverted, exploding `rotErr` by 130 revolutions. render()'s
dt is now guarded to be positive (real browsers never go backwards, but the
new law scales steps by dt, so the guard is cheap insurance).

## Baseline (commit f0ab2c2, old lerpAngle 0.06 law)

Choosin' Texas: half-turn shuffles peak 211 deg/s follow whip, only 55 deg of
the turn ever visible in the boots (the world counter-rotates almost in step);
wall quarter peaks 217. Pivot Test full pivot: peak 436 deg/s, total camera
pan through the (net-zero-facing!) pivot 365 deg. Filmstrip confirms the read:
grid whips frame to frame, boots barely change screen orientation.

## Iteration 1 — capped unwrapped pursuit replaces the bare lerp (commit 68cd296)

**Hypothesis:** a proportional pull with a hard deg/s cap (the azimVmax trick
from round 1) turns the whip into an operator's pan; tracking the error
UNWRAPPED (accumulate dTheta, don't wrap to ±180) keeps back-to-back
same-direction turns panning the same way instead of flipping to the "short"
side mid-phrase.

**Change:** `state.rotErr` accumulates facing changes (loop-seam jumps >180
per frame are discarded as teleports); viewTheta = theta - rotErr; err drains
at `rotErr * rotRate` per frame, clamped to `rotVmax * dt`. Old law is the
special case rotVmax=10000, rotRate=0.06 — verified it reproduces baseline
numbers exactly.

**Cap sweep (rotRate 0.06):** vmax 40 too slow (quarter turn catch-up 3.6
beats, half unfinished when the reverse half arrives); 60 gentle (quarter
2.5 beats); 90 best balance (half turn: lag 106, catch-up 3.6 beats; quarter:
lag 70, 1.9 beats). Constant-rate pursuit (rotRate 0.3, cap binds to the end)
vs proportional (0.06, exponential tail): numbers nearly identical; kept the
proportional tail for the free ease-out. Partial follow (rotFollow 0.25,
menu item 4): peak rate right back up to 140-180 deg/s — defeats the point,
knob removed. NEGATIVE, don't re-litigate.

**Full-pivot renorm:** with unwrapped error a full pivot owes ~360 deg and the
camera would pan a slow full circle. Added: once the facing settles and
|rotErr| > 200, renormalize by a revolution (take the short way home). The
360-renumber is invisible on screen (same angle mod 360) — filmstrip frames
across the renorm are continuous. The rotation-rate stat needed the same
mod-360 wrap (a renumber is not motion).

## Iteration 2 — hold during the turn + settle window (commit 68cd296)

**Hypothesis (owner's menu item 2):** barely rotate while the turn is in
progress, then catch up — so the whole turn reads in the boots, and a
multi-part turn (full pivot) becomes one phrase followed by one pan.

**Change:** `rotHold` (fraction of rotVmax while the facing moves >20 deg/s)
and `rotSettle` (beats the hold lingers after the facing stops).

**Measurements:** hold 0.12 freezes the view during turns (half turn: lag 171
of 180 visible in the boots). rotSettle sweep on the full pivot's total
camera pan: 0.5 → 185 deg, 1.0 → 155, 1.6 → 98 (bridges the 1.5-beat gap
between pivot halves entirely) — but 1.6 delays every lone turn's catch-up by
a full second, camera reads asleep. Kept 0.6: lone turns start panning ~0.4 s
after the feet land; pivot pan 179 deg total vs 365 baseline.

**Filmstrip judgment (33-38, step 0.4):** grid frozen while boots swing
through the half turn (vt moves 9 deg during the entire turn), then one
deliberate pan over ~2 beats, settling just as the reverse turn begins; the
reverse reads as a smooth there-and-back sway. Exactly the brief.

## Iteration 3 — eased pan acceleration (commit 68cd296)

**Hypothesis:** the pan starting/stopping at 90 deg/s within one frame is a
visible kick.

**Change:** `rotAccel` — the pan speed is now a state (`state.rotVel`) easing
toward the clamped proportional goal; an anti-overshoot clamp zeroes the
velocity rather than gliding past the target. rotAccel 0.15 ≈ 0.11 s speed
time-constant; ramp is visible in traces (per-frame vt deltas accelerate
2 → 8 → 21 → 22 px) with zero overshoot in any segment.

## Iteration 4 — turn arc closes with the camera (commit 637bb4c)

With the camera now lagging, the old arc (trailing 1.5-beat theta window)
expired mid-catch-up. The arc now spans from the camera's current heading
(viewTheta) to the new facing whenever that is wider than the trailing
window — it opens as the boots turn and visibly CLOSES as the view comes
around, doubling as a "camera still turning" cue. No new elements (owner
dislikes clutter); the fraction label still reads the actual trailing turn so
it doesn't step down ¾ → ½ → ¼ while the pan runs. Considered a facing-ghost
arrow (menu item 5) — skipped: arc + boots + compass already carry it.

## Iteration 5 — cross-sheet + mode verification (no change)

- Walkabout Test: straight walks untouched (avgRot 8.2 vs 8.3 before), wall
  quarter lag 88 / pk 90 / catch-up 2.6 beats.
- Pivot Test wall: every peak ≤ 90 + azim (old: 436); full pivot settles 2.5
  beats after the second half; camera pan 179 deg vs 365.
- 2D (3D-off) and follow-off: law is shared by design — 2D follow mode gets
  the same calm turns (pk 90, no NaN); follow-off leaves curRot = azim only.
  Note: the compass arrow tracks viewTheta, so in non-follow mode it now lags
  a fast turn by a beat or two, like a real compass needle settling. Judged
  fine (and the sheet/beat panel still snaps instantly).
- Toggles and playback exercised in a live tab: no console errors.
- node tests/run.js: 74/74.

## Final state (round 2)

New VIEW3D defaults: rotRate 0.15, rotVmax 90, rotHold 0.12, rotSettle 0.6,
rotAccel 0.15 (all URL-overridable; rotVmax=10000&rotRate=0.06&rotHold=1
&rotSettle=0&rotAccel=1 restores the old behavior for A/B).

Before/after (60fps sim, warm 4 beats):

- Choosin' Texas full loop (4-95): maxRot 209 → 96.2, avgRot 33.2 → 24.7,
  maxFollowRate 90 (at the cap), maxLag 171 deg; cam/azim stats unchanged.
- Half-turn shuffle: peak 211 → 90 deg/s; boot rotation visible on screen
  55 → 171 deg; settles ~4 beats after turn start (the price of the calm cap).
- Wall quarter turn: peak 217 → 90; catch-up 1.5 → 2.6 beats.
- Pivot Test: peak 436 → 90 (+azim ~14); full-pivot camera travel 365 → 179 deg.

## What I'd try next (round 2)

- The half-turn catch-up (~4 beats at the 90 cap) overlaps the next move by
  design; if the owner wants snappier halves, raise rotVmax toward 120 before
  touching the hold — the hold is what makes the turn legible.
- rotSettle ~1.5 would make full pivots nearly sway-free (98 deg travel) at
  the cost of a 1 s dead time on every lone turn; could be made adaptive
  (longer settle only when a second turn arrived recently).
- The loop-seam teleport (round 1's note) still stands.
- The turn-arc label bands (¼/½/¾) still read off the trailing window and
  briefly show ¼ as a half turn exits the window — pre-existing; a
  peak-latching label would fix it.

# Round 3: footage-driven style pass (camera)

Full iteration narrative lives in tuning/camera-style-log.md; this section
records the law changes and their numbers, continuing rounds 1-2. New
VIEW3D knobs (all URL-overridable): spiralAfter 1.5, spiralRamp 1.0,
spiralHold 0.5, spiralDecay 2 (beats), camDead 0.15 (units), azimDead 1.5
(deg), thudPx 2 (px). `spiralAfter=9999&camDead=0&azimDead=0&thudPx=0`
restores round-2 behavior exactly (verified bit-identical sim output).

## Law changes

1. **Long-spiral hold release.** The rotHold freeze now releases on
   sustained turning: a leaky integrator of turn-phrase time (turning
   frames + the rotSettle windows that bridge a parsed spiral's per-count
   bursts; decay tc = spiralDecay beats when the phrase ends) ramps the
   effective hold 0.12 -> 0.5 between 1.5 and 2.5 accumulated beats.
   3D-only. Wall-2 sims @100bpm: sambas-and-sailors maxLag 235.5 -> 128.4,
   picnic-polka 224.4 -> 134.9, ten-thirty-five 296.6 -> 274.5; Pivot Test
   per-turn maxErr within 0.5 deg of round 2 (full-pivot freeze intact);
   Choosin' Texas wall 2 maxLag 168.4 unchanged.

2. **Stillness deadband.** Settled recenter pull skipped inside camDead
   0.15 units; azimuth parked when its error < azimDead 1.5 deg. 3D-only
   (an early shared version left the 2D view with a permanent ~1.5 deg
   residual rotation — caught and gated). canadian-stomp holds: 17-18 px/s
   camera drift and ~0.5 deg/s azimuth creep -> 0.00 during every settled
   hold; corpus avgCam down across all 25 sheets (e.g. cupid-shuffle
   0.46 -> 0.32 u/s) with no other stat moving.

3. **Impact thud.** state.thud = thudPx * exp(-age/55ms) (zero past 200 ms,
   summed over feet, capped 1.4x, scaled by curSinTilt) added to the #world
   vertical translate on impact-keyframe landings. Pure function of t —
   deterministic across scrubs, sims, loop passes; floor coordinates and
   timing untouched; 2D transform byte-identical.

4. **Loop-seam teleport snap.** A dancer-mid jump > 1.5 units/frame (only
   teleports move that fast) snaps cam/velSm/rotation state to the new
   position and fades #world 0.25 -> 1 over 250 ms. Closes rounds 1-2's
   standing "wrap teleport ~10 u/s" note: forced synced-style jump now
   peaks at the ordinary 2.57 u/s. Free-run loops never trigger it (the
   seam wall keeps them continuous; verified endMid == startMid across the
   corpus).

## Final corpus sweep (25 sheets, wall 2, 100 bpm)

worstMaxRot 134 / worstMaxCam 5.57 / unsettledTurns 31 — all unchanged from
round 2; worstMaxLag 360 -> 357.4 (amame full unwind, deliberately frozen).
node tests/run.js: 172/172.

## Known pre-existing issue (reproduced on origin/main, not touched)

While the YT player initializes after loading a sheet with music, frame()'s
synced branch computes state.t = NaN for a few frames (getCurrentTime /
music.start race) and render() logs NaN-attribute console errors until the
player readies. Playback code, outside camera territory.
