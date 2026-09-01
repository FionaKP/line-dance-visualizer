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
