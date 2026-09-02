// Deterministic 60fps sim harness for perspective tuning (rounds 1-2).
// Load in the app page's devtools (or via javascript injection):
//   const s = document.createElement('script'); s.src='/tuning/simharness.js';
//   document.head.appendChild(s);
// Then:
//   __sim(fromBeat, beats, warm=4)  -> {stats, analysis}; also fills __lastTrace
//   __ab(view3dOverrides, [[from,beats],...]) -> compact per-segment results
//   __loadPivotSheet()              -> loads a pivot-heavy 16-count test dance
//
// The harness patches performance.now so render() sees a fixed 60fps clock,
// making numbers reproducible and immune to background-tab rAF throttling.
// Real-playback stats are never comparable to sim stats.

window.__angDiff = (a, b) => {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

window.__sim = function (fromBeat, beats, warm = 4) {
  const origNow = performance.now;
  let fake = origNow.call(performance);
  performance.now = () => fake;
  try {
    state.playing = false;
    lastFrameMs = null;
    seek(fromBeat - warm);
    lastFrameMs = null;
    const bps = state.bpm / 60, stepB = bps / 60;
    const totalF = Math.round((warm + beats) / stepB);
    const warmF = Math.round(warm / stepB);
    __viewStats.reset();
    const trace = [];
    for (let i = 0; i < totalF; i++) {
      fake += 1000 / 60;
      state.t = fromBeat - warm + (i + 1) * stepB;
      render();
      if (i === warmF - 1) __viewStats.reset();
      if (i >= warmF) trace.push({ t: state.t, th: thetaAt(state.t), vt: state.viewTheta, az: state.azim });
    }
    window.__lastTrace = trace;
    return { stats: __viewStats.read(), analysis: __analyze(trace) };
  } finally {
    performance.now = origNow;
  }
};

// Per-turn metrics from a trace: for each facing change > 15 deg, the max
// view lag (how much boot rotation shows on screen), the peak pan rate, and
// how many beats from turn start until the view settles within 5 deg.
window.__analyze = function (trace) {
  let maxFR = 0, sumFR = 0, maxErr = 0, n = 0;
  const turns = []; let cur = null;
  for (let i = 1; i < trace.length; i++) {
    const dt = 1 / 60;
    let dvt = trace[i].vt - trace[i - 1].vt; dvt -= 360 * Math.round(dvt / 360);
    const fr = Math.abs(dvt) / dt;
    maxFR = Math.max(maxFR, fr); sumFR += fr; n++;
    let e = trace[i].th - trace[i].vt; e -= 360 * Math.round(e / 360);
    const err = Math.abs(e);
    maxErr = Math.max(maxErr, err);
    const thMoving = Math.abs(trace[i].th - trace[i - 1].th) > 0.02;
    if (thMoving) {
      if (!cur || trace[i].t - cur.lastMove > 0.6) {
        cur = { start: trace[i].t, th0: trace[i - 1].th, lastMove: trace[i].t, maxErr: 0, peakFR: 0, settled: null };
        turns.push(cur);
      }
      cur.lastMove = trace[i].t; cur.th1 = trace[i].th; cur.settled = null;
    }
    if (cur) {
      cur.maxErr = Math.max(cur.maxErr, err);
      cur.peakFR = Math.max(cur.peakFR, fr);
      if (!thMoving && cur.settled === null && err < 5) cur.settled = trace[i].t;
    }
  }
  return {
    maxFollowRate: +maxFR.toFixed(1), avgFollowRate: +(sumFR / n).toFixed(1), maxErr: +maxErr.toFixed(1),
    turns: turns.filter(u => Math.abs(u.th1 - u.th0) > 15).map(u => ({
      startBeat: +u.start.toFixed(2), deltaDeg: +(u.th1 - u.th0).toFixed(0),
      maxErr: +u.maxErr.toFixed(1), peakRate: +u.peakFR.toFixed(1),
      catchupBeats: u.settled === null ? 'unsettled' : +(u.settled - u.start).toFixed(2)
    }))
  };
};

window.__ab = function (overrides, segs) {
  const saved = { ...VIEW3D };
  Object.assign(VIEW3D, overrides);
  const out = segs.map(([f, b]) => {
    const r = __sim(f, b);
    return { seg: f, maxRot: r.stats.maxRotRate, maxFollow: r.stats.maxFollowRate,
             maxLag: r.stats.maxLagDeg, turns: r.analysis.turns };
  });
  Object.assign(VIEW3D, saved);
  return out;
};

// Turn-torture sheet: full pivot (two same-direction halves 2 beats apart),
// lone halves both directions, and a quarter — 16 counts, 4 walls.
window.__pivotSheet = `Pivot Test
Count: 16  Wall: 2  Level: Improver

SECTION 1: PIVOT FULL TURN, WALKS
1 2 Step forward right, pivot 1/2 turn left
3 4 Step forward right, pivot 1/2 turn left
5 6 Walk forward right, walk forward left
7 8 Step forward right, pivot 1/2 turn left

SECTION 2: SHUFFLE, PIVOT HALF, SHUFFLE, QUARTER
1&2 Shuffle forward right, left, right
3 4 Step forward left, pivot 1/2 turn right
5&6 Shuffle forward left, right, left
7 8 Step forward right, make 1/4 turn left (9:00)`;

window.__loadPivotSheet = function () {
  document.getElementById('sheet-input').value = window.__pivotSheet;
  document.getElementById('btn-load').click();
  return { walls: dance.walls, wallBeats: WALL_BEATS, total: TOTAL_BEATS };
};

// --- corpus tools (camera style round) -------------------------------------
// Load any tuning/corpus sheet through the app's own paste panel, and sweep
// the whole corpus through __sim for aggregate camera stats. Sims pin the bpm
// (async music lookups make it racy) and use wall 2 when one exists so the
// warmup never crosses the loop seam.
window.__loadSheetText = function (text) {
  document.getElementById('sheet-input').value = text;
  document.getElementById('btn-load').click();
  return { walls: dance.walls, wallBeats: WALL_BEATS, total: TOTAL_BEATS };
};

window.__loadCorpusSheet = async function (slug) {
  const text = await (await fetch('/tuning/corpus/' + slug + '.txt')).text();
  return window.__loadSheetText(text);
};

window.__simCorpus = async function (slugs, opts = {}) {
  if (!slugs) {
    const idx = await (await fetch('/tuning/corpus/INDEX.md')).text();
    slugs = [...idx.matchAll(/^\| \[([\w-]+)\]/gm)].map(m => m[1]);
  }
  const out = {};
  for (const slug of slugs) {
    try {
      const meta = await window.__loadCorpusSheet(slug);
      state.bpm = opts.bpm || 100;
      const wall = meta.walls > 1 ? 1 : 0;
      const r = window.__sim(wall * meta.wallBeats, meta.wallBeats,
                             Math.min(4, meta.wallBeats / 2));
      const unsettled = r.analysis.turns.filter(u => u.catchupBeats === 'unsettled').length;
      out[slug] = {
        wallBeats: meta.wallBeats, walls: meta.walls,
        maxRot: r.stats.maxRotRate, avgRot: r.stats.avgRotRate,
        maxCam: r.stats.maxCamSpeed, avgCam: r.stats.avgCamSpeed,
        maxFollow: r.stats.maxFollowRate, maxLag: r.stats.maxLagDeg,
        turns: r.analysis.turns.length, unsettled
      };
    } catch (e) {
      out[slug] = { error: String(e) };
    }
  }
  const ok = Object.values(out).filter(r => !r.error);
  out._agg = {
    sheets: ok.length,
    worstMaxRot: +Math.max(...ok.map(r => r.maxRot)).toFixed(1),
    worstMaxCam: +Math.max(...ok.map(r => r.maxCam)).toFixed(2),
    worstMaxLag: +Math.max(...ok.map(r => r.maxLag)).toFixed(1),
    unsettledTurns: ok.reduce((s, r) => s + r.unsettled, 0)
  };
  return out;
};
