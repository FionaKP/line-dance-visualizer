"use strict";
// ---------------------------------------------------------------------------
// Stepsheet parser. Turns CopperKnob-style text into timed events:
// { beat, c, foot, dx, dy, turn, lifted, weight, aOff, txt }
// dx/dy are in the dancer's frame relative to the OTHER foot (dx = toward the
// dancer's right, dy = forward, floor units). Offsets below are written for
// the right foot; dx and aOff are mirrored for the left.
// ---------------------------------------------------------------------------

const KIND = {
  side:               { dx: 1.7,   dy: 0 },
  close:              { dx: 0.85,  dy: 0 },
  place:              { dx: 0.85,  dy: 0 },
  fwd:                { dx: 0.85,  dy: 0.9 },
  back:               { dx: 0.85,  dy: -0.9 },
  shuffle_open_fwd:   { dx: 0.85,  dy: 0.85 },
  shuffle_close_fwd:  { dx: 0.85,  dy: -0.35 },
  shuffle_open_back:  { dx: 0.85,  dy: -0.85 },
  shuffle_close_back: { dx: 0.85,  dy: 0.35 },
  shuffle_open_side:  { dx: 1.6,   dy: 0 },
  shuffle_close_side: { dx: 0.85,  dy: 0 },
  cross_front:        { dx: -0.4,  dy: 0.35 },
  cross_back:         { dx: -0.4,  dy: -0.35 },
  rock_fwd:           { dx: 0.85,  dy: 1.05 },
  rock_back:          { dx: 0.85,  dy: -1.1 },
  rock_side:          { dx: 1.5,   dy: 0 },
  stomp:              { dx: 0.85,  dy: 0.35, impact: true, badge: "STOMP" },
  // self-anchored moves: position/angle change relative to the foot's own
  // spot, for twists and swivels where feet rotate in place
  swivel_left:        { dx: -0.18, dy: 0, aOff: 22,  self: true, noMirror: true, noWeight: true, badge: "SWIVEL" },
  swivel_right:       { dx: 0.18,  dy: 0, aOff: -22, self: true, noMirror: true, noWeight: true, badge: "SWIVEL" },
  split_heels_out:    { dx: 0.15,  dy: 0, aOff: -18, self: true, noWeight: true, badge: "HEELS" },
  split_toes_out:     { dx: 0.15,  dy: 0, aOff: 20,  self: true, noWeight: true, badge: "TOES" },
  split_center:       { dx: -0.15, dy: 0, aOff: 0,   self: true, noWeight: true },
  sweep_back:         { dx: 0.9,   dy: -0.5, lifted: true, pose: "air", badge: "SWEEP" },
  touch_beside:       { dx: 0.85,  dy: 0, lifted: true, pose: "toe", badge: "TOUCH" },
  drag:               { dx: 0.85,  dy: 0, lifted: true, pose: "toe", badge: "DRAG" },
  touch_side:         { dx: 1.55,  dy: 0, lifted: true, pose: "toe", badge: "TOUCH" },
  touch_fwd:          { dx: 0.85,  dy: 0.8, lifted: true, pose: "toe", badge: "TOUCH" },
  touch_back:         { dx: 0.85,  dy: -0.8, lifted: true, pose: "toe", badge: "TOUCH" },
  point_side:         { dx: 1.55,  dy: 0, lifted: true, pose: "toe", badge: "POINT" },
  heel_fwd:           { dx: 0.85,  dy: 0.8, lifted: true, pose: "heel", badge: "HEEL" },
  heel_beside:        { dx: 0.85,  dy: 0.15, lifted: true, pose: "heel", badge: "HEEL" },
  toe_back:           { dx: 0.85,  dy: -0.8, lifted: true, pose: "toe", badge: "TOE" },
  kick:               { dx: 0.6,   dy: 1.1, lifted: true, pose: "air", badge: "KICK" },
  hook:               { dx: -0.12, dy: 0.4, lifted: true, pose: "air", badge: "HOOK" },
  hitch:              { dx: 0.75,  dy: 0.15, lifted: true, pose: "air", badge: "KNEE" },
  scuff:              { dx: 0.7,   dy: 0.9, lifted: true, pose: "air", badge: "SCUFF" },
  sweep:              { dx: 1.3,   dy: 0.6, lifted: true, pose: "air", badge: "SWEEP" },
  skate:              { dx: 1.0,   dy: 0.75, aOff: 18, badge: "SKATE" },
  // locks: tight syncopated crosses in a traveling lock step
  lock_front:         { dx: -0.3,  dy: 0.32, badge: "LOCK" },
  lock_back:          { dx: -0.3,  dy: -0.32, badge: "LOCK" },
  // cross rocks lean across the standing foot, then recover
  rock_cross:         { dx: -0.35, dy: 0.4 },
  // toe/heel struts: land on the toe (or heel), then drop the rest of the
  // foot in place, taking weight only on the drop
  strut_drop:         { dx: 0,     dy: 0, self: true },
  cross_toe:          { dx: -0.4,  dy: 0.35, lifted: true, pose: "toe", badge: "TOE" },
  flick:              { dx: 0.5,   dy: -0.6, lifted: true, pose: "air", badge: "FLICK" },
  bounce_heels:       { dx: 0,     dy: 0, self: true, noWeight: true, badge: "BOUNCE" }
};

