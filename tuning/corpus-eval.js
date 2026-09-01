#!/usr/bin/env node
"use strict";
/*
 * Batch evaluation of the parser + movement inference over the real-stepsheet
 * corpus in tuning/corpus/. Zero dependencies.
 *
 *   node tuning/corpus-eval.js             scorecards + aggregate -> stdout,
 *                                          writes tuning/corpus-report.md
 *   node tuning/corpus-eval.js --json      machine-readable results
 *   node tuning/corpus-eval.js --phrases   every unrecognized/guessed phrase,
 *                                          most frequent first (the fix queue)
 *   node tuning/corpus-eval.js --sheet S   verbose single-sheet breakdown
 *
 * Camera metrics come from the browser sim (tuning/simharness.js
 * __simCorpus()); paste its JSON into tuning/corpus-camera.json and this
 * script folds the numbers into the report.
 *
 * Movement model: a faithful Node replica of buildTimeline()'s keyframe pass
 * in index.html (positions only — motion profiles and easing don't matter for
 * plausibility checks). If buildTimeline changes shape, update REPLICA below.
 */

const fs = require("fs");
const path = require("path");
const { parseStepsheet, other } = require("../parser.js");

const CORPUS = path.join(__dirname, "corpus");
const REPORT = path.join(__dirname, "corpus-report.md");
const CAMERA = path.join(__dirname, "corpus-camera.json");

// --- REPLICA of buildTimeline()'s keyframe geometry (index.html) -----------
function buildKeyframes(dance) {
  const kf = { L: [], R: [] };
  let theta = 0;
  const feet = { L: { x: -0.45, y: 0, a: 0 }, R: { x: 0.45, y: 0, a: 0 } };
  kf.L.push({ t: -1, ...feet.L, lifted: false });
  kf.R.push({ t: -1, ...feet.R, lifted: false });
  const WALL = dance.wallBeats;
  for (let wall = 0; wall < dance.walls; wall++) {
    for (const ev of dance.events) {
      const t = wall * WALL + ev.beat;
      let turn = ev.turn || 0;
      if (ev === dance.events[0] && wall > 0) turn += dance.wallTurn;
      if (turn) {
        theta += turn;
        for (const f of ["L", "R"]) {
          if (f === ev.foot) continue;
          feet[f] = { ...feet[f], a: theta };
          kf[f].push({ t, ...feet[f], lifted: kf[f][kf[f].length - 1].lifted });
        }
      }
      if (ev.foot) {
        const cur = feet[ev.foot];
        const o = ev.self ? cur : feet[other(ev.foot)];
        const th = theta * Math.PI / 180;
        const x = o.x + ev.dx * Math.cos(th) + ev.dy * Math.sin(th);
        const y = o.y - ev.dx * Math.sin(th) + ev.dy * Math.cos(th);
        feet[ev.foot] = { x, y, a: theta + (ev.aOff || 0) };
        kf[ev.foot].push({ t, ...feet[ev.foot], lifted: !!ev.lifted, txt: ev.txt });
      }
    }
  }
  return { kf, endTheta: theta };
}

function classifyWarnings(warnings) {
  const c = { skipped: [], guessed: [], beatMismatch: [], meta: [], other: [] };
  for (const w of warnings) {
    if (w.startsWith("Skipped unrecognized")) c.skipped.push(w);
    else if (w.startsWith("Guessed")) c.guessed.push(w);
    else if (/have \d+ beats but/.test(w)) c.beatMismatch.push(w);
    else if (/^Sheet says/.test(w)) c.meta.push(w);
    else c.other.push(w);
  }
  return c;
}

