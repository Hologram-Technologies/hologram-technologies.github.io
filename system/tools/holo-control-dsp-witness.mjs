#!/usr/bin/env node
// holo-control-dsp-witness.mjs — proves the signal-processing core of Holo Control (the telemetry
// command center, consumer of Holo Telemetry ADR-0073) is CORRECT, not just present. The DSP turns
// each governable edge's raw activity into signal-vs-noise: a robust noise floor (median/MAD), a
// robust z-score, salience ranking (magnitude × novelty × governance-risk), thresholding WITH
// hysteresis (so alerts can't flap), an aggregate SNR, and an egress-spike matched filter. Pure +
// deterministic, so the math re-runs identically here and in the browser.
//
//   node tools/holo-control-dsp-witness.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DSP = "C:/Users/pavel/Desktop/Hologram Apps/apps/control/holo-control-dsp.js";
const d = await import(pathToFileURL(DSP));

const checks = {}; const fail = [];
const ok = (n, c, det = "") => { checks[n] = !!c; if (!c) fail.push(n + (det ? ` — ${det}` : "")); return !!c; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// ── 1 · robust baseline: median + MAD, NOT mean/stddev (loud spikes must not inflate the floor) ──
ok("median-and-mad-are-robust", d.median([1, 2, 3, 4, 5]) === 3 && d.median([1, 2, 3, 4]) === 2.5 && d.mad([1, 2, 3, 4, 5]) === 1);
// a few huge outliers barely move a median floor (the whole point) vs a mean that would chase them ──
const calmWithSpikes = [10, 10, 11, 9, 10, 200, 10, 9, 11, 10];
const floor = d.noiseFloor(calmWithSpikes, { k: 3 });
const meanFloor = calmWithSpikes.reduce((a, b) => a + b, 0) / calmWithSpikes.length;
ok("noise-floor-resists-outliers", d.median(calmWithSpikes) === 10 && floor < meanFloor + 60 && meanFloor > 25, `floor=${floor.toFixed(1)} mean=${meanFloor}`);

// ── 2 · degenerate window (all-equal) does not divide-by-zero; z is finite ──
ok("robust-sigma-guards-degenerate", d.robustSigma([5, 5, 5, 5]) > 0 && Number.isFinite(d.zScore(5, [5, 5, 5, 5])));

// ── 3 · z-score: a value far above a calm baseline is strongly positive; an in-band value ~0 ──
const base = [10, 10, 11, 9, 10, 10, 9, 11];
ok("z-score-flags-deviation", d.zScore(40, base) > 5 && Math.abs(d.zScore(10, base)) < 1, `z(40)=${d.zScore(40, base).toFixed(1)}`);

// ── 4 · low-pass (EMA) converges toward the input; high-pass (Δ) is the last change ──
const sm = d.smooth([0, 0, 0, 10, 10, 10, 10, 10], 0.5);
ok("low-pass-smooths-high-pass-changes", sm[sm.length - 1] > 8 && sm[3] < 10 && d.delta([5, 5, 9]) === 4);

// ── 5 · squash: 0 at z≤0, monotone increasing, never reaches 1 (bounded magnitude) ──
ok("squash-bounds-magnitude", d.squash(-2) === 0 && d.squash(0) === 0 && d.squash(3) > d.squash(1) && d.squash(100) < 1);

// ── 6 · SALIENCE: rises with anomaly z AND with governance-risk; a high-risk egress outranks a same-z app ──
const sEgress = d.salience({ z: 4, novelty: 0, risk: d.riskOf("egress") });
const sApp = d.salience({ z: 4, novelty: 0, risk: d.riskOf("app") });
ok("salience-weights-governance-risk", sEgress > sApp && d.salience({ z: 8, novelty: 1, risk: 1 }) <= 1 && d.salience({ z: 0, novelty: 0, risk: 0.2 }) === 0, `egress=${sEgress.toFixed(2)} app=${sApp.toFixed(2)}`);

// ── 7 · HYSTERESIS: enters alert at hi, STAYS until it drops below lo, doesn't flap in the band ──
let st = false;
st = d.hysteresis(st, 0.5, { hi: 0.66, lo: 0.4 }); ok("hysteresis-no-premature-fire", st === false);   // 0.5 in band, not yet
st = d.hysteresis(st, 0.7, { hi: 0.66, lo: 0.4 });                                                       // crosses hi → on
const stayed = d.hysteresis(st, 0.5, { hi: 0.66, lo: 0.4 });                                             // back in band → STAYS on
const left = d.hysteresis(stayed, 0.3, { hi: 0.66, lo: 0.4 });                                           // below lo → off
ok("hysteresis-latches-then-releases", st === true && stayed === true && left === false);

// ── 8 · classify into the three calm-by-default tiers on crafted series ──
const calm = [10, 10, 11, 9, 10, 10, 9, 11];
const ambient = d.classify(calm, 10, { kind: "app" });
const alerting = d.classify(calm, 80, { kind: "egress", novelty: 1 });
ok("classify-ambient-vs-alert", ambient.level === "ambient" && ambient.alert === false && alerting.level === "alert" && alerting.alert === true, `${ambient.level}/${alerting.level}`);

// ── 9 · aggregate SNR: all-signal → ratio 1, all-ambient → 0, mixed in between ──
const allSig = d.aggregateSnr([{ salience: 1 }, { salience: 1 }]);
const allAmb = d.aggregateSnr([{ salience: 0 }, { salience: 0 }]);
const mixed = d.aggregateSnr([{ salience: 1 }, { salience: 0 }]);
ok("aggregate-snr-tracks-signal-fraction", near(allSig.ratio, 1) && near(allAmb.ratio, 0) && near(mixed.ratio, 0.5));

// ── 10 · MATCHED FILTER: sustained egress to a NEW destination matches; a lone spike does not ──
const sustained = [5, 5, 30, 31, 29, 32, 5];                       // a run above the floor
const lone = [5, 5, 5, 60, 5, 5, 5];                               // one spike, then calm
const fl = 12;
const hit = d.egressSpike(sustained, { floor: fl, minRun: 3, toNewDestination: true });
const lonely = d.egressSpike(lone, { floor: fl, minRun: 3, toNewDestination: true });
const known = d.egressSpike(sustained, { floor: fl, minRun: 3, toNewDestination: false });
ok("matched-filter-exfil-signature", hit.match === true && hit.runLength >= 3 && lonely.match === false && known.match === false, `run=${hit.runLength}`);

// ── 11 · rank surfaces the most-salient edge first (the operator never hunts) ──
const ranked = d.rank([{ id: "a", salience: 0.2 }, { id: "b", salience: 0.9 }, { id: "c", salience: 0.5 }]);
ok("rank-puts-signal-on-top", ranked[0].id === "b" && ranked[2].id === "a");

// ── 12 · determinism: the same series re-derives the same classification (a re-runnable witness) ──
const again = d.classify(calm, 80, { kind: "egress", novelty: 1 });
ok("deterministic-classification", again.salience === alerting.salience && again.level === alerting.level);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  witnessed,
  covers: [
    "robust noise floor (median + MAD, not mean/stddev) so a few loud spikes do NOT inflate the floor and hide the next signal",
    "robust z-score flags how far above the floor the current activity sits; a degenerate all-equal window does not divide by zero",
    "low-pass EMA gives the calm steady-state view, high-pass Δ surfaces what just changed",
    "salience = magnitude × novelty × governance-risk (egress / wallet-out / agent-write weigh heaviest), bounded to [0,1] — ranking puts the one thing worth looking at on top",
    "thresholding WITH hysteresis: an alert latches at the high gate and releases only below the low gate, so it cannot flap in the band",
    "classify sorts every edge into calm-by-default tiers (ambient → signal → alert)",
    "aggregate SNR reports the fraction of activity that is genuine signal vs ambient noise — the headline KPI the dashboard optimizes",
    "a matched filter flags the exfiltration signature (sustained egress to a NEW destination) distinctly from a lone spike or a known destination",
    "deterministic: the same series re-derives the same classification (provable, not asserted)",
  ],
  module: "Hologram Apps/apps/control/holo-control-dsp.js",
  checks, failed: fail,
  authority: "robust statistics (median/MAD, 1.4826·MAD ≈ σ) · classical DSP (EMA low-pass, first-difference high-pass, SNR dB, matched filter) · Holo Telemetry (ADR-0073) signals · holospaces Law L5 (deterministic re-derivation)",
};
writeFileSync(join(here, "holo-control-dsp-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Control DSP witness — signal-over-noise core of the telemetry command center\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
