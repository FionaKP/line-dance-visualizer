# Boot attitude tuning log

Goal: the 3D boot physically angles for heel digs, toe touches, hooks, kicks,
scuffs, sweeps and stomps — anchored rotations keep the contact point planted,
transitions blend with the step's motion window.

Method: figures.txt fixture on :8133, `__at(beat)` seeks + zooms; a debug-only
in-browser `__gallery(specs, yaws)` renders the boot at every attitude x 4
headings without touching source. Verdicts from screenshots.

## Iteration 1 — rigid whole-boot pitch about an anchored pivot

Hypothesis: rotating the whole mesh about the toe tip / heel corner (pivot
re-added un-rotated so the anchor stays planted) is enough.

Change: boot3d.js rot3 gained pitch/roll about pose.pivot before yaw;
footState returns blended `att`; placeFoot passes it (toe +42 anchored toe,
heel -30 anchored heel).

Screenshot verdict: rotation math works — anchor stays put at all 4 yaws, no
shading/stitch artifacts. BUT a 42-degree rigid toe point reads as a boot
knocked over face-first, and the heel dig's shaft leans back like a falling
chimney. A real boot bends at the ankle: the foot pitches fully while the
shaft stays near vertical. Need a two-stage rotation (rigid about the pivot,
then counter-rotate the shaft about the moved ankle by (1-bend)*pitch).

## Iteration 2 — ankle hinge (bend)

Hypothesis: rigid pitch about the anchor + shaft counter-rotation about the
(already-pitched) ankle makes anchored poses read as a flexed foot instead of
a toppled boot. bend = fraction of pitch the shaft keeps (toe 0.3, heel 0.55).

Change: boot3d.js gained `bend` — rigid() about pivot, then verts above the
ankle band (z 9..16 smoothstep) counter-rotate by (1-bend)*pitch about the
moved ankle. Stitch normals rotate by the net angle at their own height.

Gallery verdict (debug 4x3 grid, yaws 0/90/180/270): heel/90 now reads as a
true heel dig — shin leans back ~14 deg, toe visibly off the floor, heel
corner planted. toe/90 confused me until I projected landmarks numerically:
toe tip planted at (+30,0), ankle risen to z=30, heel kicked up behind — the
boot stands en pointe, which is geometrically right; the "foot going the
wrong way" was the raised heel block. Keep.

## Iteration 3 — real dance flow (figures.txt)

Checked: t=5.85 blend into heel dig (boot tips back smoothly while gliding
forward — no snap), t=6.2 settled heel dig from behind (contact crescent
under the heel, collar opening opens up as the shaft leans back — reads
well), t=7.3 hook (R boot lifted, yawed -30 across the body, toe angled
down, sole showing — reads as a hook, not a hover), t=10.25 kick mid-flight
(toe-up visible as the opened collar), t=15.7 stomp raise (subtle rear-up),
t=19.3 toe touch behind from a 6:00 facing (en-pointe boot from behind,
raised heel tread facing camera — convincing). Transitions all blend with the
step window since att is lerped by the same eased s.

Note: figures.txt has no sweep/scuff/hitch — added a custom paste snippet for
those (loader panel accepts arbitrary text; fixture untouched).

Gotcha found while testing: after btn-load the music-sync clock (ytPlayer
carried over from the default dance) rewrites state.t to 0 every frame, so
seeks silently landed on beat 0 — two "verdict" screenshots were actually
t=0. Fixed the harness (__go forces music.synced=false), re-shot. Also saw a
transient NaN azim from that same sync path (music.start undefined) —
pre-existing, music/UI territory, not touched.

## Iteration 4 — sweep / scuff / hitch (custom sheet)

t=2.2 scuff (airborne, slight toe-up — reads as a brushing foot), t=3.3
hitch/KNEE (boot hangs steeply toe-down under the raised knee, heel tread
visible — the best-reading pose of the set), t=4.85 sweep (floaty, mild
pitch/roll). Sweep read as "flat boot on a curved path" — the goal wants it
yawing through the arc. Deferred to iteration 6.

## Iteration 5 — steeper camera (?tilt=50) + 2D untouched

Heel dig and toe touches re-checked at tilt 50: heel dig leans back with a
wide-open collar, contact crescent exactly under the heel corner; toe touch
en pointe with the crescent under the anchored tip (the ring now slides out
to the boot's true tip/heel in 3D, blended by bootIn so 2D keeps its old
±14/18px spots). Same-foot heel(6)→hook(7) morph at t=6.8: coherent mesh, no
shading pops. 2D check (view3d off): flat prints + pad/heel fade language
identical to before — attitude only touches the 3D boot.

## Iteration 6 — sweep yaw swing

Change: footState's transition attitude goes through moveAttitude(); when the
landing keyframe is a SWEEP the toe fans outward by +/-22 deg * sin(pi*raw)
(zero at both window ends, so the landing never snaps). t=4.75 screenshot:
the sweeping boot now visibly yaws through the arc. Keep.

## Landed attitude table

| move (badge/pose)        | pitch  | roll    | yawOff   | bend | anchor |
|--------------------------|--------|---------|----------|------|--------|
| heel dig (pose heel)     | -30    | 0       | 0        | 0.55 | heel corner [-13.6,0,0] |
| toe/touch/point/drag (pose toe) | +42 | 0     | 0        | 0.3  | toe tip [27.5,0,0] |
| HOOK                     | +35    | +/-14   | -/+30    | 0.5  | none (ankle) |
| KNEE (hitch)             | +48    | 0       | 0        | 0.5  | none |
| KICK                     | -20    | 0       | 0        | 0.8  | none |
| SCUFF                    | -16    | 0       | 0        | 0.8  | none |
| SWEEP                    | +10    | -/+8    | swing +/-22*sin(pi*raw) | 0.6 | none |
| STOMP (raise)            | -14*sin(pi*raw/0.8), flat by landing | 0 | 0 | 1 | none |

(pitch > 0 = toe down; signs mirror by foot; flat steps carry no att at all.)
