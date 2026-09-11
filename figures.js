"use strict";
// ---------------------------------------------------------------------------
// Figure catalog: detection, styling, and labeling of named line-dance
// figures over the parser's event stream. Pure (no DOM) so Node tests and
// tuning sims can require() it; the page loads it as a global (FIGURES).
//
// Three jobs:
//   detectFigures(parsed) -> [{figureId, startBeat, endBeat, foot, meta}]
//       Structural matchers over parsed events. Structure ALWAYS outranks
//       header prose — sheet-title words lie (drunken-sailor has no sailors,
//       gypsy-queen's "monterey" is paddle turns).
//   applyStyling(parsed, ctx) -> tags; also (once) applies each figure's
//       motion TEMPLATE to its tagged events: placements snap to the one
//       canonical rendered form of the figure, and hints (turnout, glide,
//       accent) are stamped for the timeline builder to carry onto
//       keyframes. ctx modulates character (tempo bands); choreography —
//       beats, sheet turns, travel direction — is never changed.
//   separateFeet(...)     -> the HARD spacing rule, applied to every landing
//       at keyframe construction: boots never share a spot.
//
// Every FIGURES entry also carries `canon`: a canonical, seamlessly loopable
// count sequence [{count, foot, action, dx, dy, turn}] (dx/dy relative to
// the other foot in the dancer's frame, real signed values for that foot —
// NOT the parser's right-foot-then-mirror convention) for reuse by a future
// learn-the-steps demo page.
// ---------------------------------------------------------------------------

// --- hard spacing rule -----------------------------------------------------
// Boot footprint is ~0.56 floor units wide and ~1.05 long. Side-by-side
// boots need daylight; crosses may reach zero lateral daylight (thigh
// contact) but never identical centers — they separate fore-aft instead.
const SEP = {
  grounded: 0.62,      // min center distance, two weighted flat boots
  cross: 0.5,          // min center distance while crossed
  crossStagger: 0.45,  // min fore-aft offset while crossed
  lifted: 0.32,        // min center distance for touches/taps/airborne dabs
  closeLo: 0.81,       // "together" daylight clamp: 0.56 + 0.25
  closeHi: 1.06,       //                            0.56 + 0.50
  stagger: 0.1         // slight fore-aft offset on together counts
};

function natSign(foot) { return foot === "R" ? 1 : -1; }

// pos/other are world coords; thetaDeg is the dancer's facing. Returns the
// (possibly pushed-apart) landing position for `pos`.
function separateFeet(pos, other, ev, thetaDeg) {
  if (!ev || !ev.foot) return pos;
  const th = thetaDeg * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const wx = pos.x - other.x, wy = pos.y - other.y;
  // world -> dancer frame (inverse of the timeline's rotation)
  let fx = wx * c - wy * s;   // + = dancer's right
  let fy = wx * s + wy * c;   // + = forward
  const ns = natSign(ev.foot);
  const nat = fx * ns;        // + = on its own natural side (uncrossed)
  const backOut = () => {
    const rx = fx * c + fy * s, ry = -fx * s + fy * c;
    return { x: other.x + rx, y: other.y + ry };
  };
  let dist = Math.hypot(fx, fy);
  if (dist < 1e-4) { fx = ns * 0.2; fy = 0.1; dist = Math.hypot(fx, fy); }
  // a cross is an intent (the step aims across the support line) or a
  // landing genuinely on the wrong side; a together step that merely lands
  // tight stays a "close" and gets the daylight clamp instead
  const crossed = (ev.dx || 0) * ns < 0.2 || nat < -0.25;

  if (ev.self) {
    // splits/swivels move relative to the foot's own spot; only guarantee
    // non-coincidence
    if (dist < 0.2) { const k = 0.2 / dist; fx *= k; fy *= k; }
    return backOut();
  }
  if (ev.lifted) {
    if (dist < SEP.lifted) { const k = SEP.lifted / dist; fx *= k; fy *= k; }
    return backOut();
  }
  if (crossed) {
    // crossed landing: keep the fore-aft stagger honest, centers apart
    if (Math.abs(fy) < SEP.crossStagger) {
      const sign = fy !== 0 ? Math.sign(fy) : ((ev.dy || 0) >= 0 ? 1 : -1);
      fy = sign * SEP.crossStagger;
    }
    dist = Math.hypot(fx, fy);
    if (dist < SEP.cross) { const k = SEP.cross / dist; fx *= k; fy *= k; }
    return backOut();
  }
  // together/close counts: clamp to 0.25-0.5 units of daylight with a
  // slight fore-aft stagger (feet measure 2-4in apart in footage, never touch)
  if (nat < 1.2 && Math.abs(fy) < 0.35) {
    const lat = Math.min(SEP.closeHi, Math.max(SEP.closeLo, nat));
    fx = lat * ns;
    if (Math.abs(fy) < 0.06) fy = SEP.stagger * ns; // R gathers a touch fore, L aft
    return backOut();
  }
  dist = Math.hypot(fx, fy);
  if (dist < SEP.grounded) { const k = SEP.grounded / dist; fx *= k; fy *= k; }
  return backOut();
}

// --- event classification --------------------------------------------------
// Map a parsed event to a structural symbol. dx is stored with the parser's
// left-foot mirror applied, so nat = dx * natSign is side-agnostic.
function classify(ev) {
  if (!ev) return null;
  if (ev.clap) return "clap";
  if (!ev.foot) {
    if (ev.turn) return "turn";
    if (ev.weight) return "recover";
    if (/\b(bump|hip)/i.test(ev.txt || "")) return "bump";
    return "hold";
  }
  const ns = natSign(ev.foot);
  const nat = (ev.dx || 0) * ns;
  const dy = ev.dy || 0;
  const b = ev.badge || "";
  if (ev.self) {
    if (b === "HEELS" || b === "TOES") return "split_out";
    if (b === "SWIVEL" || b === "BOUNCE") return "self";
    if (Math.abs(ev.dx || 0) < 0.05 && Math.abs(dy) < 0.05) return "drop"; // strut heel drop
    return nat < 0 ? "split_in" : "self";
  }
  if (b === "LOCK") return dy > 0 ? "lockF" : "lockB";
  if (b === "STOMP") return "stomp";
  if (b === "KICK") return "kick";
  if (b === "SCUFF") return "scuff";
  if (b === "HOOK") return "hook";
  if (b === "KNEE") return "hitch";
  if (b === "SWEEP") return "sweep";
  if (ev.lifted) {
    if (b === "HEEL") return dy > 0.4 ? "heelF" : "heelB";
    if (dy > 0.4) return "touchF";
    if (dy < -0.4) return "touchB";
    if (nat > 1.2) return "touchS";
    return "touch";
  }
  const rock = /\brock\b/i.test(ev.txt || "");
  if (nat < -0.05 && Math.abs(dy) <= 0.6) return dy >= 0 ? "crossF" : "crossB";
  if (dy > 0.6) return rock ? "rockF" : "fwd";
  if (dy < -0.6) return rock ? "rockB" : "back";
  if (nat >= 1.3) return rock ? "rockS" : "side";
  return "close";
}