const FRAC = {
  "1/8": 45, "⅛": 45, "eighth": 45,
  "1/4": 90, "¼": 90, "quarter": 90,
  "3/8": 135, "⅜": 135,
  "1/2": 180, "½": 180, "half": 180,
  "5/8": 225, "⅝": 225,
  "3/4": 270, "¾": 270,
  "7/8": 315, "⅞": 315,
  "full": 360
};
const FRAC_RE = "(1\\/8|3\\/8|5\\/8|7\\/8|1\\/4|1\\/2|3\\/4|\\u215b|\\u215c|\\u215d|\\u215e|\\u00bc|\\u00bd|\\u00be|eighth|quarter|half|full)";
const DIR_RE = "(left|right|l|r)";

function matchTurn(s) {
  let m = s.match(new RegExp(FRAC_RE + "\\s*(?:of\\s+a\\s+)?turns?\\s*(?:to\\s+)?(?:the\\s+)?" + DIR_RE + "\\b", "i"))
       || s.match(new RegExp("turn(?:ing)?\\s*" + FRAC_RE + "\\s*(?:turns?\\s*)?(?:to\\s+)?(?:the\\s+)?" + DIR_RE + "\\b", "i"))
       || s.match(new RegExp(FRAC_RE + "\\s*" + DIR_RE + "\\s*turn", "i"))
       || s.match(new RegExp("\\b(?:unwind|spin|rotate)\\s*(?:a\\s+)?" + FRAC_RE + "\\s*(?:turn\\s*)?(?:to\\s+)?(?:the\\s+)?" + DIR_RE + "\\b", "i"));
  if (!m) return null;
  const deg = FRAC[m[1].toLowerCase()];
  return { deg: m[2].toLowerCase().startsWith("l") ? -deg : deg, raw: m[0] };
}

// Feet come as words or as the R/L/RF/LF shorthand common on real sheets.
function footIn(s) {
  const m = s.match(/\b(right|left|rf|lf|r|l)\b/i);
  return m ? (m[1].toLowerCase()[0] === "r" ? "R" : "L") : null;
}
function other(f) { return f === "R" ? "L" : "R"; }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// Words that turn up as leftovers once turns/parentheticals are stripped
// ("make a", "gradually turning", "around from back to front"): if a phrase
// is built ONLY of these it is dressing, not a step, and skips silently.
const NOISE_RE = new RegExp(
  "^(?:(?:make|makes|making|a|an|the|turn|turns|turning|with|w|as|you|your|want|it|same|or|" +
  "either|direction|opposite|while|gradually|slightly|slowly|quickly|sharply|for|counts?|" +
  "times?|more|twice|around|from|out|front|back|forward|fwd|body|floor|to|of|and|on|in|" +
  "diagonal(?:ly)?|angle)\\s*)+$", "i");

