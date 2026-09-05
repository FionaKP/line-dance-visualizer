#!/usr/bin/env node
"use strict";
/*
 * Minimum-foot-separation sweep over the whole tuning corpus. Zero deps.
 *
 *   node tuning/spacing-sweep.js            per-sheet minima + PASS/FAIL
 *   node tuning/spacing-sweep.js --json     machine-readable
 *
 * Replicates buildTimeline()'s keyframe pass (figure styling + the
 * separateFeet hard rule included) AND footState()'s interpolation
 * (profiles, windows, lift arcs, and the mid-path collision skim) from
 * index.html, then samples every frame of every wall at 240 samples/8
 * counts and measures boot center distance.
 *
 * Gates (the "clamp distance" of the hard spacing rule):
 *   settled  — both feet settled and grounded:      dist >= SEP.cross (0.5)
 *   floor    — any frame with both boots low (<0.12 lift): dist >= 0.35
 * A frame where either boot is meaningfully lifted may pass close — the
 * boot is over, not through, the other one.
 *
 * If buildTimeline/footState change shape in index.html, update the
 * REPLICA blocks below (same contract as tuning/corpus-eval.js).
 */

const fs = require("fs");
const path = require("path");
const { parseStepsheet, other } = require("../parser.js");
const FIGURES = require("../figures.js");

const CORPUS = path.join(__dirname, "corpus");
const MOVE_WINDOW = 0.45;
const GATE_SETTLED = FIGURES.SEP.cross;  // 0.5
const GATE_FLOOR = 0.35;
const LOW_LIFT = 0.12;

// --- REPLICA: buildTimeline keyframes (index.html) -------------------------
function buildKeyframes(dance) {
  FIGURES.applyStyling(dance);
  const kf = { L: [], R: [] };
  let theta = 0;
  const feet = { L: { x: -0.45, y: 0, a: 0 }, R: { x: 0.45, y: 0, a: 0 } };
  kf.L.push({ t: -1, ...feet.L, lifted: false, pose: "flat" });
  kf.R.push({ t: -1, ...feet.R, lifted: false, pose: "flat" });
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
          const last = kf[f][kf[f].length - 1];
          kf[f].push({ t, ...feet[f], lifted: last.lifted, pose: last.pose, prof: "pivot" });
        }
      }
      if (ev.foot) {
        const cur = feet[ev.foot];
        const o = ev.self ? cur : feet[other(ev.foot)];
        const th = theta * Math.PI / 180;
        let x = o.x + ev.dx * Math.cos(th) + ev.dy * Math.sin(th);
        let y = o.y - ev.dx * Math.sin(th) + ev.dy * Math.cos(th);
        if (!ev.self) {
          const sep = FIGURES.separateFeet({ x, y }, feet[other(ev.foot)], ev, theta);
          x = sep.x; y = sep.y;
        }
        feet[ev.foot] = { x, y, a: theta + (ev.aOff || 0) };
        kf[ev.foot].push({ t, x, y, lifted: !!ev.lifted, pose: ev.pose || "flat",
                           badge: ev.badge || null, impact: !!ev.impact,
                           prof: stepProfile(ev, Math.hypot(x - cur.x, y - cur.y)) });
      }
    }
  }
  return kf;
}

