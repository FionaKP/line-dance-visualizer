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
//   applyStyling(parsed)  -> tags; also (once) rewrites tagged events'
//       dx/dy/turn to the catalog placement numbers, and stamps hints
//       (turnout, glide) that the timeline builder carries onto keyframes.
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

// --- styling: catalog placement numbers, applied to tagged events ----------
// All numbers in floor units; dx stays in the parser's mirrored convention
// (writes use natSign so both feet get their natural side).

function styleVine(events, span) {
  const evs = span.idx.map(i => events[i]);
  let prevCrossDy = 0;
  for (const ev of evs) {
    if (!ev.foot) continue;
    const ns = natSign(ev.foot);
    const sym = classify(ev);
    if (sym === "side") {
      ev.dx = ns * Math.max(1.5, Math.min(2, Math.abs(ev.dx))); // wide side reach
      // rejoin the vine's lateral line: the previous behind-cross dropped the
      // reference foot back, so this side step regains that ground — travel
      // stays a straight constant-velocity lateral glide
      ev.dy = -prevCrossDy;
      prevCrossDy = 0;
      ev.glide = true;             // floor skim, no hop
    } else if (sym === "crossB") {
      // LOOSE behind: a narrow stagger, toe well behind the other heel —
      // never a ballet lock. Toes slightly out via the boots' turnout pass.
      ev.dx = -ns * 0.2;
      ev.dy = -0.6;
      prevCrossDy = -0.6;
      ev.glide = true;
    }
  }
  if (span.meta.rolling) {
    // rolling vine: same lateral floor line, rotation layered continuously
    // across counts 1-3 split 1/4-1/2-1/4, travel vector constant. Steps are
    // re-expressed in the rotating frame so the world path stays a straight
    // 1.25 u/count lateral glide while theta spirals a full turn.
    const d = span.foot === "R" ? 1 : -1;         // vine R turns right
    const [a, b, c] = span.idx;
    const A = events[a], B = events[b], C = events[c];
    A.turn = (A.turn || 0) + 90 * d;  A.dx = 0;  A.dy = 1.25;   // 1/4: step fwd
    B.turn = (B.turn || 0) + 180 * d; B.dx = 0;  B.dy = -1.25;  // 1/2: step back
    C.turn = (C.turn || 0) + 90 * d;  C.dx = natSign(C.foot) * 1.5; C.dy = 0;
    A.glide = B.glide = C.glide = true;
  }
}

function styleWeave(events, span) {
  let prevCrossDy = 0;
  for (const i of span.idx) {
    const ev = events[i];
    if (!ev.foot) continue;
    const ns = natSign(ev.foot);
    const sym = classify(ev);
    if (sym === "crossF") { ev.dx = -ns * 0.3; ev.dy = 0.4; prevCrossDy = 0.4; }
    else if (sym === "crossB") { ev.dx = -ns * 0.2; ev.dy = -0.55; prevCrossDy = -0.55; }
    else if (sym === "side" || sym === "close") { ev.dy = -prevCrossDy; prevCrossDy = 0; }
  }
}

function styleJazzBox(events, span) {
  // compact ~1-unit box danced in place; shallow turned-out cross
  const [a, b, c, d] = span.idx;
  const A = events[a], B = events[b], C = events[c], D = events[d];
  const ns = natSign(A.foot);
  A.dx = -ns * 0.3; A.dy = 0.45; A.turnout = 30;   // shallow cross, toes out
  B.dx = ns * 0.28; B.dy = -0.9;                   // small back weight roll under the hip
  C.dx = ns * 0.9;  C.dy = 0.45;                   // side, back onto the home line
  D.dx = -ns * 0.85; D.dy = 0;                     // gather — the box nets zero travel
}

function styleKStep(events, span) {
  // body square to the front the whole time — diagonals live in the feet.
  // Steps travel ~1.4u along the 45° corner lines; touches dab beside the
  // support instep.
  for (const i of span.idx) {
    const ev = events[i];
    if (!ev.foot) continue;
    const sym = classify(ev);
    const ns = natSign(ev.foot);
    if (sym === "fwd") { ev.dx = ns * 1.0; ev.dy = 1.0; }
    else if (sym === "back") { ev.dx = ns * 1.0; ev.dy = -1.0; }
    else if (sym === "touch") { ev.dx = ns * 0.7; ev.dy = 0; }
  }
}

function styleCoaster(events, span) {
  const [a, b, c] = span.idx;
  const A = events[a], B = events[b], C = events[c];
  A.dx = natSign(A.foot) * 0.85; A.dy = -1.1;       // sit down into the back
  B.dx = natSign(B.foot) * 1.0;  B.dy = 0.05;       // & together, ~0.5u daylight
  C.dx = natSign(C.foot) * 0.85; C.dy = 1.0;        // forward out of it
}