// Parses one comma-separated phrase into zero or more steps.
// A step: { kind, foot } | { kind:'recover'|'pivot'|'hold', ... }
function parsePhrase(raw, ctx, warn) {
  let p = raw.trim()
    .replace(/^and\s+/i, "")
    .replace(/^(?:make|making|makes)\s+(?:an?\s+)?/i, "")
    .replace(/[.\s]+$/, "")
    .replace(/\s+/g, " ");
  if (!p) return [];
  const lower = p.toLowerCase();
  const foot = footIn(lower);
  const out = [];
  const push = (kind, f, extra) => {
    const st = Object.assign({ kind, foot: f, txt: cap(p) }, extra);
    out.push(st);
    if (f) {
      ctx.lastMoved = f;
      if (!KIND[kind]?.lifted && kind !== "recover") ctx.lastFoot = f;
    }
    return st;
  };

  // compound actions in one count ("hop right to side and hitch left knee"):
  // later parts land on the same beat as the first
  if (/\s+and\s+/.test(lower) && !/\bball\b/.test(lower)) {
    const steps = [];
    p.split(/\s+and\s+/i).forEach((part, j) => {
      const got = parsePhrase(part, ctx, warn);
      if (j > 0) for (const st of got) st.sameBeat = true;
      steps.push(...got);
    });
    if (steps.length) return steps;
  }

  if (/^(tags?|restarts?|bridge)\b/.test(lower)) {
    warn("Tags/restarts are not supported yet: \"" + p + "\"");
    out.push({ kind: "hold", txt: cap(p) });
    return out;
  }
  if (/^(hold|clap|snap|slap)\b/.test(lower)) { out.push({ kind: "hold", txt: cap(p) }); return out; }
  if (/\b(bump|hip)\b/.test(lower) &&
      !/\b(step(?:s|ping)?|rock|walk|cross|touch|kick|point)\b/.test(lower)) {
    ctx.mode = "bump";
    out.push({ kind: "hold", txt: cap(p) });
    return out;
  }
  // hand/arm styling with no footwork is a hold, not a step
  if (/\b(hands?|arms?|palms?|fingers?|shoulders?)\b/.test(lower) &&
      !/\b(step(?:s|ping)?|rock|walk|cross|touch|kick|point|stomp|vine|shuffle)\b/.test(lower)) {
    out.push({ kind: "hold", txt: cap(p) });
    return out;
  }

  // twists, swivels, and heel/toe splits: both feet rotate in place
  const splitReturn = ctx.mode === "split" &&
    /\b(center|centre|together|close|in|back)\b/.test(lower) && !/\b(out|apart|open)\b/.test(lower);
  if (/\b(swivel|twist|split)s?\b/.test(lower) || splitReturn) {
    const toes = /\btoes?\b/.test(lower) && !/\bheels?\b/.test(lower);
    let kind;
    if (splitReturn || (/\b(center|centre|together|close)\b/.test(lower) && !/\b(out|apart|open)\b/.test(lower))) {
      kind = "split_center";
    } else if (/\b(out|apart|open)\b/.test(lower) || /\bsplits?\b/.test(lower)) {
      kind = toes ? "split_toes_out" : "split_heels_out";
    } else if (/\bleft\b/.test(lower)) {
      kind = "swivel_left";
    } else if (/\bright\b/.test(lower)) {
      kind = "swivel_right";
    } else {
      kind = "split_center";
    }
    ctx.mode = "split";
    out.push({ kind, foot: "R", txt: cap(p) });
    out.push({ kind, foot: "L", txt: cap(p), sameBeat: true });
    return out;
  }

  // "bring/lift/raise the foot" moves
  if (/\b(bring|lift|raise)\b/.test(lower)) {
    const f = foot || other(ctx.lastFoot || "L");
    if (/\b(behind|back)\b/.test(lower)) push("sweep_back", f);
    else if (/\b(front|cross|over)\b/.test(lower)) push("hook", f);
    else push("hitch", f);
    return out;
  }
  if (/\bpivot\b|\bpaddle\b|\bunwind\b/.test(lower)) {
    out.push({ kind: "pivot", txt: cap(p) });
    const wm = lower.match(/\bweight\s+(?:ends?\s+|stays?\s+|remains?\s+)?(?:on|to|onto)\s+(?:the\s+)?(right|left|rf|lf|r|l)\b/);
    if (wm) out.push({ kind: "recover", foot: wm[1][0] === "r" ? "R" : "L", txt: cap(p), sameBeat: true });
    return out;
  }

  if (/\b(shuffle|chassé|chasse|triple)\b/.test(lower)) {
    const dir = /\bback(?:wards?)?\b/.test(lower) ? "back" : /\bside\b/.test(lower) ? "side" : "fwd";
    const feetSrc = lower.replace(/\bto\s+(?:the\s+)?(?:right|left)\b/g, " ").replace(/\b(?:right|left)\s+side\b/g, " ");
    const feet = [...feetSrc.matchAll(/\b(right|left|rf|lf|r|l)\b/g)].map(m => m[1][0] === "r" ? "R" : "L");
    const first = feet[0] || other(ctx.lastFoot || "L");
    ctx.mode = "shuffle"; ctx.dir = dir; ctx.shufflePos = 0;
    const seq = feet.length >= 2 ? feet : [first];
    for (const f of seq) {
      const open = ctx.shufflePos % 2 === 0;
      push(open ? "shuffle_open_" + dir : "shuffle_close_" + dir, f);
      ctx.shufflePos++;
    }
    if (ctx.shufflePos >= 3) ctx.mode = null;
    return out;
  }

  if (/\b(grapevine|vine)\b/.test(lower)) {
    const f = foot || "R";
    push("side", f);
    push("cross_back", other(f));
    push("side", f);
    if (/\btouch\b/.test(lower)) push("touch_beside", other(f));
    ctx.mode = null;
    return out;
  }

  // "lock L behind R" / "lock R over L": the tight cross of a lock step
  if (/\block\b/.test(lower) && !/\block step\b/.test(lower)) {
    const kind = /\b(over|across|in front)\b/.test(lower) ? "lock_front" : "lock_back";
    push(kind, foot || other(ctx.lastFoot || "L"));
    return out;
  }

  // toe/heel struts: "drop R heel", "drop heel taking weight" plants the
  // struck foot flat where it is and takes weight
  if (/\b(drop|lower)\b/.test(lower) && /\b(heels?|toes?)\b/.test(lower)) {
    const f = footIn(lower.replace(/\b(heels?|toes?)\b/g, " ")) || ctx.lastMoved || other(ctx.lastFoot || "L");
    push("strut_drop", f);
    return out;
  }

  if (/\brock\b/.test(lower)) {
    const kind = /\b(cross|over|across)\b/.test(lower) ? "rock_cross"
               : /\b(back|backwards?|behind)\b/.test(lower) ? "rock_back"
               : /\bside\b/.test(lower) || /\bto\s+(?:the\s+)?(?:right|left|r|l)\b/.test(lower) ? "rock_side"
               : "rock_fwd";
    push(kind, foot || other(ctx.lastFoot || "L"));
    return out;
  }
  if (/\b(recover|replace)\b/.test(lower) ||
      /^(?:turn\s+)?(?:moving\s+|change\s+|changing\s+)?weight\s+(?:back\s+)?(?:on|to|onto)\b/.test(lower)) {
    const wf = footIn(lower.replace(/\b(over|of)\s+(right|left|rf|lf|r|l)\b/g, " "));
    out.push({ kind: "recover", foot: wf || other(ctx.lastFoot || "L"), txt: cap(p) });
    if (out[0].foot) ctx.lastFoot = out[0].foot;
    return out;
  }

  if (/\b(drag|slide)\b/.test(lower)) { push("drag", foot || other(ctx.lastFoot || "L")); return out; }
  if (/\bflick\b/.test(lower)) { push("flick", foot || other(ctx.lastFoot || "L")); return out; }
  if (/\bbounce\b/.test(lower)) {
    // "bounce heels (twice)": both feet pulse in place, no travel, no weight change
    const reps = /\b(twice|x ?2|two times)\b/.test(lower) ? 2 : 1;
    for (let i = 0; i < reps; i++) {
      out.push({ kind: "bounce_heels", foot: "R", txt: cap(p), sameBeat: i > 0 ? false : undefined });
      out.push({ kind: "bounce_heels", foot: "L", txt: cap(p), sameBeat: true });
    }
    return out;
  }
  if (/\bhook\b/.test(lower)) { push("hook", foot || other(ctx.lastFoot || "L")); return out; }
  if (/\bhitch\b/.test(lower)) { push("hitch", foot || other(ctx.lastFoot || "L")); return out; }
  if (/\bscuff\b/.test(lower)) { push("scuff", foot || other(ctx.lastFoot || "L")); return out; }
  if (/\bskate\b/.test(lower)) { push("skate", foot || other(ctx.lastFoot || "L")); return out; }
  if (/\bsweep\b/.test(lower)) { push("sweep", foot || other(ctx.lastFoot || "L")); return out; }
  if (/\bkick\b/.test(lower)) { push("kick", foot || other(ctx.lastFoot || "L")); return out; }
  if (/\bstomp\b/.test(lower)) { push("stomp", foot || other(ctx.lastFoot || "L")); return out; }
  if (/\bheel\b/.test(lower) && !/\bheel\s*(and|&)\s*toe/.test(lower)) {
    const kind = /\b(beside|together|next|in place)\b/.test(lower) ? "heel_beside" : "heel_fwd";
    push(kind, foot || other(ctx.lastFoot || "L"));
    return out;
  }
  if (/\btoe\b/.test(lower)) {
    const kind = /\b(cross|over|across)\b/.test(lower) ? "cross_toe"
               : /\b(back(?:wards?)?|behind)\b/.test(lower) ? "toe_back"
               : /\b(forward|fwd|front)\b/.test(lower) ? "touch_fwd"
               : /\b(beside|together|next)\b/.test(lower) ? "touch_beside" : "touch_side";
    push(kind, foot || other(ctx.lastFoot || "L"));
    return out;
  }
  if (/\bpoint\b/.test(lower)) {
    push(/\b(forward|fwd|front)\b/.test(lower) ? "touch_fwd"
       : /\b(back|behind)\b/.test(lower) ? "toe_back" : "point_side",
       foot || other(ctx.lastFoot || "L"));
    return out;
  }
  if (/\b(touch|tap)\b/.test(lower)) {
    const kind = /\b(beside|together|next)\b/.test(lower) ? "touch_beside"
               : /\b(forward|fwd|front)\b/.test(lower) ? "touch_fwd"
               : /\b(back(?:wards?)?|behind)\b/.test(lower) ? "touch_back" : "touch_side";
    push(kind, foot || other(ctx.lastFoot || "L"));
    return out;
  }

  // direction words -> generic step kind (shared by verbs and bare
  // continuations like "right beside left", "forward on left")
  const dirKind = s => {
    if (/\b(beside|together|next to|alongside|home)\b/.test(s)) return "close";
    if (/\bin place\b/.test(s)) return "place";
    if (/\bbehind\b/.test(s)) return "cross_back";
    if (/\b(across|over|cross)\b/.test(s)) return "cross_front";
    if (/\bside\b/.test(s)) return "side";
    if (/\b(forward|fwd|front)\b/.test(s)) return "fwd";
    if (/\bback(?:wards?)?\b/.test(s)) return "back";
    if (/\bto\s+(?:the\s+)?(?:right|left|r|l)\b/.test(s)) return "side";
    return null;
  };

  // weight-transfer notes must not read as "to the left" side steps
  const sansWeight = lower.replace(
    /\bweight\s+(?:back\s+)?(?:ends?\s+|stays?\s+|remains?\s+)?(?:on|to|onto)\s+(?:the\s+)?(?:right|left|rf|lf|r|l)\b(?:\s+foot)?/g, " ");

  // jumps land on both feet at once unless the sheet names one
  if (/\b(jump|leap)\b/.test(lower)) {
    const kind = dirKind(sansWeight) || "fwd";
    if (foot) { push(kind, foot, { badge: "JUMP" }); }
    else {
      push(kind, "R", { badge: "JUMP" });
      push("close", "L", { badge: "JUMP", sameBeat: true });
    }
    ctx.lastKind = kind;
    return out;
  }

  // "march in place for N counts": expands to alternating in-place steps for
  // however many counts the line has (see the fill pass in parseStepsheet)
  if (/\bmarch(?:ing)?\b/.test(lower) && /\bin place\b/.test(lower)) {
    out.push({ kind: "march_fill", txt: cap(p) });
    return out;
  }

  // generic steps, walks, hops, and bare-foot continuations
  const stepLike = /\b(step(?:s|ping)?|walk(?:s|ing)?|stroll|run|stride|hop|scoot|close|march(?:ing)?|prance)\b/.test(lower);
  const bareFoot = /^(right|left|rf|lf|r|l)$/.test(lower);
  if (stepLike || bareFoot || ctx.mode || foot) {
    if (/\b(walk|stroll|run|stride|march)\b/.test(lower)) ctx.mode = "walk";
    if (ctx.mode === "bump" && bareFoot) {
      out.push({ kind: "hold", txt: cap(p) });
      return out;
    }
    const f = foot || other(ctx.lastFoot || "L");
    if (ctx.mode === "shuffle" && (bareFoot || !stepLike)) {
      const open = ctx.shufflePos % 2 === 0;
      push(open ? "shuffle_open_" + ctx.dir : "shuffle_close_" + ctx.dir, f);
      ctx.shufflePos++;
      if (ctx.shufflePos >= 3) ctx.mode = null;
      return out;
    }
    let kind = dirKind(sansWeight);
    if (!kind && foot && /\b(right|left)\b/.test(sansWeight.replace(/\b(right|left|rf|lf|r|l)\b/, " "))) {
      kind = "side"; // "step RF right": the second side word is the direction
    }
    if (!kind) {
      if (bareFoot && ctx.lastKind) kind = ctx.lastKind;      // "walk right, left, right"
      else if (ctx.mode === "walk") kind = ctx.walkDir || "fwd"; // walks keep traveling
      else if (/^(?:lock )?step (?:on )?(?:right|left|rf|lf|r|l)$/.test(lower)) kind = "place";
      else if (!stepLike && !bareFoot) { /* a lone foot ref with no direction */ }
      else { kind = "close"; warn("Guessed 'step together' for: \"" + p + "\""); }
    }
    if (kind) {
      if (ctx.mode === "walk" && (kind === "fwd" || kind === "back")) ctx.walkDir = kind;
      ctx.lastKind = kind;
      const st = push(kind, f);
      if (/\b(hop|scoot)\b/.test(lower)) st.badge = /\bscoot\b/.test(lower) ? "SCOOT" : "HOP";
      return out;
    }
  }

  if (/\bcross\b/.test(lower)) {
    push(/\bbehind\b/.test(lower) ? "cross_back" : "cross_front", foot || other(ctx.lastFoot || "L"));
    return out;
  }

  // leftover weight notes ("turn moving weight to left foot") become a
  // weight transfer rather than an unknown step
  const wm = lower.match(/\bweight\s+(?:back\s+)?(?:ends?\s+|stays?\s+|remains?\s+)?(?:on|to|onto)\s+(?:the\s+)?(right|left|rf|lf|r|l)\b/);
  if (wm) {
    // a weight note rides the previous step's beat, it is not its own count
    out.push({ kind: "recover", foot: wm[1][0] === "r" ? "R" : "L", txt: cap(p), sameBeat: true });
    return out;
  }

  if (NOISE_RE.test(lower)) return out; // dressing, not a step

  warn("Skipped unrecognized phrase: \"" + p + "\"");
  return out;
}