function evalSheet(name, text) {
  const parsed = parseStepsheet(text);
  const r = { name, ok: parsed.ok };
  r.warn = classifyWarnings(parsed.warnings);
  r.warnTotal = parsed.warnings.length;
  if (!parsed.ok) return r;

  r.wallBeats = parsed.wallBeats;
  r.walls = parsed.walls;
  r.declared = { count: parsed.meta.count, walls: parsed.meta.walls };

  // coverage: whole counts 0..wallBeats-1 that got at least one event
  const hit = new Set(parsed.events.map(e => Math.floor(e.beat)));
  r.coverage = +(hit.size / parsed.wallBeats).toFixed(2);

  // movement plausibility over the full loop
  const { kf } = buildKeyframes(parsed);
  const merged = [];
  const pos = { L: { ...kf.L[0] }, R: { ...kf.R[0] } };
  const all = [...kf.L.map(k => ({ f: "L", k })), ...kf.R.map(k => ({ f: "R", k }))]
    .sort((a, b) => a.k.t - b.k.t);
  let maxApart = 0, apartSamples = 0, overlapSamples = 0, samples = 0;
  let worstApart = null, worstOverlap = null;
  for (const { f, k } of all) {
    pos[f] = k;
    const d = Math.hypot(pos.L.x - pos.R.x, pos.L.y - pos.R.y);
    samples++;
    if (d > maxApart) { maxApart = d; }
    if (d > 2.6) { apartSamples++; if (!worstApart || d > worstApart.d) worstApart = { t: +k.t.toFixed(2), d: +d.toFixed(2), txt: k.txt }; }
    if (d < 0.18 && !pos.L.lifted && !pos.R.lifted) {
      overlapSamples++;
      if (!worstOverlap) worstOverlap = { t: +k.t.toFixed(2), d: +d.toFixed(2), txt: k.txt };
    }
    merged.push({ t: k.t, mx: (pos.L.x + pos.R.x) / 2, my: (pos.L.y + pos.R.y) / 2 });
  }
  r.maxApart = +maxApart.toFixed(2);
  r.apartPct = +(100 * apartSamples / samples).toFixed(1);
  r.overlapPct = +(100 * overlapSamples / samples).toFixed(1);
  if (worstApart) r.worstApart = worstApart;
  if (worstOverlap) r.worstOverlap = worstOverlap;

  // travel: per-wall net displacement of the dancer mid + max excursion
  const WALL = parsed.wallBeats;
  const wallNet = [];
  for (let w = 0; w < parsed.walls; w++) {
    const inWall = merged.filter(m => m.t >= w * WALL - 1e-6 && m.t < (w + 1) * WALL);
    if (!inWall.length) continue;
    const a = inWall[0], b = inWall[inWall.length - 1];
    wallNet.push(Math.hypot(b.mx - a.mx, b.my - a.my));
  }
  r.netPerWall = +(wallNet.reduce((s, v) => s + v, 0) / (wallNet.length || 1)).toFixed(2);
  r.maxExcursion = +Math.max(...merged.map(m => Math.hypot(m.mx, m.my))).toFixed(2);

  // turn density: deg of turn per 8 counts
  const turnDeg = parsed.events.reduce((s, e) => s + Math.abs(e.turn || 0), 0);
  r.turnPer8 = +(turnDeg / parsed.wallBeats * 8).toFixed(0);
  return r;
}

// --- run -------------------------------------------------------------------
const files = fs.readdirSync(CORPUS).filter(f => f.endsWith(".txt")).sort();
const results = files.map(f =>
  evalSheet(f.replace(/\.txt$/, ""), fs.readFileSync(path.join(CORPUS, f), "utf8")));

let camera = {};
if (fs.existsSync(CAMERA)) {
  try { camera = JSON.parse(fs.readFileSync(CAMERA, "utf8")); } catch (e) { /* stale */ }
}

const args = process.argv.slice(2);
if (args.includes("--json")) {
  console.log(JSON.stringify(results, null, 1));
  process.exit(0);
}
if (args.includes("--phrases")) {
  const freq = new Map();
  for (const r of results) {
    for (const w of [...r.warn.skipped, ...r.warn.guessed]) {
      const m = w.match(/"(.*)"/);
      const key = (m ? m[1] : w).toLowerCase();
      if (!freq.has(key)) freq.set(key, { n: 0, sheets: new Set(), kind: w.startsWith("Guessed") ? "guess" : "skip" });
      const e = freq.get(key); e.n++; e.sheets.add(r.name);
    }
  }
  for (const [k, v] of [...freq].sort((a, b) => b[1].n - a[1].n)) {
    console.log(String(v.n).padStart(3), v.kind.padEnd(5), k, " [" + [...v.sheets].join(",") + "]");
  }
  process.exit(0);
}
const sheetArg = args.indexOf("--sheet");
if (sheetArg !== -1) {
  const r = results.find(x => x.name === args[sheetArg + 1]);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
}

// --- report ----------------------------------------------------------------
const agg = {
  sheets: results.length,
  parsedOk: results.filter(r => r.ok).length,
  warnings: results.reduce((s, r) => s + r.warnTotal, 0),
  skipped: results.reduce((s, r) => s + r.warn.skipped.length, 0),
  guessed: results.reduce((s, r) => s + r.warn.guessed.length, 0),
  beatMismatch: results.reduce((s, r) => s + r.warn.beatMismatch.length, 0),
  metaMismatch: results.reduce((s, r) => s + r.warn.meta.length, 0),
  avgCoverage: +(results.filter(r => r.ok).reduce((s, r) => s + r.coverage, 0) /
                 (results.filter(r => r.ok).length || 1)).toFixed(2),
  apartSheets: results.filter(r => r.ok && r.apartPct > 0).length,
  overlapSheets: results.filter(r => r.ok && r.overlapPct > 0).length,
  wallsWrong: results.filter(r => r.ok && r.declared.walls && r.walls !== r.declared.walls).length,
  countsWrong: results.filter(r => r.ok && r.declared.count && r.wallBeats !== r.declared.count).length,
};