// --- REPLICA: footState interpolation (index.html; groove off) -------------
function ease(s) { return s * s * (3 - 2 * s); }
function backOut(r, c) { const u = r - 1; return 1 + (c + 1) * u * u * u + c * u * u; }
const PROFILES = {
  step:  { arc: 0.3 },
  drag:  { win: 2,    arc: 0.1,  pos: r => ease(Math.max(0, (r - 0.15) / 0.85)) },
  glide: { win: 2,    arc: 0.1,  pos: r => 0.5 - 0.5 * Math.cos(Math.PI * r) },
  rock:  { arc: 0.45, pos: r => backOut(ease(r), 1.2) },
  kick:  { win: 0.9,  arc: 0.5, snapLift: 0.15, pos: r => 1 - Math.pow(1 - r, 3) },
  hook:  { win: 0.85, arc: 0.5, pos: r => 1 - Math.pow(1 - r, 2) },
  sweep: { win: 2.2,  arc: 0.2,  pos: r => 0.5 - 0.5 * Math.cos(Math.PI * r) },
  place: { win: 1.1,  arc: 0.6 },
  pivot: { arc: 0.08 },
  stomp: {}
};
function stepProfile(ev, dist) {
  if (ev.impact) return "stomp";
  if (ev.glide) return "glide";
  const b = ev.badge || "";
  if (b === "KICK" || b === "SCUFF") return "kick";
  if (b === "HOOK" || b === "KNEE") return "hook";
  if (b === "SWEEP") return "sweep";
  if (b === "SKATE") return "glide";
  if (ev.self) return "pivot";
  if (b === "TOUCH" || b === "POINT" || b === "HEEL" || b === "TOE") return "place";
  const txt = (ev.txt || "").toLowerCase();
  if (/\brock\b/.test(txt)) return "rock";
  if (/\b(drag|slide|glide)\b/.test(txt)) return "glide";
  if (!ev.lifted && dist < 0.75) return "drag";
  return "step";
}
function poseLift(k) {
  if (!k.lifted) return 0;
  if (k.badge === "SWEEP") return 0.15;
  if (k.badge === "KICK") return 0.35;
  return k.pose === "air" ? 1 : 0.4;
}
function findIdx(arr, t) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (arr[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}
function footState(kf, foot, t) {
  const arr = kf[foot];
  const i = findIdx(arr, t);
  const prev = arr[i];
  const next = arr[i + 1];
  const base = { x: prev.x, y: prev.y, lift: poseLift(prev), settled: true };
  if (!next) return base;
  const P = PROFILES[next.prof] || PROFILES.step;
  let winScale = P.win || 1;
  const arcAmp = P.arc === undefined ? 1 : P.arc;
  if (prev.lifted && (prev.pose === "toe" || prev.pose === "heel") &&
      !next.lifted && (next.prof === "step" || next.prof === "drag")) {
    winScale *= 0.55;
  }
  const win = Math.min(MOVE_WINDOW * winScale, (next.t - prev.t) * 0.9);
  const start = next.t - win;
  if (t < start) return base;
  const raw = Math.min(1, (t - start) / win);
  const s = ease(raw);
  const prevLift = poseLift(prev), nextLift = poseLift(next);
  if (next.impact) {
    const moveS = Math.min(1, s / 0.7);
    const lift = Math.sin(Math.PI * Math.min(1, raw / 0.8)) * 1.5;
    return { x: prev.x + (next.x - prev.x) * moveS, y: prev.y + (next.y - prev.y) * moveS,
             lift: Math.max(lift, prevLift + (nextLift - prevLift) * s), settled: s > 0.85 };
  }
  const sPos = P.pos ? P.pos(raw) : s;
  let x = prev.x + (next.x - prev.x) * sPos;
  let y = prev.y + (next.y - prev.y) * sPos;
  {
    // SWEEP bow (groove wobble omitted: deterministic, tiny)
    const dxT = next.x - prev.x, dyT = next.y - prev.y;
    const d = Math.hypot(dxT, dyT);
    if (next.badge === "SWEEP" && d > 0.05) {
      const bs = (foot === "R" ? 1 : -1) * 0.35 * d * Math.sin(Math.PI * raw);
      x += (-dyT / d) * bs;
      y += (dxT / d) * bs;
    }
  }
  let lift = Math.max(Math.sin(Math.PI * s) * arcAmp, prevLift + (nextLift - prevLift) * s);
  if (P.snapLift) lift += P.snapLift * Math.sin(Math.PI * Math.pow(raw, 0.6));
  {
    // mid-path collision skim
    const oArr = kf[foot === "L" ? "R" : "L"];
    const ok2 = oArr[findIdx(oArr, t)];
    const liftK = Math.max(0, 1 - Math.max(0, lift - 0.12) / 0.18);
    if (liftK > 0) {
      const minD = 0.55 * liftK * Math.sin(Math.PI * raw);
      const ddx = x - ok2.x, ddy = y - ok2.y;
      const d = Math.hypot(ddx, ddy);
      if (d > 1e-6 && d < minD) {
        const push = minD - d;
        x += ddx / d * push;
        y += ddy / d * push;
      }
    }
  }
  return { x, y, lift, settled: s > 0.85 };
}

// --- sweep -----------------------------------------------------------------
const files = fs.readdirSync(CORPUS).filter(f => f.endsWith(".txt")).sort();
const out = [];
for (const file of files) {
  const name = file.replace(/\.txt$/, "");
  const dance = parseStepsheet(fs.readFileSync(path.join(CORPUS, file), "utf8"));
  if (!dance.ok) { out.push({ name, error: "parse failed" }); continue; }
  const kf = buildKeyframes(dance);
  const total = dance.wallBeats * dance.walls;
  const dt = 8 / 240; // 240 frames per 8 counts
  let minSettled = Infinity, minFloor = Infinity, minKF = Infinity;
  let worstSettled = null, worstFloor = null;
  let violSettled = 0, violFloor = 0;
  for (let t = 0; t < total; t += dt) {
    const L = footState(kf, "L", t);
    const R = footState(kf, "R", t);
    const d = Math.hypot(L.x - R.x, L.y - R.y);
    if (L.settled && R.settled && L.lift < 1e-6 && R.lift < 1e-6) {
      if (d < minSettled) { minSettled = d; worstSettled = +t.toFixed(2); }
      if (d < GATE_SETTLED - 1e-6) violSettled++;
    }
    if (L.lift < LOW_LIFT && R.lift < LOW_LIFT) {
      if (d < minFloor) { minFloor = d; worstFloor = +t.toFixed(2); }
      if (d < GATE_FLOOR - 1e-6) violFloor++;
    }
  }
  // keyframe-coincidence check: no two boot keyframes may ever coincide
  const posAt = { L: kf.L[0], R: kf.R[0] };
  const all = [...kf.L.map(k => ({ f: "L", k })), ...kf.R.map(k => ({ f: "R", k }))]
    .sort((a, b) => a.k.t - b.k.t);
  for (const { f, k } of all) {
    posAt[f] = k;
    const d = Math.hypot(posAt.L.x - posAt.R.x, posAt.L.y - posAt.R.y);
    if (d < minKF) minKF = d;
  }
  out.push({
    name,
    minSettled: +minSettled.toFixed(3), atSettled: worstSettled,
    minFloor: +minFloor.toFixed(3), atFloor: worstFloor,
    minKF: +minKF.toFixed(3),
    violSettled, violFloor
  });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
}
let fails = 0;
console.log("sheet".padEnd(26) + "minSettled  minFloor  minKF   verdict");
for (const r of out) {
  if (r.error) { console.log(r.name.padEnd(26) + r.error); fails++; continue; }
  const bad = r.violSettled || r.violFloor;
  if (bad) fails++;
  console.log(r.name.padEnd(26) +
    String(r.minSettled).padEnd(12) + String(r.minFloor).padEnd(10) +
    String(r.minKF).padEnd(8) +
    (bad ? "FAIL (settled@" + r.atSettled + " x" + r.violSettled +
           ", floor@" + r.atFloor + " x" + r.violFloor + ")" : "ok"));
}
console.log("");
console.log((fails ? "FAIL " : "PASS ") + (out.length - fails) + "/" + out.length +
  " sheets keep boots apart (settled >= " + GATE_SETTLED + ", floor >= " + GATE_FLOOR + ")");
process.exit(fails ? 1 : 0);
