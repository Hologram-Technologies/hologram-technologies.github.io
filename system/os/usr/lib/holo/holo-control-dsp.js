// holo-control-dsp.js — the signal-processing core of Holo Control (the telemetry command center).
// Every governable edge (app · agent · resource · human · wallet) produces a time-series of activity;
// this module turns that raw stream into SIGNAL the operator should act on, with the noise pushed to
// the background. Pure + deterministic (no clock, no randomness, no DOM) so it runs identically in the
// browser and in a Node witness — the math is provable, not asserted.
//
// The principle: a healthy system is QUIET. We learn each edge's noise floor, measure how far above it
// the current activity sits (robust z-score), rank what deserves the operator's eyes by SALIENCE, and
// only promote a signal to an ALERT when it crosses a thresholds with hysteresis (so it can't flap).
// The dashboard's whole job is to raise the operator's effective signal-to-noise ratio.

// ── robust baseline (the NOISE FLOOR) ─────────────────────────────────────────────────────────────
// Median + MAD (median absolute deviation) instead of mean/stddev: a few loud spikes must NOT inflate
// the floor and hide the next spike. 1.4826·MAD ≈ σ for normal data (the standard robust-σ constant).
export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function mad(xs, med = median(xs)) {
  if (!xs.length) return 0;
  return median(xs.map((x) => Math.abs(x - med)));
}
export function robustSigma(xs, med = median(xs)) {
  const s = 1.4826 * mad(xs, med);
  return s > 1e-9 ? s : 1e-9;                       // guard a degenerate (all-equal) window
}
// the floor an edge is "ambient" at or below: median + k·σ over a trailing window.
export function noiseFloor(series, { k = 3 } = {}) {
  const med = median(series);
  return med + k * robustSigma(series, med);
}

// ── how far above the floor is NOW (the SIGNAL) ───────────────────────────────────────────────────
// robust z-score: (value − median) / robust-σ. >0 means above typical; ~0 ambient; large = anomaly.
export function zScore(value, series) {
  const med = median(series);
  return (value - med) / robustSigma(series, med);
}

// ── smoothing & change: low-pass (steady-state) and high-pass (what just changed) ─────────────────
export function ema(prev, value, alpha = 0.3) {            // exponential moving average — the calm view
  return prev == null ? value : prev + alpha * (value - prev);
}
export function smooth(series, alpha = 0.3) {
  let acc = null; return series.map((v) => (acc = ema(acc, v, alpha)));
}
export function delta(series) {                            // first difference — the change view (high-pass)
  return series.length < 2 ? 0 : series[series.length - 1] - series[series.length - 2];
}

// ── SALIENCE: what most deserves the operator's attention ─────────────────────────────────────────
// salience = magnitude × novelty × governance-risk, each in [0,1]. Magnitude is the squashed z (a
// bounded "how anomalous"); novelty weighs newly-seen edges/counterparties; risk weighs the direction
// that can hurt (egress, wallet outflow, an agent gaining write). Ranking by this puts the one thing
// worth looking at on top of every list — the operator never hunts.
export const squash = (z) => 1 - Math.exp(-Math.max(0, z) / 3);        // 0 at z≤0, →1 as z grows (z≈9→~0.95)
export function salience({ z = 0, novelty = 0, risk = 0.2 } = {}) {
  const magnitude = squash(z);
  const nov = 0.5 + 0.5 * clamp01(novelty);             // novelty lifts but never zeroes a real magnitude
  const rk = 0.4 + 0.6 * clamp01(risk);                 // risk amplifies; floors so low-risk still ranks
  return clamp01(magnitude * nov * rk);
}
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// per-edge governance risk weight — egress and value-outflow and authority-grants weigh heaviest.
export const RISK = { "wallet-out": 1.0, egress: 0.9, "agent-write": 0.8, "new-counterparty": 0.85,
  agent: 0.5, app: 0.3, ingress: 0.25, social: 0.4, "wallet-in": 0.3 };
export const riskOf = (kind) => RISK[kind] ?? 0.3;

// ── THRESHOLDING with HYSTERESIS: promote a signal to an alert without flapping ───────────────────
// enter the alert state at `hi`, leave it only when it falls back below `lo` (lo < hi). A bare
// threshold rings on every wobble around it; the hysteresis band makes an alert mean something.
export function hysteresis(prevActive, value, { hi = 0.66, lo = 0.4 } = {}) {
  if (prevActive) return value > lo;                    // stay alerting until we drop below the low gate
  return value >= hi;                                   // start alerting only once we cross the high gate
}

// classify an edge into the three calm-by-default tiers the UI renders (ambient → signal → alert).
export function classify(series, value, { kind = "app", novelty = 0, prevAlert = false, hi = 0.66, lo = 0.4 } = {}) {
  const z = zScore(value, series);
  const sal = salience({ z, novelty, risk: riskOf(kind) });
  const alert = hysteresis(prevAlert, sal, { hi, lo });
  const level = alert ? "alert" : sal >= 0.25 ? "signal" : "ambient";
  return { z, salience: sal, level, alert, floor: noiseFloor(series), value };
}

// ── SNR: the headline KPI the whole dashboard optimizes ───────────────────────────────────────────
// classic dB form for a single edge (signal power over noise power)…
export function snrDb(signalPower, noisePower) {
  return 10 * Math.log10(Math.max(signalPower, 1e-9) / Math.max(noisePower, 1e-9));
}
// …and an aggregate the operator reads: of all edge activity, what fraction is genuine signal vs
// ambient noise. 1.0 = everything is signal (loud/busy), 0.0 = pure calm. Reported as a ratio + dB.
export function aggregateSnr(edges) {
  let sig = 0, noise = 0;
  for (const e of edges) {
    const s = e.salience ?? 0;
    sig += s; noise += (1 - s);
  }
  const total = sig + noise || 1;
  return { ratio: sig / total, db: snrDb(sig, noise || 1e-9), signal: sig, noise };
}

// ── MATCHED FILTER: known-bad signatures, flagged distinctly from generic anomalies ───────────────
// sustained egress to a NEW destination = the exfiltration signature. Not one spike (could be a normal
// burst) but persistent elevation above the floor toward a destination not seen before this window.
export function egressSpike(series, { floor = noiseFloor(series), minRun = 3, toNewDestination = false } = {}) {
  let run = 0, maxRun = 0;
  for (const v of series) { if (v > floor) { run++; maxRun = Math.max(maxRun, run); } else run = 0; }
  const sustained = maxRun >= minRun;
  return { match: sustained && toNewDestination, sustained, runLength: maxRun, newDestination: toNewDestination };
}

// the ranked operator view: sort edges by salience desc, tag each tier, surface the matched patterns.
export function rank(edges) {
  return [...edges].sort((a, b) => (b.salience ?? 0) - (a.salience ?? 0));
}

export const DSP_VERSION = "1.0";

// expose on window for the dashboard (the app imports the named exports; this is a convenience global).
if (typeof window !== "undefined") {
  window.HoloControlDSP = { median, mad, robustSigma, noiseFloor, zScore, ema, smooth, delta,
    salience, squash, clamp01, riskOf, hysteresis, classify, snrDb, aggregateSnr, egressSpike, rank, DSP_VERSION };
}
