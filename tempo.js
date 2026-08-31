"use strict";
function gridFromWave(wave, sr) {
  const hopSec = 0.005;
  const hop = Math.round(sr * hopSec);
  const n = Math.floor(wave.length / hop);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * hop;
    for (let j = 0; j < hop; j++) s += wave[base + j] * wave[base + j];
    env[i] = Math.sqrt(s / hop);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, env[i]);
  if (!peak) throw new Error("silent audio");

  // where the music actually starts: sustained energy above the noise floor
  let startIdx = 0;
  const thr = peak * 0.08;
  for (let i = 0; i < n - 40; i++) {
    let ok = 0;
    for (let j = 0; j < 40; j++) if (env[i + j] > thr) ok++;
    if (ok > 25) { startIdx = i; break; }
  }

  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, env[i] - env[i - 1]);

  // tempo: autocorrelation of onset strength, 50 to 200 bpm
  const a0 = startIdx;
  const a1 = Math.min(n, startIdx + Math.round(150 / hopSec));
  const minLag = Math.round(60 / 200 / hopSec);
  const maxLag = Math.round(60 / 50 / hopSec);
  const score = new Float32Array(maxLag + 2);
  let bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0, c = 0;
    for (let i = a0; i + lag < a1; i++) { s += onset[i] * onset[i + lag]; c++; }
    score[lag] = c ? s / c : 0;
    if (score[lag] > score[bestLag]) bestLag = lag;
  }
  let lagF = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const y0 = score[bestLag - 1], y1 = score[bestLag], y2 = score[bestLag + 1];
    const d = y0 - 2 * y1 + y2;
    if (d < 0) lagF = bestLag + 0.5 * (y0 - y2) / d;
  }
  // sharpen the period using the 8-beat autocorrelation
  const target8 = lagF * 8;
  if (target8 * 2 < a1 - a0) {
    const lo = Math.round(target8 * 0.97), hi = Math.round(target8 * 1.03);
    let b8 = lo, s8best = -1;
    for (let lag = lo; lag <= hi; lag++) {
      let s = 0, c = 0;
      for (let i = a0; i + lag < a1; i += 2) { s += onset[i] * onset[i + lag]; c++; }
      s = c ? s / c : 0;
      if (s > s8best) { s8best = s; b8 = lag; }
    }
    lagF = b8 / 8;
  }
  let period = lagF * hopSec;
  let bpm = 60 / period;
  while (bpm > 145) { bpm /= 2; period *= 2; }
  while (bpm < 62) { bpm *= 2; period /= 2; }

  // beat phase: fold onset energy modulo the period
  const periodIdx = period / hopSec;
  const bins = Math.max(1, Math.round(periodIdx));
  const fold = new Float32Array(bins);
  const p1 = Math.min(n, startIdx + Math.round(40 / hopSec));
  for (let i = startIdx; i < p1; i++) {
    fold[Math.round((i - startIdx) % periodIdx) % bins] += onset[i];
  }
  let bestBin = 0;
  for (let b = 0; b < bins; b++) if (fold[b] > fold[bestBin]) bestBin = b;
  const firstBeat = (startIdx + bestBin) * hopSec;

  const result = {
    bpm: Math.round(bpm * 10) / 10,
    period,
    firstBeat: Math.round(firstBeat * 100) / 100,
    musicStart: Math.round(startIdx * hopSec * 100) / 100
  };
  result.beatAt = nb => result.firstBeat + nb * result.period;
  return result;
}

// Node test harness support; in the browser this is a plain global.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { gridFromWave };
}