function buildStream(parsed) {
  return parsed.events.map((ev, i) => ({
    i, ev, beat: ev.beat, foot: ev.foot || null,
    sym: classify(ev), turn: ev.turn || 0, txt: (ev.txt || "").toLowerCase()
  }));
}

function other(f) { return f === "R" ? "L" : "R"; }

// gap helpers: figures are contiguous — consecutive items at most `max`
// beats apart (default a count and a half, so &-counts and holds fit)
function near(a, b, max) { return b && a && (b.beat - a.beat) <= (max || 1.55) + 1e-6; }
function isAnd(a, b) { return b && a && (b.beat - a.beat) <= 0.5 + 1e-6; }

// --- matchers --------------------------------------------------------------
// Each returns { len, foot, meta } (len = stream items consumed) or null.
// Written against real parsed output (see tuning/corpus): symbols only,
// never section-header prose — except as a variant hint (rolling vines).

function mVine(st, i) {
  const a = st[i], b = st[i + 1], c = st[i + 2];
  if (!a || !b || !c) return null;
  if (a.sym !== "side" || !near(a, b)) return null;
  const f = a.foot, o = other(f);
  if (b.foot !== o || b.sym !== "crossB" || !near(b, c)) return null;
  // count 3: side again, or a turning step ending the vine with a 1/4
  const turn3 = c.turn !== 0 && (c.sym === "side" || c.sym === "fwd" || c.sym === "close");
  if (c.foot !== f || (c.sym !== "side" && !turn3)) return null;
  const rolling = /roll/.test(a.txt) || /roll/.test(b.txt);
  let len = 3;
  const d = st[i + 3];
  if (d && near(c, d) && d.foot !== f &&
      ["touch", "touchS", "scuff", "stomp", "kick", "hitch", "close", "heelF"].includes(d.sym)) len = 4;
  else if (d && near(c, d) && d.sym === "clap") len = 4;
  return { len, foot: f, meta: { rolling, dir: f, turn3: turn3 ? c.turn : 0 } };
}

function mWeave(st, i) {
  // contiguous alternating-feet run of side/cross/close containing BOTH a
  // front and a back cross, length >= 4
  const ok = ["side", "crossB", "crossF", "close"];
  let j = i, hasF = false, hasB = false, lastFoot = null;
  while (st[j] && ok.includes(st[j].sym) &&
         (j === i || (near(st[j - 1], st[j], 1.05) && st[j].foot !== lastFoot))) {
    if (st[j].sym === "crossF") hasF = true;
    if (st[j].sym === "crossB") hasB = true;
    lastFoot = st[j].foot;
    j++;
  }
  const len = j - i;
  if (len >= 4 && hasF && hasB) return { len, foot: st[i].foot, meta: {} };
  return null;
}

function mJazzBox(st, i) {
  const a = st[i], b = st[i + 1], c = st[i + 2], d = st[i + 3];
  if (!a || !b || !c || !d) return null;
  const f = a.foot, o = other(f);
  if (a.sym !== "crossF" || !near(a, b)) return null;
  if (b.foot !== o || b.sym !== "back" || !near(b, c)) return null;
  if (c.foot !== f || !["side", "close"].includes(c.sym) || !near(c, d)) return null;
  if (d.foot !== o || !["close", "fwd", "side"].includes(d.sym)) return null;
  const turn = (a.turn || 0) + (b.turn || 0) + (c.turn || 0) + (d.turn || 0);
  return { len: 4, foot: f, meta: { turn } };
}

function mKStep(st, i) {
  // four (diagonal step, touch-beside) pairs, dirs fwd/back/back/fwd,
  // alternating feet; claps ride the touches
  const dirs = ["fwd", "back", "back", "fwd"];
  let j = i, foot = null, len = 0;
  for (let p = 0; p < 4; p++) {
    const a = st[j];
    if (!a || a.sym !== dirs[p]) return null;
    if (p === 0) foot = a.foot;
    else if (a.foot !== (p % 2 ? other(foot) : foot)) return null;
    const b = st[j + 1];
    if (!b || b.foot !== other(a.foot) || b.sym !== "touch" || !near(a, b, 1.05)) return null;
    j += 2;
    if (st[j] && st[j].sym === "clap" && st[j].beat === b.beat) j++;
    if (p < 3 && !near(b, st[j], 1.05)) return null;
    len = j - i;
  }
  return { len, foot, meta: {} };
}

function mLindy(st, i) {
  // side chasse + rock back + recover (6-8 count lindy half)
  const a = st[i], b = st[i + 1], c = st[i + 2], d = st[i + 3], e = st[i + 4];
  if (!a || !b || !c || !d || !e) return null;
  const f = a.foot, o = other(f);
  if (a.sym !== "side" || b.foot !== o || b.sym !== "close" || !isAnd(a, b)) return null;
  if (c.foot !== f || c.sym !== "side" || !near(b, c)) return null;
  if (d.foot !== o || d.sym !== "rockB" || !near(c, d)) return null;
  if (e.sym !== "recover" && !(e.foot === f && e.sym === "close")) return null;
  return { len: 5, foot: f, meta: {} };
}

function mRockingChair(st, i) {
  const a = st[i], b = st[i + 1], c = st[i + 2], d = st[i + 3];
  if (!a || !b || !c || !d) return null;
  const f = a.foot;
  if (a.sym !== "rockF" || b.sym !== "recover" || !near(a, b)) return null;
  if (c.foot !== f || c.sym !== "rockB" || !near(b, c)) return null;
  if (d.sym !== "recover" || !near(c, d)) return null;
  return { len: 4, foot: f, meta: {} };
}

function mCoaster(st, i) {
  const a = st[i], b = st[i + 1], c = st[i + 2];
  if (!a || !b || !c) return null;
  const f = a.foot, o = other(f);
  if (a.sym !== "back" && a.sym !== "rockB") return null;
  if (b.foot !== o || b.sym !== "close" || !isAnd(a, b)) return null;
  if (c.foot !== f || c.sym !== "fwd" || !near(b, c, 0.55)) return null;
  return { len: 3, foot: f, meta: {} };
}

