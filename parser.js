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
  skate:              { dx: 1.0,   dy: 0.75, aOff: 18, badge: "SKATE" }
};

const FRAC = {
  "1/4": 90, "¼": 90, "quarter": 90,
  "1/2": 180, "½": 180, "half": 180,
  "3/4": 270, "¾": 270,
  "full": 360
};
const FRAC_RE = "(1\\/4|1\\/2|3\\/4|\\u00bc|\\u00bd|\\u00be|quarter|half|full)";

function matchTurn(s) {
  let m = s.match(new RegExp(FRAC_RE + "\\s*(?:of\\s+a\\s+)?turn\\s*(?:to\\s+)?(?:the\\s+)?(left|right)", "i"))
       || s.match(new RegExp("turn(?:ing)?\\s*" + FRAC_RE + "\\s*(?:turn\\s*)?(?:to\\s+)?(?:the\\s+)?(left|right)", "i"))
       || s.match(new RegExp(FRAC_RE + "\\s*(left|right)\\s*turn", "i"));
  if (!m) return null;
  const deg = FRAC[m[1].toLowerCase()];
  return { deg: m[2].toLowerCase() === "left" ? -deg : deg, raw: m[0] };
}

function footIn(s) {
  const m = s.match(/\b(right|left)\b/i);
  return m ? (m[1].toLowerCase() === "right" ? "R" : "L") : null;
}
function other(f) { return f === "R" ? "L" : "R"; }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// Parses one comma-separated phrase into zero or more steps.
// A step: { kind, foot } | { kind:'recover'|'pivot'|'hold', ... }
function parsePhrase(raw, ctx, warn) {
  let p = raw.trim().replace(/^and\s+/i, "").replace(/\s+/g, " ");
  if (!p) return [];
  const lower = p.toLowerCase();
  const foot = footIn(lower);
  const out = [];
  const push = (kind, f, extra) => {
    const st = Object.assign({ kind, foot: f, txt: cap(p) }, extra);
    out.push(st);
    if (f && !KIND[kind]?.lifted && kind !== "recover") ctx.lastFoot = f;
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

  if (/^(hold|clap|snap|slap)\b/.test(lower)) { out.push({ kind: "hold", txt: cap(p) }); return out; }
  if (/\b(bump|hip)\b/.test(lower)) {
    ctx.mode = "bump";
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
  if (/\bpivot\b|\bpaddle\b/.test(lower)) { out.push({ kind: "pivot", txt: cap(p) }); return out; }

  if (/\b(shuffle|chassé|chasse|triple)\b/.test(lower)) {
    const dir = /\bback(?:wards?)?\b/.test(lower) ? "back" : /\bside\b/.test(lower) ? "side" : "fwd";
    const feet = [...lower.matchAll(/\b(right|left)\b/g)].map(m => m[1] === "right" ? "R" : "L");
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

  if (/\brock\b/.test(lower)) {
    const kind = /\b(back|backwards?)\b/.test(lower) ? "rock_back"
               : /\bside\b/.test(lower) ? "rock_side" : "rock_fwd";
    push(kind, foot || other(ctx.lastFoot || "L"));
    return out;
  }
  if (/\b(recover|replace)\b/.test(lower) ||
      /^weight\s+(?:back\s+)?(?:on|to|onto)\b/.test(lower)) {
    out.push({ kind: "recover", foot: foot || other(ctx.lastFoot || "L"), txt: cap(p) });
    if (out[0].foot) ctx.lastFoot = out[0].foot;
    return out;
  }

  if (/\bdrag\b/.test(lower)) { push("drag", foot || other(ctx.lastFoot || "L")); return out; }
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
    const kind = /\b(back(?:wards?)?|behind)\b/.test(lower) ? "toe_back"
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

  // generic steps, walks, hops, and bare-foot continuations
  const stepLike = /\b(step|walk|stroll|run|stride|hop|scoot|close)\b/.test(lower);
  const bareFoot = /^(right|left)$/.test(lower);
  if (stepLike || bareFoot || ctx.mode) {
    if (/\b(walk|stroll|run|stride)\b/.test(lower)) ctx.mode = "walk";
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
    let kind;
    if (/\b(beside|together|next to|close|home)\b/.test(lower)) kind = "close";
    else if (/\bin place\b/.test(lower)) kind = "place";
    else if (/\bbehind\b/.test(lower)) kind = "cross_back";
    else if (/\b(across|over|cross)\b/.test(lower)) kind = "cross_front";
    else if (/\bside\b/.test(lower)) kind = "side";
    else if (/\b(forward|fwd)\b/.test(lower)) kind = "fwd";
    else if (/\bback(?:wards?)?\b/.test(lower)) kind = "back";
    else if (bareFoot && ctx.mode === "walk") kind = ctx.walkDir || "fwd";
    else if (/^(?:lock )?step (?:on )?(right|left)$/.test(lower)) kind = "place";
    else if (ctx.mode === "walk") kind = ctx.walkDir || "fwd"; // walks keep traveling
    else { kind = "close"; warn("Guessed 'step together' for: \"" + p + "\""); }
    if (ctx.mode === "walk" && (kind === "fwd" || kind === "back")) ctx.walkDir = kind;
    const st = push(kind, f);
    if (/\b(hop|scoot)\b/.test(lower)) st.badge = /\bscoot\b/.test(lower) ? "SCOOT" : "HOP";
    return out;
  }

  if (/\bcross\b/.test(lower)) {
    push(/\bbehind\b/.test(lower) ? "cross_back" : "cross_front", foot || other(ctx.lastFoot || "L"));
    return out;
  }

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
  let pendingName = null;
  let cur = null;        // current section
  let prevFirstNum = Infinity;
  let globalMax = 0;     // highest global beat seen

  const closeSection = () => {
    if (cur) cur.beats = Math.max(1, Math.ceil(globalMax + 0.5) - cur.startBeat);
    cur = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("(")) continue;
    if (/^(repeat|ending|contact|last update|note)\b/i.test(line)) {
      if (/^(tag|restart)/i.test(line)) warn("Tags/restarts are not supported yet: \"" + line + "\"");
      continue;
    }
    if (/^(tag|restart)/i.test(line)) { warn("Tags/restarts are not supported yet: \"" + line + "\""); continue; }
    if (/^starts?\b/i.test(line)) { intro = line; continue; }
    if (/^(counts?|walls?|level|chore|music)\b\s*:/i.test(line)) continue;

    const cm = line.match(/^(&?\s*[0-9][0-9&,\-\s]*)(.*)$/);
    if (cm && cm[2] && /[A-Za-z]/.test(cm[2]) && cm[2].trim().length > 3) {
      // a counted step line
      let countStr = cm[1].trim();
      let desc = cm[2].trim();

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

      // counts that restart from 1 advance the global offset; sheets with
      // continuous counts (1-32 straight through) keep offset at 0 no matter
      // how many section headers they have
      const firstNum = tokens[0].beat;
      if (cur && firstNum < prevFirstNum) {
        offset = Math.ceil(globalMax + 0.5);
      }
      if (!cur || firstNum < prevFirstNum || pendingName) {
        closeSection();
        cur = { name: pendingName || "Section " + (sections.length + 1),
                startBeat: offset + firstNum, beats: 8 };
        sections.push(cur);
        pendingName = null;
      }
      prevFirstNum = firstNum;

      // pull out the end-of-wall note before general turn matching
      const noteM = desc.match(/note\s*:.*$/i);
      // parentheticals: drop wall markers and options, keep real directions
      // like "(forward)" in "lock step right (forward)"
      let cleaned = desc.replace(/\(([^)]*)\)/g, (m, inner) => {
        if (/[\d:]/.test(inner) && !/\b(forward|fwd|back|side)\b/i.test(inner)) return " ";
        if (/\b(left|right|forward|fwd|back|backward|side|together|behind|across|front)\b/i.test(inner)) {
          return " " + inner + " ";
        }
        return " ";
      });
      if (noteM) {
        const noteTurn = matchTurn(noteM[0].replace(/\(.*?\)/g, " "));
        if (noteTurn && /new wall|next wall|to start/i.test(noteM[0])) wallTurn = noteTurn.deg;
        cleaned = cleaned.replace(/note\s*:.*$/i, " ");
      }

      const phrases = cleaned.split(/[,;]/);
      let turnInfo = null, turnPhraseIdx = -1;
      for (let i = 0; i < phrases.length; i++) {
        const t = matchTurn(phrases[i]);
        if (t) { turnInfo = t; turnPhraseIdx = i; phrases[i] = phrases[i].replace(t.raw, " "); break; }
      }

      const ctx = { mode: null, dir: "fwd", shufflePos: 0, lastFoot: null };
      const steps = [];
      const phraseFirstStep = [];
      for (let i = 0; i < phrases.length; i++) {
        phraseFirstStep[i] = steps.length;
        const got = parsePhrase(phrases[i], ctx, warn);
        if (!got.length && i === turnPhraseIdx) got.push({ kind: "pivot", txt: cap(phrases[i].trim() || "Turn") });
        steps.push(...got);
      }

      if (turnInfo) {
        if (steps.length === 3 && steps.every(s => s.kind.startsWith("shuffle"))) {
          for (const s of steps) s.turn = turnInfo.deg / 3;
        } else {
          const idx = Math.min(phraseFirstStep[Math.max(turnPhraseIdx, 0)] || 0, steps.length - 1);
          if (steps[idx]) steps[idx].turn = turnInfo.deg;
        }
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
      let ti = 0, lastTok = null;
      for (const st of steps) {
        if (!st.sameBeat) {
          if (ti >= tokens.length) break;
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