const lines = [];
lines.push("# Corpus evaluation report");
lines.push("");
lines.push("Generated by `node tuning/corpus-eval.js` over `tuning/corpus/` " +
           "(camera columns from `tuning/corpus-camera.json`, produced by " +
           "`__simCorpus()` in tuning/simharness.js).");
lines.push("");
lines.push("## Aggregate");
lines.push("");
lines.push("| metric | value |");
lines.push("|---|---|");
lines.push(`| sheets parsed ok | ${agg.parsedOk}/${agg.sheets} |`);
lines.push(`| total warnings | ${agg.warnings} |`);
lines.push(`| unrecognized phrases (skipped) | ${agg.skipped} |`);
lines.push(`| guessed steps | ${agg.guessed} |`);
lines.push(`| beat/step count mismatches | ${agg.beatMismatch} |`);
lines.push(`| meta mismatches (walls/counts) | ${agg.metaMismatch} |`);
lines.push(`| avg beat coverage | ${agg.avgCoverage} |`);
lines.push(`| sheets with feet-apart outliers (>2.6u) | ${agg.apartSheets} |`);
lines.push(`| sheets with grounded-feet overlap (<0.18u) | ${agg.overlapSheets} |`);
lines.push(`| sheets where parsed walls ≠ declared | ${agg.wallsWrong} |`);
lines.push(`| sheets where parsed counts ≠ declared | ${agg.countsWrong} |`);
if (camera._agg) {
  for (const [k, v] of Object.entries(camera._agg)) lines.push(`| camera: ${k} | ${v} |`);
}
lines.push("");
lines.push("## Per-sheet scorecard");
lines.push("");
lines.push("| sheet | ok | warn (skip/guess/beat) | cov | walls | counts | maxApart | apart% | ovlp% | net/wall | turn°/8 |" +
           (Object.keys(camera).length > 1 ? " maxRot | maxCam | offCtr | inBox |" : ""));
lines.push("|---|---|---|---|---|---|---|---|---|---|---|" +
           (Object.keys(camera).length > 1 ? "---|---|---|---|" : ""));
for (const r of results) {
  if (!r.ok) { lines.push(`| ${r.name} | FAIL | ${r.warnTotal} | | | | | | | | |`); continue; }
  const wallsCell = r.declared.walls && r.walls !== r.declared.walls
    ? `**${r.walls}≠${r.declared.walls}**` : String(r.walls);
  const countCell = r.declared.count && r.wallBeats !== r.declared.count
    ? `**${r.wallBeats}≠${r.declared.count}**` : String(r.wallBeats);
  let row = `| ${r.name} | ok | ${r.warnTotal} (${r.warn.skipped.length}/${r.warn.guessed.length}/${r.warn.beatMismatch.length})` +
    ` | ${r.coverage} | ${wallsCell} | ${countCell} | ${r.maxApart} | ${r.apartPct} | ${r.overlapPct}` +
    ` | ${r.netPerWall} | ${r.turnPer8} |`;
  const cam = camera[r.name];
  if (Object.keys(camera).length > 1) {
    row += cam ? ` ${cam.maxRot} | ${cam.maxCam} | ${cam.offCtr} | ${cam.inBox ? "yes" : "**NO**"} |`
               : "  | | | |";
  }
  lines.push(row);
}
lines.push("");
lines.push("## Worst offenders");
lines.push("");
for (const r of results) {
  const bits = [];
  if (r.worstApart) bits.push(`feet ${r.worstApart.d}u apart at t=${r.worstApart.t} ("${r.worstApart.txt}")`);
  if (r.worstOverlap) bits.push(`grounded overlap ${r.worstOverlap.d}u at t=${r.worstOverlap.t} ("${r.worstOverlap.txt}")`);
  if (r.ok && r.coverage < 0.8) bits.push(`coverage only ${r.coverage}`);
  if (bits.length) lines.push(`- **${r.name}**: ` + bits.join("; "));
}
lines.push("");
lines.push("_Run `node tuning/corpus-eval.js --phrases` for the unrecognized-phrase fix queue._");
lines.push("");

fs.writeFileSync(REPORT, lines.join("\n"));
console.log(lines.slice(0, 60).join("\n"));
console.log("\n(full report written to " + path.relative(process.cwd(), REPORT) + ")");
