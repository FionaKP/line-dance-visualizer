"use strict";
// ---------------------------------------------------------------------------
// Learn-the-steps demo sheets: render a figure's canonical loopable count
// sequence (figures.js FIGURES[id].canon) as CopperKnob-style stepsheet TEXT.
// The demo page feeds that text through the NORMAL loader path (parser ->
// figure detection -> timeline -> renderer), so a demo is rendered by exactly
// the same pipeline as a real dance — figures.js detection re-tags the
// synthesized steps and applies the catalog placement numbers.
//
// Pure (no DOM) and dual-loaded like parser.js: a classic script in the
// browser (globals DEMO), require()-able from Node for verification scripts.
// ---------------------------------------------------------------------------

const DEMO_NAMES = {
  vine: "Grapevine",
  weave: "Weave",
  jazz_box: "Jazz Box",
  k_step: "K Step",
  lindy: "Lindy",
  rocking_chair: "Rocking Chair",
  coaster: "Coaster Step",
  sailor: "Sailor Step",
  mambo: "Mambo",
  lock_step: "Lock Step",
  pivot: "Pivot Turn",
  monterey: "Monterey Turn",
  scissor: "Scissor Step",
  charleston: "Charleston",
  hip_bumps: "Hip Bumps",
  heel_splits: "Heel Splits",
  kick_ball_change: "Kick-Ball-Change"
};

const FRAC_WORD = { 45: "⅛", 90: "¼", 135: "⅜", 180: "½", 270: "¾", 360: "full" };

function fracFor(turn) {
  return FRAC_WORD[Math.abs(turn)] || "¼";
}
function dirFor(turn) { return turn > 0 ? "right" : "left"; }

// one canon step -> a stepsheet phrase the parser understands
function phraseFor(st) {
  const F = st.foot === "R" ? "right" : "left";
  const O = st.foot === "R" ? "left" : "right";
  let p;
  switch (st.action) {
    case "side":        p = "Step " + F + " to " + F + " side"; break;
    case "close":       p = "Step " + F + " beside " + O; break;
    case "fwd":         p = "Step " + F + " forward"; break;
    case "back":        p = "Step " + F + " back"; break;
    case "fwd_diag":    p = "Step " + F + " diagonally forward " + F; break;
    case "back_diag":   p = "Step " + F + " diagonally back " + F; break;
    case "cross_front": p = "Cross " + F + " over " + O; break;
    case "cross_back":  p = "Cross " + F + " behind " + O; break;
    case "touch":       p = "Touch " + F + " beside " + O; break;
    case "touch_fwd":   p = "Touch " + F + " forward"; break;
    case "touch_back":  p = "Touch " + F + " back"; break;
    case "point_side":  p = "Point " + F + " to " + F + " side"; break;
    case "rock_fwd":    p = "Rock " + F + " forward"; break;
    case "rock_back":   p = "Rock " + F + " back"; break;
    case "recover":     return "Recover onto " + (st.weight === "R" ? "right" : "left");
    case "lock_back":   p = "Lock " + F + " behind " + O; break;
    case "lock_front":  p = "Lock " + F + " over " + O; break;
    case "scuff":       p = "Scuff " + F + " forward"; break;
    case "kick":        p = "Kick " + F + " forward"; break;
    case "ball":        p = "Step ball of " + F + " beside " + O; break;
    case "pivot":       return "Pivot " + fracFor(st.turn) + " turn " + dirFor(st.turn);
    case "bump":        return "Bump hips " + (st.side === "R" ? "right" : "left");
    default:            p = "Step " + F + " beside " + O; break;
  }
  if (st.turn && st.action !== "pivot") {
    // e.g. Monterey: "Turn ½ right and step right beside left"
    p = "Turn " + fracFor(st.turn) + " " + dirFor(st.turn) + " and " +
        p.charAt(0).toLowerCase() + p.slice(1);
  }
  if (st.clap) p += " and clap";
  return p;
}

// same-count canon entries (heel splits move both feet at once) fold into a
// single phrase; everything else maps one entry -> one phrase
function phraseForGroup(group) {
  const a = group[0];
  if (a.action === "heels_out") return "Split heels out";
  if (a.action === "heels_in") return "Heels back to center";
  return group.map(phraseFor).join(" and ");
}

// canon -> CopperKnob-ish stepsheet text. Short canons repeat until a pass
// is at least `minCounts` (default 8) so a demo loop breathes.
function demoSheet(figureId, registry, minCounts) {
  const entry = registry[figureId];
  if (!entry) return null;
  const canon = entry.canon;
  const name = DEMO_NAMES[figureId] || figureId;

  // group canon steps by count (order preserved)
  const groups = [];
  for (const st of canon) {
    const last = groups[groups.length - 1];
    if (last && last.count === st.count) last.steps.push(st);
    else groups.push({ count: st.count, steps: [st] });
  }
  const passLen = Math.ceil(groups[groups.length - 1].count);
  const reps = Math.max(1, Math.ceil((minCounts || 8) / passLen));
  const total = passLen * reps;

  // emit lines of at most 4 whole counts
  const lineFor = items => {
    let counts = "";
    const phrases = [];
    for (const it of items) {
      counts += Number.isInteger(it.count) ? (counts ? " " : "") + it.count : "&";
      phrases.push(it.phrase);
    }
    return counts + " " + phrases.join(", ");
  };
  const lines = [];
  let cur = [], curBucket = null;
  for (let r = 0; r < reps; r++) {
    for (const g of groups) {
      const c = g.count + r * passLen;
      const bucket = Math.floor((Math.ceil(c) - 1) / 4);
      if (curBucket !== null && bucket !== curBucket) { lines.push(lineFor(cur)); cur = []; }
      curBucket = bucket;
      cur.push({ count: c, phrase: phraseForGroup(g.steps) });
    }
  }
  if (cur.length) lines.push(lineFor(cur));

  return name + "\n" +
    "Count: " + total + "  Wall: 1  Level: Learn the steps\n\n" +
    name.toUpperCase() + "\n" +
    lines.join("\n") + "\n\nREPEAT\n";
}

const DEMO = { demoSheet, DEMO_NAMES };

if (typeof module !== "undefined" && module.exports) {
  module.exports = DEMO;
} else if (typeof window !== "undefined") {
  window.DEMO = DEMO;
}