function mSailor(st, i) {
  const a = st[i], b = st[i + 1], c = st[i + 2];
  if (!a || !b || !c) return null;
  const f = a.foot, o = other(f);
  // behind (stepped or swept) + out-out on a syncopated 1&2
  const behind = a.sym === "crossB" ||
    (a.sym === "sweep" && (/(behind|back)/.test(a.txt) || (a.ev.dy || 0) < 0));
  if (!behind || b.foot !== o || !near(a, b, 0.55)) return null;
  if (!["side", "close"].includes(b.sym)) return null;
  if (c.foot !== f || !["side", "close"].includes(c.sym) || !near(b, c, 0.55)) return null;
  return { len: 3, foot: f, meta: {} };
}

function mMambo(st, i) {
  const a = st[i], b = st[i + 1], c = st[i + 2];
  if (!a || !b || !c) return null;
  const f = a.foot;
  // rock-recover-CLOSE (mambo). The third step must gather — a rock-recover
  // followed by a traveling step is the next figure's pickup, not a mambo
  if (["rockF", "rockB", "rockS"].includes(a.sym) && b.sym === "recover" && near(a, b)) {
    if (c.foot === f && c.sym === "close" && near(b, c)) {
      return { len: 3, foot: f, meta: { variant: "mambo", dir: a.sym } };
    }
  }
  // ... or the cha/triple basic: step, &-together, step (same direction)
  if ((a.sym === "fwd" || a.sym === "back") && b.foot === other(f) &&
      b.sym === "close" && isAnd(a, b) &&
      c.foot === f && c.sym === a.sym && near(b, c, 0.55)) {
    return { len: 3, foot: f, meta: { variant: "cha", dir: a.sym } };
  }
  return null;
}

function mLock(st, i) {
  const a = st[i], b = st[i + 1], c = st[i + 2];
  if (!a || !b || !c) return null;
  const f = a.foot, o = other(f);
  if (a.sym !== "fwd" && a.sym !== "back") return null;
  if (b.foot !== o || (b.sym !== "lockF" && b.sym !== "lockB") || !near(a, b)) return null;
  if (c.foot !== f || !["fwd", "back", "close"].includes(c.sym) || !near(b, c)) return null;
  return { len: 3, foot: f, meta: { dorothy: isAnd(b, c) } };
}

function mPivot(st, i) {
  const a = st[i], b = st[i + 1];
  if (!a || !b) return null;
  if (a.sym !== "fwd" || !near(a, b)) return null;
  if ((b.sym !== "turn" && b.sym !== "recover") || Math.abs(b.turn) < 85) return null;
  return { len: 2, foot: a.foot, meta: { deg: b.turn } };
}

function mMonterey(st, i) {
  // point side, close WITH the turn (the rotation happens on the closing
  // step, spinning on the standing ball), then usually point/close other side
  const a = st[i], b = st[i + 1];
  if (!a || !b) return null;
  const f = a.foot;
  if (a.sym !== "touchS" || !near(a, b)) return null;
  let len, deg;
  if (b.foot === f && b.sym === "close" && Math.abs(b.turn) >= 85) { len = 2; deg = b.turn; }
  else if (b.sym === "turn" && Math.abs(b.turn) >= 85 && st[i + 2] &&
           st[i + 2].foot === f && st[i + 2].sym === "close" && near(b, st[i + 2], 0.55)) {
    len = 3; deg = b.turn;
  } else return null;
  const c = st[i + len], d = st[i + len + 1];
  if (c && d && c.foot === other(f) && c.sym === "touchS" && near(st[i + len - 1], c) &&
      d.foot === other(f) && d.sym === "close" && near(c, d)) len += 2;
  return { len, foot: f, meta: { deg } };
}

function mScissor(st, i) {
  const a = st[i], b = st[i + 1], c = st[i + 2];
  if (!a || !b || !c) return null;
  const f = a.foot, o = other(f);
  if (a.sym !== "side" && a.sym !== "rockS") return null;
  if (b.foot !== o || b.sym !== "close" || !isAnd(a, b)) return null;
  if (c.foot !== f || c.sym !== "crossF" || !near(b, c, 0.55)) return null;
  return { len: 3, foot: f, meta: {} };
}

function mCharleston(st, i) {
  const a = st[i], b = st[i + 1], c = st[i + 2], d = st[i + 3];
  if (!a || !b || !c || !d) return null;
  const f = a.foot;
  if ((a.sym !== "touchF" && a.sym !== "kick") || !near(a, b)) return null;
  if (b.foot !== f || b.sym !== "back" || !near(b, c)) return null;
  if (c.foot !== other(f) || c.sym !== "touchB" || !near(c, d)) return null;
  if (d.foot !== other(f) || d.sym !== "fwd") return null;
  return { len: 4, foot: f, meta: {} };
}

function mHipBumps(st, i) {
  let j = i, n = 0;
  while (st[j] && (st[j].sym === "bump" ||
         (st[j].sym === "rockF" && /bump|hip/.test(st[j].txt)) ||
         (st[j].sym === "recover" && st[j + 1] && st[j + 1].sym === "bump") ||
         // bump-mode continuation counts ("Right", "Left") parse as holds
         (n >= 1 && st[j].sym === "hold" && /^(right|left|hips?|bump)/.test(st[j].txt)))) {
    if (st[j].sym === "bump" || (n >= 1 && st[j].sym === "hold")) n++;
    j++;
  }
  if (n < 2) return null;
  // stance: wide planted (preceded by an out-out side placement), forward
  // rocking (preceded by a forward step), else the narrow/stride default
  let stance = "stride";
  for (let k = i - 1; k >= 0 && k >= i - 3; k--) {
    const p = st[k];
    if (!p.foot) continue;
    if (p.sym === "side") { stance = "wide"; break; }
    if ((p.sym === "fwd" || p.sym === "rockF") && !/in place/.test(p.txt)) { stance = "fwd"; break; }
    if (p.sym === "rockF" || /in place/.test(p.txt)) { stance = "stride"; break; }
    break;
  }
  return { len: j - i, foot: st[i].foot, meta: { stance, bumps: n } };
}