function styleSailor(events, span) {
  const [a, b, c] = span.idx;
  const A = events[a], B = events[b], C = events[c];
  A.dx = -natSign(A.foot) * 0.22; A.dy = -0.5;      // behind on the ball
  B.dx = natSign(B.foot) * 1.4;  B.dy = 0.35;       // out (regains the line)...
  C.dx = natSign(C.foot) * 1.2;  C.dy = 0.1;        // ...out: wide low stance
}

function styleScissor(events, span) {
  const [a, b, c] = span.idx;
  const A = events[a], C = events[c];
  A.dx = natSign(A.foot) * 1.5;
  C.dx = -natSign(C.foot) * 0.3; C.dy = 0.4; C.turnout = 25; // snug accent cross
}

function styleRockingChair(events, span) {
  for (const i of span.idx) {
    const ev = events[i];
    const sym = classify(ev);
    if (sym === "rockF") ev.dy = 1.3;
    else if (sym === "rockB") ev.dy = -1.3;
  }
}

function styleLock(events, span) {
  for (const i of span.idx) {
    const ev = events[i];
    const sym = classify(ev);
    if (sym === "lockF" || sym === "lockB") {
      ev.dx = -natSign(ev.foot) * 0.18;             // tucked directly behind
      ev.dy = sym === "lockF" ? 0.47 : -0.47;       // ball-only tuck, boots clear
    }
  }
}

function styleCharleston(events, span) {
  for (const i of span.idx) {
    const ev = events[i];
    const sym = classify(ev);
    if (sym === "touchF") ev.dy = 1.1;
    else if (sym === "touchB") ev.dy = -1.1;
  }
}

function styleHipBumps(events, span) {
  if (span.meta.stance !== "wide") return;
  // wide planted stance: the last placements before the bumps spread to a
  // 1.5-2u straddle with toes 10-15 deg out, then stay planted
  for (let k = span.idx[0] - 1; k >= 0 && k >= span.idx[0] - 3; k--) {
    const ev = events[k];
    if (!ev || !ev.foot || ev.lifted) continue;
    if (classify(ev) === "side") {
      const ns = natSign(ev.foot);
      ev.dx = ns * 1.7;
      ev.aOff = (ev.aOff || 0) + ns * 12;
    }
  }
}

// --- registry --------------------------------------------------------------
// header: prose regex (a hint/label aid only — structure decides);
// match: structural matcher; canon: loopable teaching sequence;
// style: placement rewrite for tagged spans.
// (named REGISTRY, not FIGURES: in the browser this file is a classic
// script, and a top-level `const FIGURES` would shadow the window.FIGURES
// API object for every other script on the page)
const REGISTRY = {
  vine: {
    label: s => (s && s.meta && s.meta.rolling ? "Rolling vine " : "Vine ") + (s ? s.foot : "R"),
    header: /\b(grapevine|(?:rolling\s+)?vine|weave)\b/i,
    match: mVine, style: styleVine,
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
    match: mWeave, style: styleWeave,
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
    match: mJazzBox, style: styleJazzBox,
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
    match: mKStep, style: styleKStep,
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
    match: mLindy, style: null,
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
    match: mRockingChair, style: styleRockingChair,
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
    match: mCoaster, style: styleCoaster,
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
    match: mSailor, style: styleSailor,
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
    match: mMambo, style: null,
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
    match: mLock, style: styleLock,
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
    match: mPivot, style: null,
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
    match: mMonterey, style: null,
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
    match: mScissor, style: styleScissor,
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
    match: mCharleston, style: styleCharleston,
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
    match: mHipBumps, style: styleHipBumps,
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
    match: mHeelSplits, style: null,
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
    match: mKickBallChange, style: null,
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
// Detects (cached on the parsed object) and rewrites tagged events' geometry
// to catalog placement, exactly once per parsed sheet. buildTimeline calls
// this every rebuild; the guard keeps it idempotent.
function applyStyling(parsed) {
  if (!parsed.figures) parsed.figures = detectFigures(parsed);
  if (parsed._figStyled) return parsed.figures;
  parsed._figStyled = true;
  for (const span of parsed.figures) {
    const entry = REGISTRY[span.figureId];
    if (entry.style) entry.style(parsed.events, span);
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
  FIGURES: REGISTRY, detectFigures, applyStyling, separateFeet, classify,
  labelForSection, labelForLine, SEP
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
} else if (typeof window !== "undefined") {
  window.FIGURES = API;
}