function parseStepsheet(text) {
  const warnings = [];
  const warn = m => warnings.push(m);
  const meta = {};

  let m;
  if ((m = text.match(/\bcounts?\s*:\s*(\d+)/i))) meta.count = +m[1];
  if ((m = text.match(/\bwalls?\s*:\s*(\d+)/i))) meta.walls = +m[1];
  if ((m = text.match(/\blevel\s*:\s*([A-Za-z][A-Za-z /+-]*)/i))) meta.level = m[1].trim();
  if ((m = text.match(/^chore(?:o|ographer)?s?\s*:\s*(.+)$/im))) meta.choreo = m[1].trim();
  if ((m = text.match(/^music\s*:\s*(.+)$/im))) meta.music = m[1].trim();

  const sections = [];   // { name, startBeat, beats }
  const lines = [];      // { sec, counts, text, b0, b1 }
  const events = [];
  let wallTurn = 0;
  let title = null;
  let intro = null;

  let offset = 0;        // added to a line's printed counts to get global beats
  let inOptions = false; // inside an OPTION/VARIATION block of alternative counts
  let pendingName = null;
  let cur = null;        // current section
  let prevFirstNum = Infinity;
  let globalMax = 0;     // highest global beat seen

  const closeSection = () => {
    if (cur) cur.beats = Math.max(1, Math.ceil(globalMax + 0.5) - cur.startBeat);
    cur = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    // en/em dashes act as hyphens in count ranges ("1 – 3")
    const line = rawLine.replace(/[–—]/g, "-").trim();
    if (!line || line.startsWith("(")) continue;
    // a bare REPEAT after the danced body ends the dance — anything below is
    // options and endings, not more counts
    if (events.length && /^(repeat\s*$|repeat\s*&|repeat\s+dance)/i.test(line)) break;
    // "OPTION 1:" / "VARIATION" headers open a block of alternative counts
    // that must not extend the dance; a one-line "Option: counts 3-4 ..."
    // note is skipped on its own
    if (events.length &&
        /^(options?|variations?|alternate|alternative|smooth version|outro|finish)\b/i.test(line)) {
      if (line.length < 40 || !/[a-z]/.test(line.slice(12))) inOptions = true;
      continue;
    }
    if (inOptions && /^[&0-9]/.test(line)) continue;
    if (/^(repeat|ending|contact|last update|note)\b/i.test(line)) {
      if (/^(tag|restart)/i.test(line)) warn("Tags/restarts are not supported yet: \"" + line + "\"");
      continue;
    }
    if (/^[*#]*\s*(?:\d+(?:st|nd|rd|th)\s+)?(tag|restart)s?\b/i.test(line)) {
      warn("Tags/restarts are not supported yet: \"" + line + "\"");
      // a TAG heading opens a block of extra counts that must not extend the
      // dance; a restart line is just a marker inside the normal body
      if (events.length && /^[*#]*\s*(?:\d+(?:st|nd|rd|th)\s+)?tags?\b/i.test(line)) inOptions = true;
      continue;
    }
    if (/^starts?\b/i.test(line) || /^intro\b/i.test(line)) { intro = line; continue; }
    if (/^(counts?|walls?|level|chore|music)\b\s*:/i.test(line)) continue;
    // a non-counted "Turn ¼ left to start the dance again" sets the wall turn
    if (!/^\d/.test(line) && /\b(start|begin|again|new wall)\b/i.test(line)) {
      const wt = matchTurn(line);
      if (wt) { wallTurn = wt.deg; continue; }
    }

    const cm = line.match(/^(&?\s*[0-9][0-9&,\-\s]*)(.*)$/);
    if (cm && cm[2] && /[A-Za-z]/.test(cm[2]) && cm[2].trim().length > 3) {
      // a counted step line
      let countStr = cm[1].trim();
      let desc = cm[2].trim();
      if (desc.startsWith("/")) {
        // "1-4 1/8L turn ...": the trailing digit belongs to the fraction
        const back = countStr.match(/^(.*?)([0-9]+)\s*$/);
        if (back) { countStr = back[1].trim(); desc = back[2] + desc; }
        if (!countStr) continue;
      }
      // partner sheets: strip a role prefix and dance that role's part
      desc = desc.replace(/^(?:man|men|gents?|lady|ladies|woman)\s*:\s*/i, "");
      // "1 Restart: Wall 4 after 32Cs": an annotation, not a counted step
      if (/^[*#]*\s*(?:tags?|restarts?)\b/i.test(desc)) {
        warn("Tags/restarts are not supported yet: \"" + desc + "\"");
        continue;
      }

      // "32 Count Intro" / "16 count intro - as danced in ..." is the intro
      // length, not a step line
      if (/^counts?\b/i.test(desc) && /^(counts?\s*(intro|in)?\b|counts?\s*$|counts?\s*-)/i.test(desc)) {
        intro = line;
        continue;
      }

      // a first line like "90 Miles An Hour" or "2 Unlimited" is the dance's
      // title, not a step line — nothing step-like in the words after the number
      if (!title && lines.length === 0 && sections.length === 0 && !pendingName &&
          line.length < 80 && !/:/.test(line) &&
          !/\b(step|rock|touch|tap|kick|shuffle|chass|walk|cross|point|heel|toe|stomp|hold|turn|sweep|hitch|hook|close|together|side|forward|fwd|back|behind|recover|vine|drag|skate|scuff|stroll)\b/i.test(desc)) {
        title = line;
        continue;
      }

      // expand ranges like "1-4"
      const expanded = countStr.replace(/(\d+)\s*-\s*(\d+)/g, (_, a, b) => {
        const out = [];
        for (let n = +a; n <= +b; n++) out.push(n);
        return out.join(" ");
      });
      const tokens = [];
      let leadAmp = false;  // "&7-8": a pickup half-beat before the first count
      for (const tk of expanded.match(/(\d+|&)/g) || []) {
        if (tk === "&") {
          if (tokens.length) tokens.push({ c: "&", beat: tokens[tokens.length - 1].beat + 0.5 });
          else leadAmp = true;
        } else if (+tk >= 1 && +tk <= 96) {
          tokens.push({ c: tk, beat: +tk - 1 });
          if (leadAmp) { tokens.unshift({ c: "&", beat: +tk - 1.5 }); leadAmp = false; }
        }
      }
      if (!tokens.length) continue;

      // "1-8  ROCK, COASTER STEP" style: a count-range section header, not
      // a step line — all caps and spanning most of a phrase of music
      if (/[A-Za-z]{3}/.test(desc) && desc === desc.toUpperCase() &&
          tokens[tokens.length - 1].beat - tokens[0].beat >= 6) {
        pendingName = desc;
        continue;
      }

      // counts that restart from 1 advance the global offset; sheets with
      // continuous counts (1-32 straight through) keep offset at 0 no matter
      // how many section headers they have
      const firstNum = tokens[0].beat;
      if (cur && firstNum <= prevFirstNum) {
        offset = Math.ceil(globalMax + 0.5);
      }
      if (!cur || firstNum <= prevFirstNum || pendingName) {
        closeSection();
        cur = { name: pendingName || "Section " + (sections.length + 1),
                startBeat: offset + firstNum, beats: 8 };
        sections.push(cur);
        pendingName = null;
      }
      prevFirstNum = firstNum;

      // pull out the end-of-wall note before general turn matching
      const noteM = desc.match(/note\s*:.*$/i);
      // inline count markers like "Step R forward (1), Lock L behind R (2)"
      // or "(&)" become phrase breaks so uncomma'd sheets still split
      let cleaned = desc.replace(/\(\s*(?:\d+|&)\s*\)/g, ", ");
      // parentheticals: drop wall markers, foot-only lists ("(right, left)"
      // on a jump), and options; keep real directions like "(forward)" in
      // "lock step right (forward)"
      cleaned = cleaned.replace(/\(([^)]*)\)/g, (m, inner) => {
        if (/[\d:]/.test(inner) && !/\b(forward|fwd|back|side)\b/i.test(inner)) return " ";
        if (/^[\s,]*(?:(?:right|left|r|l|rf|lf|both|feet|and)[\s,]*)+$/i.test(inner)) return " ";
        if (/\b(left|right|forward|fwd|back|backward|side|together|behind|across|front|weight)\b/i.test(inner)) {
          return " " + inner + " ";
        }
        return " ";
      });
      if (noteM) {
        const noteTurn = matchTurn(noteM[0].replace(/\(.*?\)/g, " "));
        if (noteTurn && /new wall|next wall|to start/i.test(noteM[0])) wallTurn = noteTurn.deg;
        cleaned = cleaned.replace(/note\s*:.*$/i, " ");
      }

      // "Repeat 1-2 (two more times)" / "Repeat 1-4 with left foot": clone the
      // already-parsed events for those counts onto this line's counts,
      // cycling if the line spans more repeats, mirroring if asked
      const ra = cleaned.match(/^\s*repeat\s+(?:the\s+)?(?:above|previous|last)\b/i);
      if (ra) {
        const span = tokens[tokens.length - 1].beat - tokens[0].beat + 1;
        const rb0 = offset + tokens[0].beat;
        const src = events.filter(e => e.beat >= rb0 - span - 1e-6 && e.beat < rb0 - 1e-6);
        if (src.length) {
          for (const e of src) events.push({ ...e, beat: e.beat + span });
          for (const tk of tokens) globalMax = Math.max(globalMax, offset + tk.beat);
          lines.push({ sec: sections.length - 1, counts: countStr.replace(/\s+/g, " "), text: desc,
                       b0: rb0, b1: offset + tokens[tokens.length - 1].beat });
          continue;
        }
      }
      const rm = cleaned.match(/^\s*repeat\s+(?:counts?\s+)?(\d+)\s*-\s*(\d+)\s*([a-z ]*)$/i);
      if (rm) {
        const a = +rm[1] - 1, b = +rm[2] - 1;
        const mirror = /\b(left foot|opposite)\b/i.test(rm[3] || "");
        // the named counts are this section's; when they point at this very
        // line (a fresh section repeating the previous one), use the section
        // before it as the source
        let srcBase = offset + a;
        if (srcBase >= offset + tokens[0].beat && sections.length > 1) {
          srcBase = sections[sections.length - 2].startBeat + a;
        }
        const src = events.filter(e => e.beat >= srcBase - 1e-6 && e.beat < srcBase + (b - a + 1) - 1e-6);
        if (src.length) {
          const span = b - a + 1;
          const rb0 = offset + tokens[0].beat;
          const rb1 = offset + tokens[tokens.length - 1].beat;
          for (let base = rb0; base <= rb1 + 1e-6; base += span) {
            for (const e of src) {
              const nb = base + (e.beat - srcBase);
              if (nb > rb1 + 0.5 + 1e-6) continue;
              const ev = { ...e, beat: nb };
              if (mirror) {
                if (ev.foot) ev.foot = other(ev.foot);
                if (ev.weight) ev.weight = other(ev.weight);
                if (ev.dx) ev.dx = -ev.dx;
                if (ev.aOff) ev.aOff = -ev.aOff;
                if (ev.turn) ev.turn = -ev.turn;
              }
              events.push(ev);
            }
          }
          for (const tk of tokens) globalMax = Math.max(globalMax, offset + tk.beat);
          lines.push({ sec: sections.length - 1, counts: countStr.replace(/\s+/g, " "), text: desc, b0: rb0, b1: rb1 });
          continue;
        }
      }

      // real sheets separate phrases with commas, semicolons, or sentences
      const phrases = cleaned.replace(/\.\s+/g, ", ").replace(/\.\s*$/, "").split(/[,;]/);
      const phraseTurn = [];
      for (let i = 0; i < phrases.length; i++) {
        const t = matchTurn(phrases[i]);
        if (t) { phraseTurn[i] = t.deg; phrases[i] = phrases[i].replace(t.raw, " "); }
      }

      const ctx = { mode: null, dir: "fwd", shufflePos: 0, lastFoot: null };
      const steps = [];
      let turnCount = 0;
      for (let i = 0; i < phrases.length; i++) {
        const got = parsePhrase(phrases[i], ctx, warn);
        if (phraseTurn[i] !== undefined) {
          turnCount++;
          if (!got.length) got.push({ kind: "pivot", txt: cap(phrases[i].trim() || "Turn") });
          got[0].turn = (got[0].turn || 0) + phraseTurn[i];
        }
        steps.push(...got);
      }

      // a single turn over a whole turning shuffle spreads across its steps
      if (turnCount === 1 && steps.length === 3 && steps.every(s => s.kind.startsWith("shuffle"))) {
        const deg = steps.find(s => s.turn).turn;
        for (const s of steps) s.turn = deg / 3;
      }

      // "(2x)" / "x2" on a line repeats its steps that many times
      const xm = desc.match(/\(\s*(\d+)\s*x\s*\)|\(\s*x\s*(\d+)\s*\)/i);
      if (xm && steps.length) {
        const times = +(xm[1] || xm[2]);
        const consuming0 = steps.filter(st => !st.sameBeat).length;
        if (times > 1 && times < 9 && consuming0 * times <= tokens.length) {
          const copy = JSON.parse(JSON.stringify(steps));
          for (let r = 1; r < times; r++) steps.push(...JSON.parse(JSON.stringify(copy)));
        }
      }

      // "march in place for 8 counts" fills the line's counts with
      // alternating in-place steps
      const mi = steps.findIndex(s => s.kind === "march_fill");
      if (mi !== -1) {
        const consumingOthers = steps.filter(s => s.kind !== "march_fill" && !s.sameBeat).length;
        const need = Math.max(1, tokens.length - consumingOthers);
        const fills = [];
        let mf = other(ctx.lastFoot || "L");
        for (let k = 0; k < need; k++) {
          fills.push({ kind: "place", foot: mf, txt: steps[mi].txt });
          mf = other(mf);
        }
        if (steps[mi].turn) fills[0].turn = steps[mi].turn;
        steps.splice(mi, 1, ...fills);
      }

      // section length counts every beat on the line, even ones whose step
      // could not be parsed
      for (const tk of tokens) globalMax = Math.max(globalMax, offset + tk.beat);

      // steps marked sameBeat share the previous step's count; if there are
      // spare counts, promote them to their own count instead
      let consuming = steps.filter(s => !s.sameBeat).length;
      for (const st of steps) {
        if (consuming >= tokens.length) break;
        if (st.sameBeat) { st.sameBeat = false; consuming++; }
      }
      if (consuming !== tokens.length) {
        warn("Counts \"" + countStr + "\" have " + tokens.length + " beats but " + consuming +
             " steps were parsed: \"" + desc + "\"");
      }
      const b0 = offset + tokens[0].beat;
      let b1 = b0;
      let lastFootForPivot = null;
      let ti = 0, lastTok = null, lostTurn = 0;
      for (const st of steps) {
        if (!st.sameBeat) {
          if (ti >= tokens.length) { if (st.turn) lostTurn += st.turn; continue; }
          lastTok = tokens[ti++];
        }
        const tk = lastTok;
        if (!tk) continue;
        const beat = offset + tk.beat;
        b1 = Math.max(b1, beat);
        const ev = { beat, c: tk.c, txt: st.txt };
        if (st.turn) ev.turn = st.turn;
        if (st.kind === "hold") { /* no movement */ }
        else if (st.kind === "recover") { ev.weight = st.foot; }
        else if (st.kind === "pivot") { ev.weight = other(lastFootForPivot || "L"); }
        else {
          const k = KIND[st.kind];
          const mir = st.foot === "L" && !k.noMirror ? -1 : 1;
          ev.foot = st.foot;
          ev.dx = k.dx * mir;
          ev.dy = k.dy;
          if (k.lifted) ev.lifted = true;
          if (k.aOff) ev.aOff = k.aOff * mir;
          if (k.self) ev.self = true;
          if (k.noWeight) ev.noWeight = true;
          if (k.impact) ev.impact = true;
          if (k.pose) ev.pose = k.pose;
          if (st.badge || k.badge) ev.badge = st.badge || k.badge;
          if (!k.lifted && !k.noWeight) lastFootForPivot = st.foot;
        }
        events.push(ev);
      }
      if (lostTurn && events.length) {
        const last = events[events.length - 1];
        last.turn = (last.turn || 0) + lostTurn;
      }
      lines.push({ sec: sections.length - 1, counts: countStr.replace(/\s+/g, " "), text: desc, b0, b1 });
      continue;
    }

    // non-counted line: header, title, or noise
    if (/^section\b/i.test(line) ||
        (/[A-Za-z]{3}/.test(line) && line === line.toUpperCase() && !/^\d/.test(line))) {
      pendingName = line.replace(/^section\s*\d+\s*[:.-]?\s*/i, "").trim() || line;
      continue;
    }
    if (!title && lines.length === 0 && sections.length === 0 && line.length < 80 &&
        !/:/.test(line)) {
      title = line;
    }
  }
  closeSection();

  if (!events.length) { warn("No step lines found."); return { events, sections, lines, warnings, ok: false }; }

  // facing change per wall determines the wall count
  const netTurn = events.reduce((s, e) => s + (e.turn || 0), 0) + wallTurn;
  const change = ((Math.round(netTurn) % 360) + 360) % 360;
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const walls = change === 0 ? 1 : 360 / gcd(change, 360);
  if (meta.walls && meta.walls !== walls) {
    warn("Sheet says " + meta.walls + " walls but the parsed turns give " + walls +
         (walls === 1 ? " (no turn between walls was found)" : "") + ".");
  }
  const wallBeats = Math.ceil(globalMax + 0.5);
  if (meta.count && meta.count !== wallBeats) {
    warn("Sheet says " + meta.count + " counts but the parsed sections total " + wallBeats + ".");
  }

  return {
    ok: true, events, sections, lines, warnings,
    title: title || "Pasted dance",
    meta, intro, wallTurn, walls, wallBeats
  };
}

// Node test harness support; in the browser these are plain globals.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseStepsheet, parsePhrase, matchTurn, KIND, FRAC, other };
}