function mHeelSplits(st, i) {
  // split_out / split_in come in same-beat L+R pairs
  let j = i, moves = 0;
  while (st[j] && (st[j].sym === "split_out" || st[j].sym === "split_in")) {
    if (st[j + 1] && st[j + 1].sym === st[j].sym && st[j + 1].beat === st[j].beat) j++;
    moves++; j++;
  }
  if (moves < 2 || st[i].sym !== "split_out") return null;
  return { len: j - i, foot: null, meta: { moves } };
}

function mKickBallChange(st, i) {
  const a = st[i];
  if (!a || a.sym !== "kick") return null;
  const f = a.foot;
  const b = st[i + 1], c = st[i + 2];
  if (b && b.foot === f && b.sym === "close" && isAnd(a, b) &&
      c && c.foot === other(f) && ["close", "drop"].includes(c.sym) && isAnd(b, c)) {
    return { len: 3, foot: f, meta: { full: true } };
  }
  // sheets that write "kick-ball-change" as one phrase parse to a lone kick
  if (/ball[\s-]?change/.test(a.txt)) return { len: 1, foot: f, meta: { full: false } };
  return null;
}

// --- motion templates ------------------------------------------------------
// Every catalog figure carries a `template`: the ONE canonical rendered form
// of that figure, expressed as data. When detection tags a span, the
// template normalizes the tagged events — placement magnitudes, spacing,
// turnout, and motion character snap to the catalog form — so the same
// figure reads identically in every dance. Templates never touch the
// choreography: beats are never moved, sheet-stated turns are never changed
// (a rolling vine ADDS a whole revolution — facing preserved), and travel
// direction always stays what the sheet said; only magnitudes standardize.
//
// Template schema (all placement numbers in floor units):
//   rules: { <classify() symbol>: spec, ... }   matched per tagged event
//   seq:   [ spec | null, ... ]                 per-position override for
//          fixed-length figures (a non-null seq[k] REPLACES the symbol rule
//          for the span's k-th event)
//   variants: { name: { when: {metaKey: value}, rules?, seq?, pre? } }
//          first variant whose `when` keys all equal span.meta wins; its
//          rules/seq replace the base ones, its pre augments
//   pre:   { lookback: N, rules: {...} }        normalizes the setup steps
//          just before the span (hip-bump stances plant wide, etc.)
//   tempo: { slow: bpm, fast: bpm }             band edges (defaults below)
//
// spec fields:
//   dx       canonical lateral placement in OWN-NATURAL units: +dx is the
//            stepping foot's own natural side, -dx is a cross. Converted to
//            the parser's mirrored dx convention at application.
//   dy       canonical fore-aft placement (dancer frame, unmirrored)
//   ground   "give" (a cross drops the reference line back; records dy) /
//            "regain" (this step recovers it: dy = -given). Keeps a vine or
//            weave's travel one straight lateral line.
//   turnAdd  degrees added to ev.turn, mirrored by the span's leading foot
//            (rolling vines spiral a full revolution — net facing unchanged)
//   turnout  boots-yaw degrees for cross landings (kfAttitude hook)
//   aOffAdd  degrees added to ev.aOff on the foot's natural sign
//   motion   "glide" | "step", or { slow, mid, fast } keyed by tempo band —
//            the tempo-aware character hook (vines glide when slow, sharpen
//            when fast)
//   accent   true — this is where the figure pops (keyframes carry it; the
//            renderer gives accented landings a touch more arc)
//
// Application context (applyStyling(parsed, ctx)):
//   ctx.bpm    song tempo; buckets into slow/mid/fast bands (defaults: slow
//              <= 84, fast >= 116) for the per-rule `motion` hook
//   ctx.style  reserved dance-level styling knobs for future per-song work
// Surrounding figures are visible as parsed.figures; today the only
// cross-figure rule is accent thinning: back-to-back repeats of the same
// figure (vine R directly into vine L) pop once, on the last repeat.

const TEMPO_BANDS = { slow: 84, fast: 116 };

function tempoBand(bpm, tpl) {
  if (!bpm) return "mid";
  const edges = (tpl && tpl.tempo) || {};
  const slow = edges.slow !== undefined ? edges.slow : TEMPO_BANDS.slow;
  const fast = edges.fast !== undefined ? edges.fast : TEMPO_BANDS.fast;
  return bpm <= slow ? "slow" : bpm >= fast ? "fast" : "mid";
}

function motionFor(spec, band) {
  const m = spec.motion;
  if (!m) return null;
  if (typeof m === "string") return m;
  return m[band] !== undefined ? m[band] : (m.mid !== undefined ? m.mid : null);
}

function pickVariant(tpl, span) {
  if (!tpl.variants) return null;
  for (const name of Object.keys(tpl.variants)) {
    const v = tpl.variants[name];
    const w = v.when || {};
    if (Object.keys(w).every(k => span.meta[k] === w[k])) return v;
  }
  return null;
}

// Apply one spec to one event. `ns` mirrors own-natural dx into the parser's
// stored convention; `dir` mirrors turnAdd by the span's leading foot.
// Self-moves (swivels, splits) and footless events only take character
// fields — a template never relocates a foot relative to itself.
function applySpec(ev, spec, dir, band, groundRef) {
  const geometric = ev.foot && !ev.self;
  const ns = ev.foot ? natSign(ev.foot) : dir;
  if (geometric) {
    if (spec.dx !== undefined) ev.dx = ns * spec.dx;
    if (spec.dy !== undefined) ev.dy = spec.dy;
    if (spec.ground === "regain") { ev.dy = -groundRef.dy; groundRef.dy = 0; }
    if (spec.ground === "give") groundRef.dy = ev.dy;
    if (spec.turnout !== undefined) ev.turnout = spec.turnout;
    if (spec.aOffAdd !== undefined) ev.aOff = (ev.aOff || 0) + ns * spec.aOffAdd;
  }
  if (spec.turnAdd) ev.turn = (ev.turn || 0) + spec.turnAdd * dir;
  const mo = motionFor(spec, band);
  if (mo === "glide") ev.glide = true;
  else if (mo === "step") delete ev.glide;
  if (spec.accent) ev.accent = true;
}

