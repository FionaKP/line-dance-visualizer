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
