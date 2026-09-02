# Motion style log

Iteration notes for the motion-character work (PROFILES, footState easing,
groove, thetaAt). Evidence sources: the per-video analyses in the style
round's analysis notes (amame, tush-push, sambas-and-sailors, ten-thirty-five,
cupid-shuffle, electric-slide, canadian-stomp, twinkle-toes-waltz).

## Round 1 (style-motion-r1)

**1. Grounded ordinary steps.** PROFILES.step arc 1 -> 0.3. Every video shows
3-8cm swing-foot clearance and zero airtime on plain steps; kicks (arc 1 +
snapLift), stomps (1.5 impact branch) and hooks keep their height so accents
pop by contrast — verified on canadian-stomp: plain-step peak lift 0.3, kick
1.26, stomp 1.5. (A step that *sets down from* a lifted pose still starts at
the pose's lift and descends — that is the pose, not a hop.)

**2. Beat-locked groove pulse.** render() computes a ~2px down-screen dip on
each count (cosine of the beat phase of state.t, down ON the beat), applied to
the feet's sy in placeFoot and to the glow (converted into the world layer's
pre-transform frame). Purely cosmetic: floor coordinates, landings, trails and
badges untouched. Gated on the Groove toggle AND on curSinTilt (same gate
shape as bootIn), so 2D stays bit-identical — measured dip 2.0px in 3D, 0.0
in 2D. Kept small (cupid/tush-push/electric-slide pulse every count, but
amame and ten-thirty-five are zero-bounce).

**3. Fast resets out of held poses.** footState scales the return window by
0.55 when prev is a lifted toe/heel pose and next is a plain step/drag: the
attitude holds ~75% of a full count, the reset is one quick late motion
(tush-push: 75/25, "even splits look robotic"). Verified on tush-push heel
digs: pitch -30 held through ~75% of the gap, then a fast blend to flat that
still lands exactly on the beat.

**4. SWEEP as a floor-level compass arc.** arc 1.15 -> 0.2, win 1.35 -> 2.2
(still clamped by 0.9x the inter-keyframe gap, so it owns its full count),
pos switched to the steady cosine glide, plus a mandatory perpendicular bow
(0.35 * dist * sin(pi*raw), mirrored per foot, zero at both endpoints) so the
path traces a visible semicircle. poseLift for badge SWEEP now returns 0.15:
the sweeping toe skims 3-5cm for the whole arc instead of floating to full
air lift (amame: "a compass drawing a semicircle, not a kick"). Verified on
amame count 4: path bows ~0.4 units perpendicular, lift peaks 0.18.

**5. Chained turns spiral continuously.** thetaAt: consecutive theta keyframes
within CHAIN_GAP (2.05 beats) interpolate over the FULL inter-keyframe span —
constant spin mid-chain, ease-out brake on the chain's last segment, ease-in
wind-up on the approach. Verified on sambas-and-sailors Sec3: one continuous
45 deg/count rotation across counts 14-21, no snapped eighths, every keyframe
landed exactly. Camera law untouched: sim over the spiral shows
maxFollowRate 119.9 (cap 120).

**6. Lone pivots snap mid-count.** An isolated theta keyframe with |dTh| >= 85
uses win = min(1 beat, 0.9*gap) and a fast-middle profile: hold ~30%, whip
through the central ~45%, ease-out settle, s = 1 exactly at the beat
(tush-push: 180 in 0.3-0.4s; "linear over the full 2 counts looks mushy").
Small isolated turns (shuffle eighths) keep the classic MOVE_WINDOW ease.

**7. Drags/closes own their whole gap.** PROFILES.drag win 1.25 -> 2 and arc
0.18 -> 0.1; PROFILES.glide win 1.3 -> 2 as well, because textual "drag/slide"
steps route to glide (amame's signature long-side-step drag is prof glide) and
the footage calls for one full-count toe-contact slide. Verified on amame
count 33 drag: motion fills 0.9 beats of its 1-count slide window.

**Invariants re-checked after all changes:** every foot keyframe and theta
keyframe evaluates exactly to its landing value at its beat (worst position
error 0, worst theta error 2e-7 deg, groove ON); 2D view unchanged (dip 0,
glyph language untouched); node tests/run.js 172/172 green.