function applyTemplate(events, span, ctx) {
  const tpl = REGISTRY[span.figureId].template;
  if (!tpl) return;
  const band = tempoBand(ctx && ctx.bpm, tpl);
  const variant = pickVariant(tpl, span);
  const rules = (variant && variant.rules) || tpl.rules || {};
  const seq = (variant && variant.seq) || tpl.seq || null;
  const dir = natSign(span.foot || "R");
  const groundRef = { dy: 0 };
  span.idx.forEach((ei, k) => {
    const ev = events[ei];
    const spec = (seq && seq[k]) || rules[classify(ev)];
    if (spec) applySpec(ev, spec, dir, band, groundRef);
  });
  const pre = (variant && variant.pre) || tpl.pre;
  if (pre) {
    // normalize the setup steps immediately before the span (planted stances)
    for (let k = span.idx[0] - 1; k >= 0 && k >= span.idx[0] - pre.lookback; k--) {
      const ev = events[k];
      if (!ev || !ev.foot || ev.lifted) continue;
      const spec = pre.rules[classify(ev)];
      if (spec) applySpec(ev, spec, dir, band, groundRef);
    }
  }
}

// --- registry --------------------------------------------------------------
// header: prose regex (a hint/label aid only — structure decides);
// match: structural matcher; canon: loopable teaching sequence;
// template: the canonical rendered form applied to tagged spans (schema
// above). Template geometry and canon geometry are the same numbers — the
// tests assert they agree, so the learn-the-steps demo (canon) and in-dance
// rendering (template) share one source of truth.
// (named REGISTRY, not FIGURES: in the browser this file is a classic
// script, and a top-level `const FIGURES` would shadow the window.FIGURES
// API object for every other script on the page)
const REGISTRY = {
  vine: {
    label: s => (s && s.meta && s.meta.rolling ? "Rolling vine " : "Vine ") + (s ? s.foot : "R"),
    header: /\b(grapevine|(?:rolling\s+)?vine|weave)\b/i,
    match: mVine,
    template: {
      rules: {
        // wide side reach along one straight lateral line ("regain" undoes
        // the ground the behind-cross gave up); floor-skim glide at easy
        // tempos, a crisper step when the song pushes
        side:   { dx: 1.7, ground: "regain",
                  motion: { slow: "glide", mid: "glide", fast: "step" } },
        // LOOSE behind: narrow stagger, toe well behind the other heel —
        // never a ballet lock
        crossB: { dx: -0.2, dy: -0.6, ground: "give",
                  motion: { slow: "glide", mid: "glide", fast: "step" } },
        // the count-4 touch gathers beside the support and pops
        touch:  { dx: 0.85, dy: 0, accent: true }
      },
      variants: {
        // rolling vine: same lateral floor line, rotation layered
        // continuously across counts 1-3 split 1/4-1/2-1/4 (a full added
        // revolution — facing preserved), travel vector constant 1.25u/count
        rolling: {
          when: { rolling: true },
          seq: [
            { turnAdd: 90,  dx: 0,   dy: 1.25,  motion: "glide" },
            { turnAdd: 180, dx: 0,   dy: -1.25, motion: "glide" },
            { turnAdd: 90,  dx: 1.5, dy: 0,     motion: "glide" }
          ]
        }
      }
    },
    canon: [
      { count: 1, foot: "R", action: "side",       dx: 1.7,  dy: 0 },
      { count: 2, foot: "L", action: "cross_back", dx: 0.2,  dy: -0.6 },
      { count: 3, foot: "R", action: "side",       dx: 1.7,  dy: 0.6 },
      { count: 4, foot: "L", action: "touch",      dx: -0.85, dy: 0 },
      { count: 5, foot: "L", action: "side",       dx: -1.7, dy: 0 },
      { count: 6, foot: "R", action: "cross_back", dx: -0.2, dy: -0.6 },
      { count: 7, foot: "L", action: "side",       dx: -1.7, dy: 0.6 },
      { count: 8, foot: "R", action: "touch",      dx: 0.85, dy: 0 }
    ]
  },
  weave: {
    label: () => "Weave",
    header: /\bweave\b/i,
    match: mWeave,
    template: {
      rules: {
        crossF: { dx: -0.3, dy: 0.4,   ground: "give" },
        crossB: { dx: -0.2, dy: -0.55, ground: "give" },
        side:   { dx: 1.6, ground: "regain" },
        close:  { ground: "regain" }
      }
    },
    canon: [
      { count: 1, foot: "R", action: "side",        dx: 1.6,  dy: 0 },
      { count: 2, foot: "L", action: "cross_front", dx: 0.3,  dy: 0.4 },
      { count: 3, foot: "R", action: "side",        dx: 1.6,  dy: -0.4 },
      { count: 4, foot: "L", action: "cross_back",  dx: 0.2,  dy: -0.55 },
      { count: 5, foot: "R", action: "side",        dx: 1.6,  dy: 0.55 },
      { count: 6, foot: "L", action: "cross_front", dx: 0.3,  dy: 0.4 },
      { count: 7, foot: "R", action: "side",        dx: 1.6,  dy: -0.4 },
      { count: 8, foot: "L", action: "touch",       dx: -0.85, dy: 0 },
      { count: 9, foot: "L", action: "side",        dx: -1.6, dy: 0 },
      { count: 10, foot: "R", action: "cross_front", dx: -0.3, dy: 0.4 },
      { count: 11, foot: "L", action: "side",       dx: -1.6, dy: -0.4 },
      { count: 12, foot: "R", action: "cross_back", dx: -0.2, dy: -0.55 },
      { count: 13, foot: "L", action: "side",       dx: -1.6, dy: 0.55 },
      { count: 14, foot: "R", action: "cross_front", dx: -0.3, dy: 0.4 },
      { count: 15, foot: "L", action: "side",       dx: -1.6, dy: -0.4 },
      { count: 16, foot: "R", action: "touch",      dx: 0.85, dy: 0 }
    ]
  },
  jazz_box: {
    label: s => "Jazz box" + (s && s.meta.turn ? " ¼" : ""),
    header: /\bjazz\s*(box|square)\b/i,
    match: mJazzBox,
    template: {
      // compact ~1-unit box danced in place: shallow turned-out accent
      // cross, small back weight roll under the hip, side back onto the
      // home line, gather — the box nets zero travel
      seq: [
        { dx: -0.3,  dy: 0.45, turnout: 30, accent: true },
        { dx: -0.28, dy: -0.9 },
        { dx: 0.9,   dy: 0.45 },
        { dx: 0.85,  dy: 0 }
      ]
    },
    canon: [
      { count: 1, foot: "R", action: "cross_front", dx: -0.3,  dy: 0.45 },
      { count: 2, foot: "L", action: "back",        dx: 0.28,  dy: -0.9 },
      { count: 3, foot: "R", action: "side",        dx: 0.9,   dy: 0.45 },
      { count: 4, foot: "L", action: "close",       dx: -0.85, dy: 0 },
      { count: 5, foot: "L", action: "cross_front", dx: 0.3,   dy: 0.45 },
      { count: 6, foot: "R", action: "back",        dx: -0.28, dy: -0.9 },
      { count: 7, foot: "L", action: "side",        dx: -0.9,  dy: 0.45 },
      { count: 8, foot: "R", action: "close",       dx: 0.85,  dy: 0 }
    ]
  },
  k_step: {
    label: () => "K step",
    header: /\bk[\s-]?step\b/i,
    match: mKStep,
    template: {
      // body square to the front the whole time — the diagonals live in the
      // feet (~1.4u along the 45° corner lines); touches dab beside the
      // support instep and pop with their claps
      rules: {
        fwd:   { dx: 1.0, dy: 1.0 },
        back:  { dx: 1.0, dy: -1.0 },
        touch: { dx: 0.7, dy: 0, accent: true }
      }
    },
    canon: [
      { count: 1, foot: "R", action: "fwd_diag",  dx: 1.0,   dy: 1.0 },
      { count: 2, foot: "L", action: "touch",     dx: -0.7,  dy: 0, clap: true },
      { count: 3, foot: "L", action: "back_diag", dx: -1.0,  dy: -1.0 },
      { count: 4, foot: "R", action: "touch",     dx: 0.7,   dy: 0, clap: true },
      { count: 5, foot: "R", action: "back_diag", dx: 1.0,   dy: -1.0 },
      { count: 6, foot: "L", action: "touch",     dx: -0.7,  dy: 0, clap: true },
      { count: 7, foot: "L", action: "fwd_diag",  dx: -1.0,  dy: 1.0 },
      { count: 8, foot: "R", action: "touch",     dx: 0.7,   dy: 0, clap: true }
    ]
  },
  lindy: {
    label: s => "Lindy " + (s ? s.foot : "R"),
    header: /\blindy\b/i,
    match: mLindy,
    template: {
      rules: {
        side:  { dx: 1.6 },
        close: { dx: 0.85, dy: 0.1 },
        rockB: { dx: 0.85, dy: -1.1 }
      }
    },
    canon: [
      { count: 1,   foot: "R", action: "side",    dx: 1.6,   dy: 0 },
      { count: 1.5, foot: "L", action: "close",   dx: -0.85, dy: 0.1 },
      { count: 2,   foot: "R", action: "side",    dx: 1.6,   dy: -0.1 },
      { count: 3,   foot: "L", action: "rock_back", dx: -0.85, dy: -1.1 },
      { count: 4,   action: "recover", weight: "R" },
      { count: 5,   foot: "L", action: "side",    dx: -1.6,  dy: 0 },
      { count: 5.5, foot: "R", action: "close",   dx: 0.85,  dy: 0.1 },
      { count: 6,   foot: "L", action: "side",    dx: -1.6,  dy: -0.1 },
      { count: 7,   foot: "R", action: "rock_back", dx: 0.85, dy: -1.1 },
      { count: 8,   action: "recover", weight: "L" }
    ]
  },
  rocking_chair: {
    label: s => "Rocking chair" + (s && s.foot ? " " + s.foot : ""),
    header: /\brocking\s+chair\b/i,
    match: mRockingChair,
    template: {
      // dead-stationary fore-aft pendulum: full 1.3u rocks (the rock
      // profile's lean-and-rebound supplies the character)
      rules: {
        rockF: { dy: 1.3 },
        rockB: { dy: -1.3 }
      }
    },
    canon: [
      { count: 1, foot: "R", action: "rock_fwd",  dx: 0.85,  dy: 1.3 },
      { count: 2, action: "recover", weight: "L" },
      { count: 3, foot: "R", action: "rock_back", dx: 0.85,  dy: -1.3 },
      { count: 4, action: "recover", weight: "L" }
    ]
  },
  coaster: {
    label: s => "Coaster " + (s ? s.foot : "R"),
    header: /\bcoaster\b/i,
    match: mCoaster,
    template: {
      // sit down into the back, & gather with ~0.5u daylight, forward out
      seq: [
        { dx: 0.85, dy: -1.1 },
        { dx: 1.0,  dy: 0.15 },
        { dx: 0.85, dy: 0.95 }
      ]
    },
    canon: [
      { count: 1,   foot: "R", action: "back",  dx: 0.85,  dy: -1.1 },
      { count: 1.5, foot: "L", action: "close", dx: -1.0,  dy: 0.15 },
      { count: 2,   foot: "R", action: "fwd",   dx: 0.85,  dy: 0.95 },
      { count: 3,   foot: "L", action: "back",  dx: -0.85, dy: -1.1 },
      { count: 3.5, foot: "R", action: "close", dx: 1.0,   dy: 0.15 },
      { count: 4,   foot: "L", action: "fwd",   dx: -0.85, dy: 0.95 }
    ]
  },
  sailor: {
    label: s => "Sailor " + (s ? s.foot : "R"),
    header: /\bsailor\b/i,
    match: mSailor,
    template: {
      // behind on the ball, then out-out into a wide low straddle
      seq: [
        { dx: -0.22, dy: -0.5 },
        { dx: 1.4,   dy: 0.35 },
        { dx: 1.2,   dy: 0.15 }
      ]
    },
    canon: [
      { count: 1,   foot: "R", action: "cross_back", dx: -0.22, dy: -0.5 },
      { count: 1.5, foot: "L", action: "side",       dx: -1.4,  dy: 0.35 },
      { count: 2,   foot: "R", action: "side",       dx: 1.2,   dy: 0.15 },
      { count: 3,   foot: "L", action: "cross_back", dx: 0.22,  dy: -0.5 },
      { count: 3.5, foot: "R", action: "side",       dx: 1.4,   dy: 0.35 },
      { count: 4,   foot: "L", action: "side",       dx: -1.2,  dy: 0.15 }
    ]
  },
  mambo: {
    label: s => (s && s.meta.variant === "cha" ? "Cha " : "Mambo ") + (s ? s.foot : "R"),
    header: /\b(mambo|cha[\s-]?cha)\b/i,
    match: mMambo,
    template: {
      variants: {
        // true mambo: standardized rock reach, close gathers on its side.
        // The cha/triple variant TRAVELS — its geometry is choreography,
        // so the template leaves it exactly as the sheet said.
        mambo: {
          when: { variant: "mambo" },
          rules: {
            rockF: { dx: 0.85, dy: 1.05 },
            rockB: { dx: 0.85, dy: -1.05 },
            close: { dx: 0.85 }
          }
        },
        cha: { when: { variant: "cha" }, rules: {} }
      }
    },
    canon: [
      { count: 1,   foot: "R", action: "rock_fwd", dx: 0.85,  dy: 1.05 },
      { count: 1.5, action: "recover", weight: "L" },
      { count: 2,   foot: "R", action: "close",    dx: 0.85,  dy: 0.1 },
      { count: 3,   foot: "L", action: "rock_back", dx: -0.85, dy: -1.05 },
      { count: 3.5, action: "recover", weight: "R" },
      { count: 4,   foot: "L", action: "close",    dx: -0.85, dy: -0.1 }
    ]
  },
  lock_step: {
    label: s => "Lock step " + (s ? s.foot : "R"),
    header: /\b(lock(?:ing)?\s*step|dorothy)\b/i,
    match: mLock,
    template: {
      // the lock tucks directly behind on the ball — boots clear
      rules: {
        lockF: { dx: -0.18, dy: 0.47 },
        lockB: { dx: -0.18, dy: -0.47 }
      }
    },
    canon: [
      // forward lock step out, backward lock step home — net zero travel
      { count: 1,   foot: "R", action: "fwd",        dx: 0.85,  dy: 0.9 },
      { count: 2,   foot: "L", action: "lock_back",  dx: 0.18,  dy: -0.47 },
      { count: 3,   foot: "R", action: "fwd",        dx: 0.85,  dy: 0.9 },
      { count: 4,   foot: "L", action: "scuff",      dx: -0.7,  dy: 0.9, lifted: true },
      { count: 5,   foot: "L", action: "back",       dx: -0.85, dy: -0.9 },
      { count: 6,   foot: "R", action: "lock_front", dx: -0.18, dy: 0.47 },
      { count: 7,   foot: "L", action: "back",       dx: -0.85, dy: -0.9 },
      { count: 8,   foot: "R", action: "touch",      dx: 0.85,  dy: 0 }
    ]
  },
  pivot: {
    label: s => "Pivot " + (s && Math.abs(s.meta.deg) >= 135 ? "½" : "¼"),
    header: /\bpivot\b/i,
    match: mPivot,
    template: {
      // standardized prep stride; the turn itself is choreography — the
      // sheet's stated degrees pass through untouched (thetaAt supplies the
      // whip-and-settle character)
      rules: {
        fwd: { dx: 0.85, dy: 0.9 }
      }
    },
    canon: [
      { count: 1, foot: "R", action: "fwd",   dx: 0.85, dy: 0.9 },
      { count: 2, foot: "L", action: "pivot", dx: -0.85, dy: 0, turn: -180 },
      { count: 3, foot: "R", action: "fwd",   dx: 0.85, dy: 0.9 },
      { count: 4, foot: "L", action: "pivot", dx: -0.85, dy: 0, turn: -180 }
    ]
  },
  monterey: {
    label: s => "Monterey " + (s && Math.abs(s.meta.deg) >= 135 ? "½" : "¼"),
    header: /\bmonterey\b/i,
    match: mMonterey,
    template: {
      // full point reach to the side is the figure's pop; the spinning
      // close keeps the sheet's turn exactly
      rules: {
        touchS: { dx: 1.55, dy: 0, accent: true }
      }
    },
    canon: [
      { count: 1, foot: "R", action: "point_side", dx: 1.55,  dy: 0, lifted: true },
      { count: 2, foot: "R", action: "close",      dx: 0.85,  dy: 0.1, turn: 180 },
      { count: 3, foot: "L", action: "point_side", dx: -1.55, dy: 0, lifted: true },
      { count: 4, foot: "L", action: "close",      dx: -0.85, dy: 0.1 },
      { count: 5, foot: "R", action: "point_side", dx: 1.55,  dy: 0, lifted: true },
      { count: 6, foot: "R", action: "close",      dx: 0.85,  dy: 0.1, turn: 180 },
      { count: 7, foot: "L", action: "point_side", dx: -1.55, dy: 0, lifted: true },
      { count: 8, foot: "L", action: "close",      dx: -0.85, dy: 0.1 }
    ]
  },
  scissor: {
    label: s => "Scissor " + (s ? s.foot : "R"),
    header: /\bscissors?\b/i,
    match: mScissor,
    template: {
      // wide side reach, & gather, snug turned-out accent cross
      seq: [
        { dx: 1.5 },
        null,
        { dx: -0.3, dy: 0.4, turnout: 25, accent: true }
      ]
    },
    canon: [
      { count: 1,   foot: "R", action: "side",        dx: 1.5,   dy: -0.4 },
      { count: 1.5, foot: "L", action: "close",       dx: -0.85, dy: -0.1 },
      { count: 2,   foot: "R", action: "cross_front", dx: -0.3,  dy: 0.4 },
      { count: 3,   foot: "L", action: "side",        dx: -1.5,  dy: -0.4 },
      { count: 3.5, foot: "R", action: "close",       dx: 0.85,  dy: 0.1 },
      { count: 4,   foot: "L", action: "cross_front", dx: 0.3,   dy: 0.4 }
    ]
  },
  charleston: {
    label: () => "Charleston",
    header: /\bcharleston\b/i,
    match: mCharleston,
    template: {
      // fore-aft pendulum: strikes reach a full 1.1u, net zero travel
      rules: {
        touchF: { dy: 1.1, accent: true },
        touchB: { dy: -1.1, accent: true },
        kick:   { accent: true }
      }
    },
    canon: [
      { count: 1, foot: "R", action: "touch_fwd", dx: 0.85,  dy: 1.1, lifted: true },
      { count: 2, foot: "R", action: "back",      dx: 0.85,  dy: -0.9 },
      { count: 3, foot: "L", action: "touch_back", dx: -0.85, dy: -1.1, lifted: true },
      { count: 4, foot: "L", action: "fwd",       dx: -0.85, dy: 0.9 }
    ]
  },
  hip_bumps: {
    label: s => "Hip bumps" + (s && s.meta.stance ? " (" + s.meta.stance + ")" : ""),
    header: /\b(hip\s*bumps?|bump\s*hips?)\b/i,
    match: mHipBumps,
    template: {
      // bumps themselves are body styling (footless events); the template's
      // job is the STANCE. Wide-planted bumps spread the setup side steps
      // to a 1.5-2u straddle with toes 10-15 deg out, then stay planted.
      rules: {},
      variants: {
        wide: {
          when: { stance: "wide" },
          pre: { lookback: 3, rules: { side: { dx: 1.7, aOffAdd: 12 } } }
        }
      }
    },
    canon: [
      { count: 1, foot: "R", action: "side",  dx: 1.7, dy: 0, aOff: 12 },
      { count: 2, foot: "L", action: "side",  dx: -1.7, dy: 0, aOff: -12 },
      { count: 3, action: "bump", side: "R" },
      { count: 4, action: "bump", side: "R" },
      { count: 5, action: "bump", side: "L" },
      { count: 6, action: "bump", side: "L" },
      { count: 7, action: "bump", side: "R" },
      { count: 8, action: "bump", side: "L" }
    ]
  },
  heel_splits: {
    label: () => "Heel splits",
    header: /\b(heel\s*splits?|buttermilks?)\b/i,
    match: mHeelSplits,
    template: {
      // splits are self-moves — the parser's fan angles ARE the canonical
      // form; the template only marks the outward fan as the pop
      rules: {
        split_out: { accent: true }
      }
    },
    canon: [
      { count: 1, foot: "R", action: "heels_out", dx: 0.15,  dy: 0, aOff: -18, self: true },
      { count: 1, foot: "L", action: "heels_out", dx: -0.15, dy: 0, aOff: 18, self: true },
      { count: 2, foot: "R", action: "heels_in",  dx: -0.15, dy: 0, aOff: 0, self: true },
      { count: 2, foot: "L", action: "heels_in",  dx: 0.15,  dy: 0, aOff: 0, self: true }
    ]
  },
  kick_ball_change: {
    label: s => "Kick-ball-change " + (s ? s.foot : "R"),
    header: /\bkick[\s-]?ball[\s-]?change\b/i,
    match: mKickBallChange,
    template: {
      variants: {
        // low knee-flick out (the accent), & ball dab beside the support,
        // weight change back — zero net travel
        full: {
          when: { full: true },
          seq: [
            { dx: 0.6,  dy: 1.1, accent: true },
            { dx: 0.85, dy: 0.1 },
            { dx: 0.85, dy: -0.1 }
          ]
        },
        // sheets that wrote it as one phrase parse to a lone kick — leave it
        named: { when: { full: false }, rules: {} }
      }
    },
    canon: [
      // low knee-flick out, & ball dab beside the support (heel high), weight
      // change back — zero net travel
      { count: 1,   foot: "R", action: "kick",  dx: 0.6,   dy: 1.1, lifted: true },
      { count: 1.5, foot: "R", action: "ball",  dx: 0.85,  dy: 0.1 },
      { count: 2,   foot: "L", action: "close", dx: -0.85, dy: -0.1 }
    ]
  }
};

