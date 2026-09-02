# Camera style log (style round 1)

Camera-side style pass driven by the real-dance video analysis (sambas-and-
sailors, ten-thirty-five, canadian-stomp, twinkle-toes-waltz, tush-push,
amame, electric-slide notes). Measurement: `tuning/simharness.js` in a live
tab (`__sim`, `__analyze`), plus the new `__loadCorpusSheet` / `__simCorpus`
corpus sweep (re-derived from an earlier stopped agent's uncommitted
experiments; numbers below are my own runs). All sims pin bpm 100 (bpm 96/98
where noted) and use wall 2 so warmup never crosses the seam. "Base" =
this branch with the new laws disabled via URL-style overrides
(`spiralAfter=9999&camDead=0&azimDead=0&thudPx=0`), which is bit-identical
to the round-2 law (verified: identical stats + analysis JSON).

## Iteration 1 — long-spiral hold release

**Footage law:** sambas-and-sailors Sec3 is a continuous 3/4 spiral, ~45
deg/count over 6 counts ("a visualizer that snaps will look wrong");
ten-thirty-five has ~9 turns/wall reading as "smooth sweeps BETWEEN
anchors". The round-2 rotHold freeze is perfect for lone pivots but freezes
6 counts of spiral and then pans 270 deg.

**Attempt A (spec-literal, rejected):** accumulate only frames where
`turning` is true, hard-reset when the hold ends. Trace of sambas Sec3
showed parsed spirals turn in per-count bursts (~0.4 beats of theta motion
per count, ~40% duty cycle), so pure turning-time crossed the 1.5-beat
threshold only at the END of the 6-count spiral (release fired at beat 53
of a 47.5-53 phrase). maxLag 235.5 -> 206 only.

**Attempt B (shipped):** accumulate turn-PHRASE time — turning frames plus
the rotSettle windows that bridge the bursts — into `turnAccumS`, and decay
it with a `spiralDecay` = 2-beat time constant when the phrase ends instead
of hard-resetting. Release ramps the effective hold `rotHold` (0.12) ->
`spiralHold` (0.5) between `spiralAfter` = 1.5 and 2.5 beats of phrase.
3D-only (2D keeps round 2 exactly, per the style-round ground rules).

**Numbers (wall-2 sims, bpm 100):**
- sambas-and-sailors: maxLag 235.5 -> 128.4 deg; the 270-spiral's camera now
  trails mid-phrase (rotErr ~88 at beat 51.5) instead of banking 226 deg.
- picnic-polka: maxLag 224.4 -> 134.9.
- ten-thirty-five: maxLag 296.6 -> 274.5 (its worst lag is a chained-turn
  debt cluster, not a continuous spiral; see "not done" below).
- Pivot Test: per-turn maxErr 179.9/174.4/177.4/177.4 vs base
  179.6/174.8/177.4/177.4 — the full-pivot freeze is intact (pivot halves
  only turn ~0.42 beats, phrase ~1.0 beat, decays before the next).
- Choosin' Texas wall 2 (bpm 96): maxLag 168.4 both; turns identical.
- 2D check: pivot-sheet sim with view3d off is bit-identical to the old law.

## Iteration 2 — stillness deadband

**Footage law:** canadian-stomp: "render holds with zero drift — the
motion/stop contrast IS the style"; twinkle-toes holds are true 0.6 s
freezes.

**Change:** skip the settled recenter pull when the camera is within
`camDead` = 0.15 floor units of the dancer mid, and park the azimuth when
its error is under `azimDead` = 1.5 deg. Both 3D-only (the azimuth otherwise
would keep a permanent residual rotation in the classic 2D view; caught in
testing and gated).

