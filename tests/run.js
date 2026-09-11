#!/usr/bin/env node
"use strict";
/*
 * Eval harness for the stepsheet parser (parser.js) and tempo detector
 * (tempo.js). Zero dependencies.
 *
 *   node tests/run.js               run everything, print a scorecard
 *   node tests/run.js --dump NAME   print parsed events for a fixture
 *                                   (to help author expectations)
 *
 * Parser fixtures live in tests/fixtures/NAME.txt with expectations in
 * tests/expected/NAME.json:
 *   {
 *     "meta":   { "ok": true, "wallBeats": 24, "walls": 4, "warnings": 0 },
 *     "events": [ { "beat": 0, "foot": "R", "dy": 0.9 },
 *                 { "beat": 2, "turn": -180 },
 *                 { "beat": 4, "foot": "L", "dyMin": 0.5 } ]
 *   }
 * Every key in an events entry besides beat/foot must match the parsed event
 * at that beat (same foot, if given). *Min / *Max suffixes do range checks.
 * "warnings" is a maximum. Only assert what matters — expectations should
 * survive unrelated parser improvements.
 *
 * Each run appends a summary to tests/history.jsonl and prints the delta
 * against the previous run, so a change that regresses anything is loud.
 */

const fs = require("fs");
const path = require("path");
const { parseStepsheet } = require("../parser.js");
const { gridFromWave } = require("../tempo.js");

const FIX = path.join(__dirname, "fixtures");
const EXP = path.join(__dirname, "expected");
const HISTORY = path.join(__dirname, "history.jsonl");