// priority: most-specific structures first so a k-step never reads as four
// step-touches and a weave never reads as a vine start
const PRIORITY = [
  "k_step", "weave", "jazz_box", "charleston", "rocking_chair", "lindy",
  "vine", "sailor", "coaster", "scissor", "lock_step", "kick_ball_change",
  "monterey", "mambo", "pivot", "hip_bumps", "heel_splits"
];

// --- detection -------------------------------------------------------------
function detectFigures(parsed) {
  const st = buildStream(parsed);
  const spans = [];
  let i = 0;
  while (i < st.length) {
    let hit = null;
    for (const id of PRIORITY) {
      const m = REGISTRY[id].match(st, i);
      if (m) { hit = { id, m }; break; }
    }
    if (!hit) { i++; continue; }
    const items = st.slice(i, i + hit.m.len);
    const span = {
      figureId: hit.id,
      foot: hit.m.foot || null,
      startBeat: items[0].beat,
      endBeat: items[items.length - 1].beat + 1,
      idx: items.map(it => it.i),
      meta: hit.m.meta || {}
    };
    span.label = REGISTRY[hit.id].label(span);
    spans.push(span);
    i += hit.m.len;
  }
  return spans;
}

// --- styling entry point ---------------------------------------------------
// Detects (cached on the parsed object) and applies each tagged span's
// template, exactly once per parsed sheet. buildTimeline calls this every
// rebuild; the guard keeps it idempotent (rolling-vine turnAdd is additive,
// so a second application would double the spiral). ctx is optional:
// { bpm, style } — see the template schema notes above.
function applyStyling(parsed, ctx) {
  if (!parsed.figures) parsed.figures = detectFigures(parsed);
  if (parsed._figStyled) return parsed.figures;
  parsed._figStyled = true;
  for (const span of parsed.figures) {
    applyTemplate(parsed.events, span, ctx);
  }
  // cross-figure context: a figure repeated back-to-back (vine R straight
  // into vine L) pops once, at its true end — earlier repeats yield their
  // accents to the last one
  const spans = parsed.figures;
  for (let i = 0; i + 1 < spans.length; i++) {
    if (spans[i + 1].figureId === spans[i].figureId &&
        spans[i + 1].startBeat - spans[i].endBeat <= 0.05) {
      for (const j of spans[i].idx) delete parsed.events[j].accent;
    }
  }
  return parsed.figures;
}