**Numbers (canadian-stomp wall 2, bpm 100, per-hold peaks):** during the
toe-heel-stomp-hold section the base law drifted the camera 17-18 px/s and
crept the azimuth ~0.5 deg/s through every 1.5-beat hold; now every fully
settled hold reads 0.00 px/s and 0.00 deg/s. Corpus avgCam fell everywhere
(cupid-shuffle 0.46 -> 0.32, canadian-stomp 0.58 -> 0.50, tush-push 0.63 ->
0.55 u/s); no maxRot/maxLag regressions (corpus agg identical otherwise).

## Iteration 3 — impact thud

**Footage law:** canadian-stomp: "a tiny camera or floor thud accent on
stomp beats would match the vibe"; tush-push treats the stomp as
punctuation.

**Change:** `state.thud` — a pure function of t: for each foot whose
current keyframe has `impact`, age = (t - kf.t) in seconds; dip =
`thudPx` (2 px) * exp(-age/55ms), zeroed past 200 ms, summed across feet
and capped at 1.4x, scaled by curSinTilt so 2D gets exactly none. Applied
as a vertical offset of the #world translate — floor coordinates and
timing untouched, deterministic across scrubs/loops (same lookup as the
impact rings).

**Verified:** profile at a canadian-stomp landing = 2.0 px at the beat,
1.16 at +30 ms, 0.23 at +120 ms, 0 by +210 ms; 0 before the beat (the
wind-up stays in the boots, the hit lands ON the count); in 2D
state.thud = 0 and the world transform is byte-identical to before.

## Iteration 4 — loop-seam teleport snap

**Footage law:** wall boundaries must flow (amame: the final count-8 sweep
IS the transition; electric-slide's swept foot lands directly as the next
wall's count 1). Known jolt: perspective-log round 1 measured ~10 u/s
camera sprint when t teleports.

**Finding first:** the free-run loop is already seam-true — corpus probes
show footState at TOTAL_BEATS-0.01 equals footState at 0.01 for every sheet
checked (the seam-wall + wrapLoop() rebuild from round 2 of the app). The
remaining teleports are the music-synced wrap (`t = tb % TOTAL_BEATS`),
synced-video seeks, and sim jumps.

**Change:** in render(), a dancer-mid jump > 1.5 floor units in one frame
(impossible as dance motion) snaps the camera, velocity filter, and
rotation state to the new position and fades #world back in from 0.25 over
250 ms — a cut, not a slam. seek() still hard-resets (scrubbing never
blinks).

**Numbers:** forced playhead jump mid-electric-slide: maxCamSpeed 2.57 u/s
(the ordinary dance peak — the sprint is gone), camera lands on the new mid
the same frame, opacity ramps 0.25 -> 1.0 over 15 frames. Normal loop
crossings on electric-slide/cupid-shuffle/amame: no snap fired (continuous
cam trace), maxCam 2.0-2.6.

## Final corpus sweep (25 sheets, bpm 100, wall 2)

agg: worstMaxRot 134 (unchanged, = rotVmax 120 + azimVmax 14), worstMaxCam
5.57 (unchanged, big-travel catch-up), worstMaxLag 357.4 (amame's full
unwind — a short lone turn by phrase time, correctly kept frozen: it renorms
and pans ~3 deg, exactly the "continuous rotation blur between anchors" the
footage describes), unsettledTurns 31 (== base).

## Noticed, not done

- ten-thirty-five's worst lag (274 deg) is a cluster of chained quarter/half
  turns 1.5-3 beats apart — discrete turns, not a spiral, so the phrase
  accumulator only partially engages. A debt-pressure release (unfreeze when
  |rotErr| grows past ~180 during the settle window) would address it; left
  alone because the round-2 freeze law is protected and the spec scoped the
  release to sustained spirals.
- PRE-EXISTING (reproduced on pristine origin/main): while the YouTube
  player initializes after a sheet load with music, frame()'s synced branch
  computes state.t = NaN for a few frames (getCurrentTime/music.start race)
  and render() sprays NaN attribute console errors until the player readies.
  Not camera code; not touched.