// --- dump mode -------------------------------------------------------------
const dumpArg = process.argv.indexOf("--dump");
if (dumpArg !== -1) {
  const name = process.argv[dumpArg + 1].replace(/\.txt$/, "").replace(/^.*\//, "");
  const parsed = parseStepsheet(fs.readFileSync(path.join(FIX, name + ".txt"), "utf8"));
  console.log(JSON.stringify({
    ok: parsed.ok, wallBeats: parsed.wallBeats, walls: parsed.walls,
    warnings: parsed.warnings, events: parsed.events
  }, null, 1));
  process.exit(0);
}

// --- parser suite ----------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
const perFixture = {};

function check(fixture, label, ok, detail) {
  if (ok) { pass++; perFixture[fixture].pass++; }
  else {
    fail++; perFixture[fixture].fail++;
    failures.push(fixture + ": " + label + (detail ? " — " + detail : ""));
  }
}

function matchEvent(parsed, want) {
  const cand = parsed.events.filter(e =>
    Math.abs(e.beat - want.beat) < 1e-6 && (!want.foot || e.foot === want.foot));
  if (!cand.length) return "no event at beat " + want.beat + (want.foot ? " for foot " + want.foot : "");
  const errs = [];
  for (const ev of cand) {
    const bad = [];
    for (const [k, v] of Object.entries(want)) {
      if (k === "beat" || k === "foot") continue;
      let m;
      if ((m = k.match(/^(\w+)Min$/))) {
        if (!(ev[m[1]] >= v)) bad.push(m[1] + "=" + ev[m[1]] + " < " + v);
      } else if ((m = k.match(/^(\w+)Max$/))) {
        if (!(ev[m[1]] <= v)) bad.push(m[1] + "=" + ev[m[1]] + " > " + v);
      } else if (typeof v === "number") {
        if (Math.abs((ev[k] ?? NaN) - v) > 1e-6) bad.push(k + "=" + ev[k] + " ≠ " + v);
      } else if ((ev[k] ?? null) !== v) bad.push(k + "=" + ev[k] + " ≠ " + v);
    }
    if (!bad.length) return null;
    errs.push(bad.join(", "));
  }
  return errs[0];
}

const fixtures = fs.readdirSync(FIX).filter(f => f.endsWith(".txt")).sort();
for (const file of fixtures) {
  const name = file.replace(/\.txt$/, "");
  perFixture[name] = { pass: 0, fail: 0 };
  const want = JSON.parse(fs.readFileSync(path.join(EXP, name + ".json"), "utf8"));
  let parsed;
  try {
    parsed = parseStepsheet(fs.readFileSync(path.join(FIX, file), "utf8"));
  } catch (e) {
    check(name, "parseStepsheet threw", false, e.message);
    continue;
  }
  const meta = want.meta || {};
  if ("ok" in meta) check(name, "ok", parsed.ok === meta.ok, "got " + parsed.ok);
  if ("wallBeats" in meta) check(name, "wallBeats " + meta.wallBeats, parsed.wallBeats === meta.wallBeats, "got " + parsed.wallBeats);
  if ("walls" in meta) check(name, "walls " + meta.walls, parsed.walls === meta.walls, "got " + parsed.walls);
  if ("warnings" in meta) check(name, "warnings ≤ " + meta.warnings, parsed.warnings.length <= meta.warnings,
    "got " + parsed.warnings.length + ": " + parsed.warnings.join(" | "));
  for (const evWant of want.events || []) {
    const err = matchEvent(parsed, evWant);
    check(name, "event@" + evWant.beat + (evWant.foot ? evWant.foot : ""), err === null, err);
  }
}

// --- tempo suite -----------------------------------------------------------
// Synthesized kick tracks: analyzeAudio() lowpasses real audio at 150 Hz
// before calling gridFromWave, so a decaying 55 Hz burst per beat is a fair
// stand-in for what the detector actually sees.
function synthClickTrack({ bpm, seconds, sr, silence, noise, swingGhosts }) {
  const wave = new Float32Array(Math.round(seconds * sr));
  const period = 60 / bpm;
  // deterministic noise so runs are reproducible
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  if (noise) for (let i = 0; i < wave.length; i++) wave[i] = rand() * noise;
  const burst = (t0, amp) => {
    const start = Math.round(t0 * sr);
    const len = Math.round(0.09 * sr);
    for (let j = 0; j < len && start + j < wave.length; j++) {
      wave[start + j] += amp * Math.sin(2 * Math.PI * 55 * j / sr) * Math.exp(-j / (0.02 * sr));
    }
  };
  for (let t = silence; t < seconds - 0.2; t += period) {
    burst(t, 0.9);
    if (swingGhosts) burst(t + period * 0.5, 0.25); // off-beat eighths
  }
  return wave;
}

const tempoCases = [
  { name: "steady 96bpm",        bpm: 96,  silence: 0.5, noise: 0.01 },
  { name: "slow 76bpm",          bpm: 76,  silence: 0.5, noise: 0.01 },
  { name: "fast 128bpm",         bpm: 128, silence: 0.5, noise: 0.02 },
  { name: "long intro 96bpm",    bpm: 96,  silence: 4.0, noise: 0.01 },
  { name: "eighths 100bpm",      bpm: 100, silence: 0.5, noise: 0.01, swingGhosts: true },
];
perFixture["tempo"] = { pass: 0, fail: 0 };
for (const tc of tempoCases) {
  const sr = 8000;
  const wave = synthClickTrack({ bpm: tc.bpm, seconds: 45, sr, silence: tc.silence,
                                 noise: tc.noise, swingGhosts: tc.swingGhosts });
  let g;
  try { g = gridFromWave(wave, sr); }
  catch (e) { check("tempo", tc.name + " threw", false, e.message); continue; }
  check("tempo", tc.name + " bpm", Math.abs(g.bpm - tc.bpm) <= 0.75,
        "expected " + tc.bpm + ", got " + g.bpm);
  // first beat should land on a click (any multiple of the period after start)
  const phase = ((g.firstBeat - tc.silence) % (60 / tc.bpm) + 60 / tc.bpm) % (60 / tc.bpm);
  const offBy = Math.min(phase, 60 / tc.bpm - phase);
  check("tempo", tc.name + " phase", offBy <= 0.06,
        "first beat " + g.firstBeat + "s is " + Math.round(offBy * 1000) + "ms off the click grid");
}

// --- figures suite ---------------------------------------------------------
// figures.js: registry shape, structural detection over real corpus sheets,
// catalog placement styling, hard foot-separation rule, and cue labels.
const FIG = require("../figures.js");
const CORPUS = path.join(__dirname, "..", "tuning", "corpus");
perFixture["figures.js"] = { pass: 0, fail: 0 };
const fcheck = (label, ok, detail) => check("figures.js", label, !!ok, detail);

function loadCorpus(slug) {
  return parseStepsheet(fs.readFileSync(path.join(CORPUS, slug + ".txt"), "utf8"));
}

// -- registry shape: all 17 catalog figures, well-formed, loopable canon ----
const CATALOG_IDS = [
  "vine", "weave", "jazz_box", "k_step", "lindy", "rocking_chair", "coaster",
  "sailor", "mambo", "lock_step", "pivot", "monterey", "scissor", "charleston",
  "hip_bumps", "heel_splits", "kick_ball_change"
];
fcheck("registry has exactly the 17 catalog ids",
  CATALOG_IDS.every(id => FIG.FIGURES[id]) &&
  Object.keys(FIG.FIGURES).length === CATALOG_IDS.length,
  "got: " + Object.keys(FIG.FIGURES).join(","));
for (const id of CATALOG_IDS) {
  const e = FIG.FIGURES[id] || {};
  fcheck(id + " entry shape",
    typeof e.label === "function" && e.header instanceof RegExp &&
    typeof e.match === "function" && Array.isArray(e.canon) && e.canon.length >= 3,
    JSON.stringify(Object.keys(e)));
}

// canon simulator: same relative-to-other-foot geometry as buildTimeline.
// "Loops seamlessly" = running the canon a second time reproduces the first
// pass's end state exactly (periodic), and no grounded landing ever comes
// closer than the cross clamp to the other foot.
function simCanon(canon, passes) {
  let theta = 0;
  const feet = { L: { x: -0.45, y: 0 }, R: { x: 0.45, y: 0 } };
  let minSep = Infinity;
  for (let p = 0; p < passes; p++) {
    for (const st of canon) {
      if (st.turn) theta += st.turn;
      if (!st.foot || st.dx === undefined) continue;
      const o = st.self ? feet[st.foot] : feet[st.foot === "R" ? "L" : "R"];
      const th = theta * Math.PI / 180;
      const x = o.x + st.dx * Math.cos(th) + st.dy * Math.sin(th);
      const y = o.y - st.dx * Math.sin(th) + st.dy * Math.cos(th);
      feet[st.foot] = { x, y };
      if (!st.lifted && !st.self) {
        const ot = feet[st.foot === "R" ? "L" : "R"];
        minSep = Math.min(minSep, Math.hypot(x - ot.x, y - ot.y));
      }
    }
  }
  return { feet: JSON.parse(JSON.stringify(feet)), theta, minSep };
}
for (const id of CATALOG_IDS) {
  const canon = FIG.FIGURES[id].canon;
  const one = simCanon(canon, 1), two = simCanon(canon, 2);
  // periodic: the second pass reproduces the first pass's end state
  const drift = Math.max(
    Math.hypot(two.feet.L.x - one.feet.L.x, two.feet.L.y - one.feet.L.y),
    Math.hypot(two.feet.R.x - one.feet.R.x, two.feet.R.y - one.feet.R.y));
  fcheck(id + " canon loops (periodic, drift<=0.15)", drift <= 0.15, "drift " + drift.toFixed(2));
  fcheck(id + " canon net turn is whole revolutions",
    ((Math.round(one.theta) % 360) + 360) % 360 === 0, "theta " + one.theta);
  fcheck(id + " canon landings respect the spacing rule",
    one.minSep >= FIG.SEP.cross - 1e-6, "minSep " + one.minSep.toFixed(2));
}

// -- detection: structure over header prose ---------------------------------
function spansOf(parsed) { return FIG.detectFigures(parsed); }
function has(spans, id, pred) {
  return spans.some(sp => sp.figureId === id && (!pred || pred(sp)));
}

// tush-push: hip bumps (stride stance, counts 13-20), cha triples, pivots
{
  const p = loadCorpus("tush-push");
  const sp = spansOf(p);
  fcheck("tush-push: hip bumps tagged over counts 13-20",
    has(sp, "hip_bumps", s => s.startBeat <= 12.5 && s.endBeat >= 19 && s.meta.bumps >= 6),
    JSON.stringify(sp.filter(s => s.figureId === "hip_bumps")));
  fcheck("tush-push: hip bump stance is narrow/stride",
    has(sp, "hip_bumps", s => s.meta.stance === "stride"),
    JSON.stringify(sp.filter(s => s.figureId === "hip_bumps").map(s => s.meta)));
  fcheck("tush-push: cha triples tagged",
    sp.filter(s => s.figureId === "mambo" && s.meta.variant === "cha").length >= 3,
    JSON.stringify(sp.filter(s => s.figureId === "mambo")));
  fcheck("tush-push: half pivots tagged",
    sp.filter(s => s.figureId === "pivot" && Math.abs(s.meta.deg) >= 170).length >= 2,
    JSON.stringify(sp.filter(s => s.figureId === "pivot")));
}

// electric-slide: two vines, styled to catalog spacing
{
  const p = loadCorpus("electric-slide");
  const sp = FIG.applyStyling(p);
  fcheck("electric-slide: vine R tagged at count 1",
    has(sp, "vine", s => s.foot === "R" && s.startBeat === 0), JSON.stringify(sp.slice(0, 2)));
  fcheck("electric-slide: vine L tagged at count 5",
    has(sp, "vine", s => s.foot === "L" && s.startBeat === 4));
  const behind = p.events.find(e => e.beat === 1);
  fcheck("electric-slide: behind-cross is a loose narrow stagger",
    Math.abs(behind.dx) <= 0.25 && behind.dy <= -0.5 && behind.dy >= -0.75,
    JSON.stringify(behind));
  const side1 = p.events.find(e => e.beat === 0);
  fcheck("electric-slide: vine side steps reach 1.5-2u and glide",
    Math.abs(side1.dx) >= 1.5 && Math.abs(side1.dx) <= 2 && side1.glide === true,
    JSON.stringify(side1));
  fcheck("electric-slide: count-4 scuff flourish preserved",
    p.events.some(e => e.beat === 3 && e.badge === "SCUFF"));
}

// canadian-stomp: jazz boxes + vines
{
  const p = loadCorpus("canadian-stomp");
  const sp = FIG.applyStyling(p);
  fcheck("canadian-stomp: jazz box tagged (both boxes)",
    sp.filter(s => s.figureId === "jazz_box").length >= 2,
    JSON.stringify(sp.filter(s => s.figureId === "jazz_box")));
  fcheck("canadian-stomp: vine R + turning vine L tagged",
    sp.filter(s => s.figureId === "vine").length >= 2);
  const cross = p.events.find(e => e.beat === 32);
  fcheck("canadian-stomp: jazz cross is shallow with 30deg turnout",
    Math.abs(cross.dx) <= 0.35 && cross.dy >= 0.4 && cross.turnout === 30,
    JSON.stringify(cross));
  const back = p.events.find(e => e.beat === 33);
  fcheck("canadian-stomp: jazz back step tucks under the hip (compact box)",
    Math.abs(back.dx) <= 0.3 && back.dy >= -1 && back.dy <= -0.8, JSON.stringify(back));
}

// drunken-sailor: K step + heel splits, and NO sailor despite the title
{
  const p = loadCorpus("drunken-sailor");
  const sp = FIG.applyStyling(p);
  fcheck("drunken-sailor: K step tagged at section 3",
    has(sp, "k_step", s => s.startBeat === 16), JSON.stringify(sp.map(s => s.figureId + "@" + s.startBeat)));
  fcheck("drunken-sailor: heel splits tagged at count 1",
    has(sp, "heel_splits", s => s.startBeat === 0));
  fcheck("drunken-sailor: NO sailor tagged (title words lie)",
    !has(sp, "sailor"));
  const diag = p.events.find(e => e.beat === 16);
  fcheck("drunken-sailor: K-step corners are true diagonals (~1.4u)",
    Math.abs(diag.dx) === 1 && diag.dy === 1, JSON.stringify(diag));
  const splits = p.events.filter(e => e.beat === 0 && e.self);
  fcheck("drunken-sailor: heel splits fan both heels (aOff, no weight)",
    splits.length === 2 && splits.every(e => Math.abs(e.aOff) >= 18 && e.noWeight),
    JSON.stringify(splits));
  fcheck("drunken-sailor: K-step claps land with the touches",
    p.events.some(e => e.beat === 17 && e.clap) && p.events.some(e => e.beat === 23 && e.clap));
}

// picnic-polka: rolling vines — continuous 1/4-1/2-1/4 spin, constant travel
{
  const p = loadCorpus("picnic-polka");
  const sp = FIG.applyStyling(p);
  fcheck("picnic-polka: rolling vines tagged",
    sp.filter(s => s.figureId === "vine" && s.meta.rolling).length >= 2,
    JSON.stringify(sp.filter(s => s.figureId === "vine").map(s => s.meta)));
  const t1 = p.events.find(e => e.beat === 16), t2 = p.events.find(e => e.beat === 17),
        t3 = p.events.find(e => e.beat === 18);
  fcheck("picnic-polka: rolling vine splits the turn 1/4-1/2-1/4",
    t1.turn === 90 && t2.turn === 180 && t3.turn === 90,
    JSON.stringify([t1.turn, t2.turn, t3.turn]));
  fcheck("picnic-polka: rolling vine travel vector constant (1.25u/count)",
    t1.dy === 1.25 && t2.dy === -1.25 && Math.abs(t3.dx) === 1.5,
    JSON.stringify([t1, t2, t3].map(e => [e.dx, e.dy])));
}

// wagon-wheel-rock: lock steps + rocking chair
{
  const p = loadCorpus("wagon-wheel-rock");
  const sp = FIG.applyStyling(p);
  fcheck("wagon-wheel: lock steps tagged", sp.filter(s => s.figureId === "lock_step").length >= 2);
  fcheck("wagon-wheel: rocking chairs tagged", sp.filter(s => s.figureId === "rocking_chair").length >= 2);
  const lock = p.events.find(e => e.beat === 1);
  fcheck("wagon-wheel: lock tucks directly behind on the ball",
    Math.abs(lock.dx) <= 0.2 && lock.dy === -0.47, JSON.stringify(lock));
  const rf = p.events.find(e => e.beat === 24), rb = p.events.find(e => e.beat === 26);
  fcheck("wagon-wheel: rocking chair rocks 1.3u, dead stationary",
    rf.dy === 1.3 && rb.dy === -1.3, JSON.stringify([rf.dy, rb.dy]));
}

// gypsy-queen: weave + coaster, and NO monterey (the sheet's word lies —
// its "monterey"-ish claim is paddle quarter turns)
{
  const p = loadCorpus("gypsy-queen");
  const sp = FIG.applyStyling(p);
  fcheck("gypsy-queen: weave tagged", has(sp, "weave"));
  fcheck("gypsy-queen: coaster tagged at counts 5&6 of S4",
    has(sp, "coaster", s => s.startBeat === 28), JSON.stringify(sp.filter(s => s.figureId === "coaster")));
  fcheck("gypsy-queen: NO monterey (paddle turns are not a monterey)", !has(sp, "monterey"));
  const cb = p.events.find(e => e.beat === 28);
  fcheck("gypsy-queen: coaster sits down 1.1u into the back step",
    cb.dy === -1.1, JSON.stringify(cb));
}

// sambas-and-sailors: real sailors (swept behind + out-out) do tag
{
  const p = loadCorpus("sambas-and-sailors");
  const sp = spansOf(p);
  fcheck("sambas-and-sailors: sailor steps tagged",
    sp.filter(s => s.figureId === "sailor").length >= 2,
    JSON.stringify(sp.filter(s => s.figureId === "sailor")));
}

// cowboy-boogie: forward-stance hip bumps get the fwd stance tag
{
  const sp = spansOf(loadCorpus("cowboy-boogie"));
  fcheck("cowboy-boogie: hip bumps tagged with fwd stance",
    has(sp, "hip_bumps", s => s.meta.stance === "fwd"),
    JSON.stringify(sp.filter(s => s.figureId === "hip_bumps").map(s => s.meta)));
}

// -- synthetic sheets for figures the corpus lacks --------------------------
function parseSnippet(body) {
  return parseStepsheet("Synthetic Figure Test\nCount: 8 Wall: 1\n\nSECTION ONE\n" + body + "\n");
}
{
  const p = parseSnippet(
    "1-2 Point right to side, turn 1/2 right stepping right beside left\n" +
    "3-4 Point left to side, step left beside right");
  const sp = spansOf(p);
  fcheck("monterey: point-side + turn-on-the-close tags",
    has(sp, "monterey", s => Math.abs(s.meta.deg) === 180), JSON.stringify(sp));
}
{
  const p = parseSnippet("1&2 Step right to side, step left beside right, cross right over left");
  const sp = FIG.applyStyling(p);
  fcheck("scissor: side, & together, cross tags", has(sp, "scissor"), JSON.stringify(sp));
  const cr = p.events.find(e => e.beat === 1);
  fcheck("scissor: accent cross lands snug with 25deg turnout",
    cr && Math.abs(cr.dx) === 0.3 && cr.dy === 0.4 && cr.turnout === 25, JSON.stringify(cr));
}
{
  const p = parseSnippet("1-4 Touch right forward, step right back, touch left back, step left forward");
  const sp = FIG.applyStyling(p);
  fcheck("charleston: fore-aft pendulum tags", has(sp, "charleston"), JSON.stringify(sp));
  const tf = p.events.find(e => e.beat === 0);
  fcheck("charleston: strikes reach 1.1u fore/aft, net zero travel",
    tf.dy === 1.1 && p.events.find(e => e.beat === 2).dy === -1.1, JSON.stringify(tf));
}
{
  const p = parseSnippet("1&2 Step right to side, step left beside right, step right to side\n3-4 Rock left back, recover on right");
  const sp = spansOf(p);
  fcheck("lindy: side chasse + back rock tags", has(sp, "lindy"), JSON.stringify(sp));
}
{
  const p = parseSnippet("1&2 Kick right forward, step right beside left, step left in place");
  const sp = spansOf(p);
  fcheck("kick-ball-change: kick + & ball dab + weight change tags",
    has(sp, "kick_ball_change", s => s.meta.full), JSON.stringify(sp));
}
{
  const p = parseSnippet(
    "1-2 Step right to right side, step left to left side\n" +
    "3-6 Bump hips left, bump hips right, bump hips left, bump hips right");
  const sp = FIG.applyStyling(p);
  fcheck("wide-stance bumps (flex): planted wide stance tag",
    has(sp, "hip_bumps", s => s.meta.stance === "wide"), JSON.stringify(sp));
  const sideL = p.events.find(e => e.beat === 1);
  fcheck("wide-stance bumps: feet plant 1.5-2u apart, toes out",
    Math.abs(sideL.dx) >= 1.5 && Math.abs(sideL.aOff || 0) >= 10, JSON.stringify(sideL));
}
{
  const p = parseSnippet("1-3 Step right forward, lock left behind right, step right forward");
  const sp = spansOf(p);
  fcheck("lock step: fwd-lock-fwd tags", has(sp, "lock_step"), JSON.stringify(sp));
}

// -- hard spacing rule unit checks ------------------------------------------
{
  const ev = { foot: "R", dx: 0.85, dy: 0 };
  const p = FIG.separateFeet({ x: 0, y: 0 }, { x: 0, y: 0 }, ev, 0);
  fcheck("separateFeet: identical centers get pushed apart",
    Math.hypot(p.x, p.y) >= 0.2, JSON.stringify(p));
  const q = FIG.separateFeet({ x: 0.1, y: 0 }, { x: 0, y: 0 }, ev, 0);
  fcheck("separateFeet: a too-tight close clamps to 0.25-0.5u daylight",
    q.x >= 0.81 - 1e-6 && q.x <= 1.06 + 1e-6 && Math.abs(q.y) >= 0.06,
    JSON.stringify(q));
  const cr = FIG.separateFeet({ x: -0.1, y: 0.1 }, { x: 0, y: 0 },
                              { foot: "R", dx: -0.3, dy: 0.35 }, 0);
  fcheck("separateFeet: crosses keep an honest fore-aft stagger",
    cr.y >= 0.45 - 1e-6 && Math.hypot(cr.x, cr.y) >= 0.5 - 1e-6, JSON.stringify(cr));
  const th = FIG.separateFeet({ x: 1.0, y: 1.05 }, { x: 1.0, y: 1.0 },
                              { foot: "L", dx: -0.85, dy: 0, lifted: true }, 90);
  fcheck("separateFeet: lifted touches never sit on the other boot",
    Math.hypot(th.x - 1.0, th.y - 1.0) >= 0.3, JSON.stringify(th));
}

// -- cue labels --------------------------------------------------------------
{
  const p = loadCorpus("electric-slide");
  FIG.applyStyling(p);
  fcheck("labelForSection: electric-slide S1 -> 'Vine R'",
    FIG.labelForSection(p, 0) === "Vine R", JSON.stringify(FIG.labelForSection(p, 0)));
  fcheck("labelForLine falls back to null when nothing is tagged",
    FIG.labelForLine(p, { b0: 8, b1: 8 }) === null ||
    typeof FIG.labelForLine(p, { b0: 8, b1: 8 }) === "string");
  const d = loadCorpus("drunken-sailor");
  fcheck("labelForSection: drunken-sailor S1 leads with heel splits",
    /Heel splits/.test(FIG.labelForSection(d, 0) || ""), JSON.stringify(FIG.labelForSection(d, 0)));
  const c = loadCorpus("canadian-stomp");
  fcheck("labelForSection: canadian-stomp jazz section -> 'Jazz box'",
    /Jazz box/.test(FIG.labelForSection(c, 4) || ""), JSON.stringify(FIG.labelForSection(c, 4)));
}

// -- motion templates ---------------------------------------------------------
// Every figure's `template` is the ONE canonical rendered form: declarative
// data (never code), agreeing with `canon` (single source of truth), applied
// uniformly at timeline build. The hard invariants: landings stay exactly on
// the beat, sheet turns/facing and travel direction are never changed (the
// template standardizes magnitudes and character, never choreography),
// deterministic, and the same figure renders identically in every dance.

// template shape: pure data, sane ranges, valid vocabulary
const SPEC_KEYS = ["dx", "dy", "ground", "turnAdd", "turnout", "aOffAdd", "motion", "accent"];
const MOTIONS = ["glide", "step"];
function specErr(spec, where) {
  if (typeof spec !== "object" || spec === null) return where + " not an object";
  for (const k of Object.keys(spec)) {
    if (!SPEC_KEYS.includes(k)) return where + " unknown key " + k;
    if (typeof spec[k] === "function") return where + "." + k + " is code, not data";
  }
  if (spec.dx !== undefined && !(Math.abs(spec.dx) <= 2.2)) return where + " dx out of range";
  if (spec.dy !== undefined && !(Math.abs(spec.dy) <= 1.5)) return where + " dy out of range";
  if (spec.ground !== undefined && !["give", "regain"].includes(spec.ground)) return where + " bad ground";
  if (spec.turnAdd !== undefined && (spec.turnAdd % 45 !== 0)) return where + " turnAdd not a 45° multiple";
  if (spec.turnout !== undefined && !(spec.turnout >= 0 && spec.turnout <= 45)) return where + " turnout out of range";
  if (spec.motion !== undefined) {
    const m = spec.motion;
    if (typeof m === "string") { if (!MOTIONS.includes(m)) return where + " bad motion " + m; }
    else for (const b of Object.keys(m)) {
      if (!["slow", "mid", "fast"].includes(b)) return where + " bad tempo band " + b;
      if (!MOTIONS.includes(m[b])) return where + " bad motion " + m[b];
    }
  }
  if (spec.accent !== undefined && spec.accent !== true) return where + " accent must be true";
  return null;
}
function blockErr(blk, where) {
  if (blk.rules) for (const [sym, spec] of Object.entries(blk.rules)) {
    const e = specErr(spec, where + ".rules." + sym); if (e) return e;
  }
  if (blk.seq) {
    if (!Array.isArray(blk.seq)) return where + ".seq not an array";
    for (let k = 0; k < blk.seq.length; k++) {
      if (blk.seq[k] === null) continue;
      const e = specErr(blk.seq[k], where + ".seq[" + k + "]"); if (e) return e;
    }
  }
  if (blk.pre) {
    if (!(blk.pre.lookback >= 1)) return where + ".pre bad lookback";
    for (const [sym, spec] of Object.entries(blk.pre.rules || {})) {
      const e = specErr(spec, where + ".pre.rules." + sym); if (e) return e;
    }
  }
  return null;
}
function templateErr(tpl) {
  if (typeof tpl !== "object" || tpl === null) return "missing template";
  if (!tpl.rules && !tpl.seq && !tpl.variants) return "template declares nothing";
  let e = blockErr(tpl, "template"); if (e) return e;
  for (const [name, v] of Object.entries(tpl.variants || {})) {
    if (typeof v.when !== "object" || v.when === null || !Object.keys(v.when).length)
      return "variant " + name + " lacks a when selector";
    e = blockErr(v, "variants." + name); if (e) return e;
  }
  return null;
}
for (const id of CATALOG_IDS) {
  const err = templateErr(FIG.FIGURES[id].template);
  fcheck(id + " template is well-formed declarative data", err === null, err);
}

// template geometry agrees with canon — the learn-the-steps demo (canon) and
// in-dance rendering (template) carry the same numbers
const SYM2ACT = {
  side: ["side"], crossB: ["cross_back"], crossF: ["cross_front"],
  touch: ["touch"], fwd: ["fwd", "fwd_diag"], back: ["back", "back_diag"],
  rockF: ["rock_fwd"], rockB: ["rock_back"], lockF: ["lock_front"],
  lockB: ["lock_back"], touchF: ["touch_fwd"], touchB: ["touch_back"],
  touchS: ["point_side"], close: ["close", "ball"], kick: ["kick"]
};
function nsOf(f) { return f === "R" ? 1 : -1; }
function canonMatches(canon, spec, acts) {
  return canon.some(c => {
    if (!c.foot || !acts.includes(c.action)) return false;
    const own = c.dx * nsOf(c.foot);
    if (spec.dx !== undefined && Math.abs(own - spec.dx) > 1e-6) return false;
    if (spec.dy !== undefined && Math.abs((c.dy || 0) - spec.dy) > 1e-6) return false;
    if (spec.aOffAdd !== undefined && Math.abs((c.aOff || 0) * nsOf(c.foot) - spec.aOffAdd) > 1e-6) return false;
    return true;
  });
}
for (const id of CATALOG_IDS) {
  const entry = FIG.FIGURES[id];
  const tpl = entry.template;
  const bad = [];
  // geometry-bearing blocks: the base template; if it declares nothing,
  // its variants carry the canonical form (kick-ball-change `full`,
  // mambo `mambo`); wide-stance pre rules count too (hip bumps)
  const blocks = (tpl.rules || tpl.seq) ? [tpl] : Object.values(tpl.variants || {});
  if (tpl.variants) for (const v of Object.values(tpl.variants)) {
    if (v.pre && !blocks.includes(v)) blocks.push(v);
  }
  for (const blk of blocks) {
    const ruleSets = [];
    if (blk.rules) ruleSets.push(blk.rules);
    if (blk.pre && blk.pre.rules) ruleSets.push(blk.pre.rules);
    for (const rules of ruleSets) {
      for (const [sym, spec] of Object.entries(rules)) {
        if (spec.dx === undefined && spec.dy === undefined && spec.aOffAdd === undefined) continue;
        const acts = SYM2ACT[sym];
        if (!acts) { bad.push(sym + ": no canon action mapping"); continue; }
        if (!canonMatches(entry.canon, spec, acts)) bad.push(sym + "=" + JSON.stringify(spec));
      }
    }
    // seq geometry compares positionally against the canon's first entries;
    // variant seqs that layer added turns (rolling vine) are a rendering of
    // the same travel in a rotating frame — canon carries the plain form
    if (blk.seq && !blk.seq.some(s => s && s.turnAdd)) {
      blk.seq.forEach((spec, k) => {
        if (!spec || (spec.dx === undefined && spec.dy === undefined)) return;
        const c = entry.canon[k];
        if (!c || !c.foot) { bad.push("seq[" + k + "]: no canon entry"); return; }
        const own = c.dx * nsOf(c.foot);
        if (spec.dx !== undefined && Math.abs(own - spec.dx) > 1e-6)
          bad.push("seq[" + k + "] dx " + spec.dx + " ≠ canon " + own);
        if (spec.dy !== undefined && Math.abs((c.dy || 0) - spec.dy) > 1e-6)
          bad.push("seq[" + k + "] dy " + spec.dy + " ≠ canon " + c.dy);
      });
    }
  }
  fcheck(id + " template geometry agrees with canon", bad.length === 0, bad.join("; "));
}

// application invariants over the WHOLE corpus: raw parse vs templated parse
function simEvents(events) {
  let theta = 0;
  const feet = { L: { x: -0.45, y: 0 }, R: { x: 0.45, y: 0 } };
  const after = [];
  for (const ev of events) {
    if (ev.turn) theta += ev.turn;
    if (ev.foot) {
      const o = ev.self ? feet[ev.foot] : feet[ev.foot === "R" ? "L" : "R"];
      const th = theta * Math.PI / 180;
      feet[ev.foot] = {
        x: o.x + (ev.dx || 0) * Math.cos(th) + (ev.dy || 0) * Math.sin(th),
        y: o.y - (ev.dx || 0) * Math.sin(th) + (ev.dy || 0) * Math.cos(th)
      };
    }
    after.push({ theta, L: { ...feet.L }, R: { ...feet.R } });
  }
  return after;
}
function spanNet(after, span) {
  const pre = span.idx[0] > 0 ? after[span.idx[0] - 1]
    : { theta: 0, L: { x: -0.45, y: 0 }, R: { x: 0.45, y: 0 } };
  const post = after[span.idx[span.idx.length - 1]];
  const wx = (post.L.x + post.R.x) / 2 - (pre.L.x + pre.R.x) / 2;
  const wy = (post.L.y + post.R.y) / 2 - (pre.L.y + pre.R.y) / 2;
  const th = pre.theta * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  return { dx: wx * c - wy * s, dy: wx * s + wy * c, turn: post.theta - pre.theta };
}
perFixture["templates"] = { pass: 0, fail: 0 };
const tcheck = (label, ok, detail) => check("templates", label, !!ok, detail);
const corpusFiles = fs.readdirSync(CORPUS).filter(f => f.endsWith(".txt")).sort();
for (const file of corpusFiles) {
  const name = file.replace(/\.txt$/, "");
  const raw = parseStepsheet(fs.readFileSync(path.join(CORPUS, file), "utf8"));
  const sty = parseStepsheet(fs.readFileSync(path.join(CORPUS, file), "utf8"));
  if (!raw.ok) continue;
  const spans = FIG.applyStyling(sty, { bpm: 96 });

  // 1. landings stay exactly on the beat; the KIND of every step survives
  let bad = [];
  if (raw.events.length !== sty.events.length) bad.push("event count changed");
  else raw.events.forEach((r, i) => {
    const s = sty.events[i];
    for (const k of ["beat", "foot", "lifted", "self", "badge", "noWeight", "weight", "clap"]) {
      if ((r[k] ?? null) !== (s[k] ?? null)) bad.push("ev" + i + "." + k + " " + r[k] + "→" + s[k]);
    }
  });
  tcheck(name + ": template keeps beats and step kinds exact", bad.length === 0, bad.slice(0, 3).join("; "));

  // 2+3. per-span: facing preserved mod 360; travel direction preserved,
  // magnitude standardized within bounds (vines get the tight endpoint bound)
  const rafter = simEvents(raw.events), safter = simEvents(sty.events);
  bad = [];
  const badV = [];
  for (const sp of spans) {
    const rn = spanNet(rafter, sp), sn = spanNet(safter, sp);
    const dTurn = ((Math.round(sn.turn - rn.turn) % 360) + 360) % 360;
    if (dTurn !== 0) bad.push(sp.figureId + "@" + sp.startBeat + " turn " + rn.turn + "→" + sn.turn);
    const rm = Math.hypot(rn.dx, rn.dy), sm = Math.hypot(sn.dx, sn.dy);
    if (rm >= 0.7 && sm >= 0.7) {
      const cos = (rn.dx * sn.dx + rn.dy * sn.dy) / (rm * sm);
      if (cos < 0.8) badV.push(sp.figureId + "@" + sp.startBeat + " direction cos " + cos.toFixed(2));
    }
    if (sm > rm + 1.5) badV.push(sp.figureId + "@" + sp.startBeat + " invented travel " + rm.toFixed(2) + "→" + sm.toFixed(2));
    if (sp.figureId === "vine" &&
        (Math.abs(sn.dx - rn.dx) > 0.45 || Math.abs(sn.dy - rn.dy) > 0.45))
      badV.push("vine@" + sp.startBeat + " endpoint moved " + JSON.stringify(rn) + "→" + JSON.stringify(sn));
  }
  tcheck(name + ": templated spans preserve net facing (mod 360)", bad.length === 0, bad.join("; "));
  tcheck(name + ": travel direction preserved; vines end on the sheet's endpoint",
    badV.length === 0, badV.join("; "));

  // 4. non-figure sections untouched (pre-normalized stance windows excepted)
  const touched = new Set();
  for (const sp of spans) {
    for (const i of sp.idx) touched.add(i);
    if (sp.figureId === "hip_bumps")
      for (let i = sp.idx[0] - 3; i < sp.idx[0]; i++) touched.add(i);
  }
  bad = [];
  raw.events.forEach((r, i) => {
    if (touched.has(i)) return;
    const s = sty.events[i];
    for (const k of ["dx", "dy", "turn", "aOff", "glide", "accent", "turnout"]) {
      if ((r[k] ?? null) !== (s[k] ?? null)) bad.push("ev" + i + "@" + r.beat + "." + k);
    }
  });
  tcheck(name + ": non-figure events are untouched", bad.length === 0, bad.slice(0, 4).join("; "));
}

// deterministic: two independent applications agree event-for-event; a
// second application on the same object is a no-op (idempotence guard)
{
  const a = parseStepsheet(fs.readFileSync(path.join(CORPUS, "canadian-stomp.txt"), "utf8"));
  const b = parseStepsheet(fs.readFileSync(path.join(CORPUS, "canadian-stomp.txt"), "utf8"));
  FIG.applyStyling(a, { bpm: 96 });
  FIG.applyStyling(b, { bpm: 96 });
  fcheck("templates are deterministic (two runs, identical events)",
    JSON.stringify(a.events) === JSON.stringify(b.events));
  const snap = JSON.stringify(a.events);
  FIG.applyStyling(a, { bpm: 96 });
  fcheck("re-applying styling is a no-op", JSON.stringify(a.events) === snap);
}

// THE consistency claim: the same figure renders with IDENTICAL relative
// geometry in every dance. Signature = per-step (own-natural dx, dy,
// turnout) after normalization.
function sig(ev) {
  const ns = ev.foot ? nsOf(ev.foot) : 1;
  return [Math.round((ev.dx ?? 0) * ns * 1e6) / 1e6, Math.round((ev.dy ?? 0) * 1e6) / 1e6,
          ev.turnout ?? null];
}
function figureSigs(slugs, figureId, pred) {
  const out = [];
  for (const slug of slugs) {
    const p = loadCorpus(slug);
    const spans = FIG.applyStyling(p, { bpm: 96 });
    for (const sp of spans) {
      if (sp.figureId !== figureId || (pred && !pred(sp))) continue;
      out.push({ slug, at: sp.startBeat, sig: sp.idx.map(i => sig(p.events[i])) });
    }
  }
  return out;
}
{
  // jazz boxes from four different dances, one canonical box
  const boxes = figureSigs(["canadian-stomp", "black-velvet", "blue-night-cha", "sambas-and-sailors"], "jazz_box");
  fcheck("jazz boxes found across 4 dances", boxes.length >= 5, "got " + boxes.length);
  const ref = JSON.stringify(boxes[0].sig);
  fcheck("every corpus jazz box normalizes to IDENTICAL relative geometry",
    boxes.every(b => JSON.stringify(b.sig) === ref),
    boxes.map(b => b.slug + "@" + b.at + " " + JSON.stringify(b.sig)).join(" | "));
  const want = FIG.FIGURES.jazz_box.template.seq.map(s => [s.dx, s.dy, s.turnout ?? null]);
  fcheck("jazz box geometry IS the template's canonical form",
    ref === JSON.stringify(want), ref + " vs " + JSON.stringify(want));
}
{
  // plain vines from six dances: every side reach and every behind-cross
  // identical, dance to dance
  const vines = figureSigs(
    ["electric-slide", "canadian-stomp", "cowboy-boogie", "mamma-maria", "watermelon-crawl", "cha-cha-cha"],
    "vine", sp => !sp.meta.rolling);
  fcheck("plain vines found across 6 dances", vines.length >= 8, "got " + vines.length);
  let sides = 0, crosses = 0; const bad = [];
  for (const slug of ["electric-slide", "canadian-stomp", "cowboy-boogie", "mamma-maria", "watermelon-crawl", "cha-cha-cha"]) {
    const p = loadCorpus(slug);
    const spans = FIG.applyStyling(p, { bpm: 96 });
    for (const sp of spans) {
      if (sp.figureId !== "vine" || sp.meta.rolling) continue;
      for (const i of sp.idx) {
        const ev = p.events[i];
        const sym = FIG.classify(ev);
        if (sym === "side") {
          sides++;
          if (Math.abs(Math.abs(ev.dx) - 1.7) > 1e-9 || ev.glide !== true)
            bad.push(slug + "@" + ev.beat + " side " + JSON.stringify([ev.dx, ev.glide]));
        } else if (sym === "crossB") {
          crosses++;
          if (Math.abs(Math.abs(ev.dx) - 0.2) > 1e-9 || Math.abs(ev.dy - -0.6) > 1e-9)
            bad.push(slug + "@" + ev.beat + " cross " + JSON.stringify([ev.dx, ev.dy]));
        }
      }
    }
  }
  fcheck("every vine side reach in 6 dances is the one canonical 1.7u glide",
    sides >= 16 && bad.filter(b => / side /.test(b)).length === 0, bad.join("; ") || ("sides=" + sides));
  fcheck("every vine behind-cross in 6 dances is the one canonical loose stagger",
    crosses >= 8 && bad.filter(b => / cross /.test(b)).length === 0, bad.join("; ") || ("crosses=" + crosses));
}
{
  // two differently-worded synthetic sheets -> the same box as the corpus
  const s1 = parseSnippet("1-4 Cross right over left, step left back, step right to right side, step left beside right");
  const s2 = parseSnippet("1-4 Step right across left, left steps back, right to side, close left next to right");
  const sp1 = FIG.applyStyling(s1, { bpm: 96 }), sp2 = FIG.applyStyling(s2, { bpm: 96 });
  const b1 = sp1.find(s => s.figureId === "jazz_box"), b2 = sp2.find(s => s.figureId === "jazz_box");
  fcheck("differently-worded jazz boxes both tag", !!b1 && !!b2,
    JSON.stringify([sp1.map(s => s.figureId), sp2.map(s => s.figureId)]));
  if (b1 && b2) {
    const g1 = b1.idx.map(i => sig(s1.events[i])), g2 = b2.idx.map(i => sig(s2.events[i]));
    fcheck("differently-worded jazz boxes normalize to identical geometry",
      JSON.stringify(g1) === JSON.stringify(g2), JSON.stringify(g1) + " vs " + JSON.stringify(g2));
  } else fcheck("differently-worded jazz boxes normalize to identical geometry", false, "not tagged");
}

// context modulation: tempo bands change motion character, never geometry
{
  const slow = parseStepsheet(fs.readFileSync(path.join(CORPUS, "electric-slide.txt"), "utf8"));
  const fast = parseStepsheet(fs.readFileSync(path.join(CORPUS, "electric-slide.txt"), "utf8"));
  FIG.applyStyling(slow, { bpm: 70 });
  FIG.applyStyling(fast, { bpm: 130 });
  const sSlow = slow.events.find(e => e.beat === 0), sFast = fast.events.find(e => e.beat === 0);
  fcheck("slow tempo: vine side steps glide", sSlow.glide === true, JSON.stringify(sSlow));
  fcheck("fast tempo: vine side steps sharpen (no glide)", sFast.glide === undefined,
    JSON.stringify(sFast));
  fcheck("tempo changes character, never geometry",
    sSlow.dx === sFast.dx && sSlow.dy === sFast.dy, JSON.stringify([sSlow, sFast]));
  const roll = parseStepsheet(fs.readFileSync(path.join(CORPUS, "picnic-polka.txt"), "utf8"));
  FIG.applyStyling(roll, { bpm: 130 });
  const r1 = roll.events.find(e => e.beat === 16);
  fcheck("rolling vines glide at any tempo (a spiral cannot stomp)",
    r1.glide === true && r1.turn === 90, JSON.stringify(r1));
}

// accents: templates mark where a figure pops; back-to-back repeats of the
// same figure pop once, at the true end
{
  const p = loadCorpus("canadian-stomp");
  FIG.applyStyling(p, { bpm: 96 });
  const box1 = p.events.find(e => e.beat === 32), box2 = p.events.find(e => e.beat === 36);
  fcheck("chained jazz boxes: first box yields its accent", box1.accent === undefined,
    JSON.stringify(box1));
  fcheck("chained jazz boxes: the final box keeps the accent cross", box2.accent === true,
    JSON.stringify(box2));
  const q = parseSnippet(
    "1-4 Step right to side, cross left behind right, step right to side, touch left beside right\n" +
    "5-8 Step left to side, cross right behind left, step left to side, touch right beside left");
  FIG.applyStyling(q, { bpm: 96 });
  const t1 = q.events.find(e => e.beat === 3), t2 = q.events.find(e => e.beat === 7);
  fcheck("vine R straight into vine L pops once, on the last touch",
    t1.accent === undefined && t2.accent === true, JSON.stringify([t1, t2]));
}

// --- scorecard -------------------------------------------------------------
console.log("");
for (const [name, s] of Object.entries(perFixture)) {
  const total = s.pass + s.fail;
  console.log((s.fail ? "✗" : "✓") + " " + name.padEnd(20) + s.pass + "/" + total);
}
console.log("-".repeat(32));
console.log((fail ? "FAIL  " : "PASS  ") + pass + "/" + (pass + fail) + " checks");
for (const f of failures) console.log("   " + f);

// history + delta vs last run
let prev = null;
if (fs.existsSync(HISTORY)) {
  const lines = fs.readFileSync(HISTORY, "utf8").trim().split("\n");
  if (lines.length && lines[lines.length - 1]) prev = JSON.parse(lines[lines.length - 1]);
}
const entry = { when: new Date().toISOString(), pass, fail, total: pass + fail };
fs.appendFileSync(HISTORY, JSON.stringify(entry) + "\n");
if (prev) {
  const d = pass - prev.pass, dt = (pass + fail) - prev.total;
  console.log("vs last run: " + (d >= 0 ? "+" : "") + d + " passing" +
              (dt ? " (" + (dt > 0 ? "+" : "") + dt + " checks)" : ""));
  if (d < 0 && dt >= 0) console.log("⚠ REGRESSION — fewer checks pass than last run");
}
process.exit(fail ? 1 : 0);