// --- labels for the cues layer --------------------------------------------
function spansInRange(parsed, b0, b1) {
  const spans = parsed.figures || (parsed.figures = detectFigures(parsed));
  return spans.filter(sp => sp.startBeat < b1 - 1e-6 && sp.endBeat > b0 + 1e-6);
}

function joinLabels(spans) {
  const labels = [];
  for (const sp of spans) {
    if (!labels.includes(sp.label)) labels.push(sp.label);
  }
  if (!labels.length) return null;
  // "Vine R · Vine L" reads better folded
  if (labels.length === 2 && labels[0].replace(/ [RL]$/, "") === labels[1].replace(/ [RL]$/, "") &&
      / [RL]$/.test(labels[0])) {
    return labels[0].replace(/ [RL]$/, "") + " R+L";
  }
  return labels.slice(0, 2).join(" · ") + (labels.length > 2 ? " …" : "");
}

function labelForSection(parsed, secIdx) {
  const sec = parsed.sections && parsed.sections[secIdx];
  if (!sec) return null;
  return joinLabels(spansInRange(parsed, sec.startBeat, sec.startBeat + sec.beats));
}

function labelForLine(parsed, line) {
  if (!line) return null;
  return joinLabels(spansInRange(parsed, line.b0, line.b1 + 1));
}

// --- exports ---------------------------------------------------------------
const API = {
  FIGURES: REGISTRY, detectFigures, applyStyling, applyTemplate, separateFeet,
  classify, labelForSection, labelForLine, SEP, TEMPO_BANDS, tempoBand
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
} else if (typeof window !== "undefined") {
  window.FIGURES = API;
}
