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
