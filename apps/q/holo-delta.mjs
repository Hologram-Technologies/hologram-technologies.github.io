// holo-delta.mjs — A2 of the personal-model-zoo plan: family index-delta. A finetune that shares a base's
// FRAME (see holo-model-frame.mjs) is stored as `base-κ + per-tensor delta`, reconstructed at LOAD (no new
// kernel — the engine still reads normal quantized weights). Two wins compose:
//   • FROZEN tensors (identical κ to the base) cost 0 extra bytes — content-addressing dedups them for free.
//   • CHANGED tensors are stored as a BitDelta (Liu et al. 2024): sign(Δ) at 1 bit/param + one scale α.
//
// HONEST storage math (this is where the "5–9×" claim earns or loses): the zoo ratio is driven by the
// FROZEN-TENSOR FRACTION, not within-tensor sparsity. A LoRA/partial finetune (most tensors frozen) →
// 10–30×; a FULL finetune (every tensor moves) → only ~3–4× (BitDelta is ~1 bit/param vs a 3–4 bit base).
// BitDelta is intrinsically lossy (sign+scale captures ~2/π≈64% of a Gaussian delta's energy); its
// published result is that OUTPUT quality is nonetheless preserved — that must be confirmed by perplexity
// on a REAL base+finetune pair (the A2 pass-bar gate), which this codec self-test does not run.
//
// Pure JS, isomorphic, zero deps. Node self-test sweeps frozen-fraction + reports fidelity and zoo ratio.

import { shareable } from "./holo-model-frame.mjs";

// ── BitDelta codec: Δ = ftW − baseW ; store sign(Δ) (1 bit) + α = mean|Δ| (the L2-optimal ±1 scale). ──
export function encodeBitDelta(baseW, ftW) {
  const n = baseW.length, signBits = new Uint8Array((n + 7) >> 3);
  let absSum = 0;
  for (let i = 0; i < n; i++) {
    const d = ftW[i] - baseW[i];
    if (d >= 0) signBits[i >> 3] |= 1 << (i & 7);   // bit set ⇒ +1
    absSum += Math.abs(d);
  }
  return { kind: "bitdelta", n, alpha: absSum / n, signBits };   // ~1 bit/param + one f32
}

export function decodeBitDelta(baseW, rec, out) {
  const n = rec.n, a = rec.alpha, o = out || new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (rec.signBits[i >> 3] >> (i & 7)) & 1;
    o[i] = baseW[i] + (pos ? a : -a);
  }
  return o;
}

// fraction of the delta's ENERGY captured by sign+scale (1 = perfect). For a Gaussian Δ this → 2/π ≈ 0.637.
export function deltaCaptured(baseW, ftW, rec) {
  const n = rec.n; let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const d = ftW[i] - baseW[i], pos = (rec.signBits[i >> 3] >> (i & 7)) & 1, r = d - (pos ? rec.alpha : -rec.alpha);
    num += r * r; den += d * d;
  }
  return den ? 1 - num / den : 1;
}

// ── model-level delta: per tensor, frozen (κ identical) → ref (0 bytes) else bitdelta. Frame-guarded. ──
// tensors: { name → { kappa, params, baseW?, ftW? } }. baseW/ftW (dequant weights) only needed to encode
// CHANGED tensors; pass them for changed ones, omit for frozen (κ tells us they're identical).
export function deltaModel(baseMeta, ftMeta, baseTensors, ftTensors) {
  if (!shareable(baseMeta, ftMeta)) throw new Error("holo-delta: base and finetune are not in the same frame/arch — cannot delta (see holo-model-frame.shareable)");
  const records = {}; let frozenParams = 0, changedParams = 0, deltaBytes = 0;
  for (const name of Object.keys(ftTensors)) {
    const b = baseTensors[name], f = ftTensors[name];
    if (b && f.kappa && b.kappa === f.kappa) { records[name] = { kind: "ref", kappa: b.kappa }; frozenParams += f.params || 0; continue; }
    const rec = encodeBitDelta(f.baseW, f.ftW);
    records[name] = { kind: "bitdelta", base: b ? b.kappa : null, alpha: rec.alpha, n: rec.n };
    changedParams += rec.n; deltaBytes += rec.signBits.length + 4;   // bits + α
  }
  return { records, stats: { frozenParams, changedParams, deltaBytes, deltaBitsPerChangedParam: changedParams ? (deltaBytes * 8) / changedParams : 0 } };
}

// ── LOSSLESS byte-delta over stored quantized blocks (the right fit for κ-objects). A base and finetune
//    tensor share the same packed length (same dims+fmt); store only the differing byte runs. Reconstruction
//    is byte-identical to the finetune's own block ⇒ perplexity = standalone (NO quality gate). Falls back to
//    storing the whole block when the diff isn't sparse. This is the default for the family loader. ──
const _GAP = 8;   // coalesce changed runs separated by ≤_GAP identical bytes (amortizes per-run header)
export function encodeByteDelta(baseBytes, ftBytes) {
  if (baseBytes.length !== ftBytes.length) return { kind: "whole", len: ftBytes.length, bytes: ftBytes };
  const n = ftBytes.length, runs = []; let i = 0, deltaSize = 0;
  while (i < n) {
    if (baseBytes[i] === ftBytes[i]) { i++; continue; }
    let j = i + 1, gap = 0;                                  // extend run, tolerating short identical gaps
    while (j < n && (baseBytes[j] !== ftBytes[j] || (gap = run_gap(baseBytes, ftBytes, j)) <= _GAP)) { j += gap > 0 ? gap : 1; if (gap > 0) gap = 0; }
    runs.push({ off: i, bytes: ftBytes.slice(i, j) }); deltaSize += (j - i) + 8;   // bytes + ~8B run header
    i = j;
  }
  if (deltaSize >= n * 0.9) return { kind: "whole", len: n, bytes: ftBytes };   // not sparse enough → store whole
  return { kind: "bytedelta", len: n, runs };
}
function run_gap(a, b, j) { let g = 0; while (j + g < a.length && a[j + g] === b[j + g]) g++; return g; }
export function applyByteDelta(baseBytes, rec) {
  if (rec.kind === "whole") return rec.bytes;
  const out = baseBytes.slice(0, rec.len);
  for (const r of rec.runs) out.set(r.bytes, r.off);
  return out;
}
export function byteDeltaSize(rec) { return rec.kind === "whole" ? rec.bytes.length : rec.runs.reduce((s, r) => s + r.bytes.length + 8, 0); }

// compact binary (de)serialization for a byte-delta record — what gets gzipped + content-addressed.
export function serializeDelta(rec) {
  if (rec.kind === "whole") { const o = new Uint8Array(5 + rec.bytes.length); new DataView(o.buffer).setUint32(1, rec.len); o[0] = 1; o.set(rec.bytes, 5); return o; }
  let sz = 9; for (const r of rec.runs) sz += 8 + r.bytes.length;
  const o = new Uint8Array(sz), dv = new DataView(o.buffer); o[0] = 0; dv.setUint32(1, rec.len); dv.setUint32(5, rec.runs.length); let p = 9;
  for (const r of rec.runs) { dv.setUint32(p, r.off); dv.setUint32(p + 4, r.bytes.length); o.set(r.bytes, p + 8); p += 8 + r.bytes.length; }
  return o;
}
export function parseDelta(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), len = dv.getUint32(1);
  if (u8[0] === 1) return { kind: "whole", len, bytes: u8.subarray(5) };
  const nRuns = dv.getUint32(5), runs = []; let p = 9;
  for (let i = 0; i < nRuns; i++) { const off = dv.getUint32(p), blen = dv.getUint32(p + 4); runs.push({ off, bytes: u8.subarray(p + 8, p + 8 + blen) }); p += 8 + blen; }
  return { kind: "bytedelta", len, runs };
}

// zoo storage ratio vs storing N finetunes independently. baseBitsPerParam ≈ 3 (q3) or 4 (q4).
export function zooRatio({ totalParams, frozenFractionOfParams, N, baseBitsPerParam = 3 }) {
  const B = baseBitsPerParam, g = 1 - frozenFractionOfParams;   // g = changed fraction
  const independent = (N + 1) * totalParams * B;
  const shared = totalParams * B + N * (g * totalParams * 1);   // base + N×(changed params × 1 bit)
  return independent / shared;
}

// ── Node self-test: realistic synthetic base + finetunes at varying frozen fractions. ──
if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("holo-delta.mjs")) {
  const n = 1 << 20;                                   // 1M-param tensor
  const rnd = (() => { let s = 0x2545f491; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; })();
  const gauss = (sig) => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return sig * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const baseW = new Float32Array(n); for (let i = 0; i < n; i++) baseW[i] = gauss(0.02);   // LLM-like weight σ

  console.log("\n— BitDelta fidelity on a CHANGED tensor (Δ ~ Gaussian) —");
  for (const dsig of [0.002, 0.02]) {
    const ftW = new Float32Array(n); for (let i = 0; i < n; i++) ftW[i] = baseW[i] + gauss(dsig);
    const rec = encodeBitDelta(baseW, ftW); const hat = decodeBitDelta(baseW, rec);
    let relNum = 0, relDen = 0; for (let i = 0; i < n; i++) { const e = ftW[i] - hat[i]; relNum += e * e; relDen += ftW[i] * ftW[i]; }
    const bpp = (rec.signBits.length + 4) * 8 / n;
    console.log(`  Δσ=${dsig}: α=${rec.alpha.toExponential(2)}  energy-captured=${(deltaCaptured(baseW, ftW, rec) * 100).toFixed(1)}%  recon ||err||/||ft||=${Math.sqrt(relNum / relDen).toExponential(2)}  ${bpp.toFixed(3)} bits/param`);
  }

  console.log("\n— zoo storage ratio (base + 50 finetunes) by frozen-tensor fraction —");
  for (const frozen of [0.0, 0.5, 0.8, 0.9, 0.98]) {
    const r3 = zooRatio({ totalParams: 2e9, frozenFractionOfParams: frozen, N: 50, baseBitsPerParam: 3 });
    const r4 = zooRatio({ totalParams: 2e9, frozenFractionOfParams: frozen, N: 50, baseBitsPerParam: 4 });
    const tag = frozen === 0 ? "full finetune" : frozen >= 0.98 ? "LoRA-ish" : "partial";
    console.log(`  frozen=${(frozen * 100).toFixed(0).padStart(3)}%  →  ${r3.toFixed(1)}× (q3 base) · ${r4.toFixed(1)}× (q4 base)   [${tag}]`);
  }

  console.log("\n— lossless byte-delta over a quantized block (reconstruct must be byte-identical) —");
  for (const changeFrac of [0.02, 0.2, 0.6]) {
    const blkN = 1 << 20, base = new Uint8Array(blkN); for (let i = 0; i < blkN; i++) base[i] = (rnd() * 256) | 0;
    const ft = base.slice(); for (let i = 0; i < blkN; i++) if (rnd() < changeFrac) ft[i] = (rnd() * 256) | 0;   // finetune flips a fraction of bytes
    const rec = encodeByteDelta(base, ft); const back = applyByteDelta(base, rec);
    let identical = back.length === ft.length; for (let i = 0; identical && i < ft.length; i++) identical = back[i] === ft[i];
    console.log(`  changed≈${(changeFrac * 100).toFixed(0)}%  → ${rec.kind.padEnd(9)} ${(byteDeltaSize(rec) / 1024).toFixed(0)}KB vs ${(blkN / 1024).toFixed(0)}KB block (${(byteDeltaSize(rec) / blkN).toFixed(2)}×)  reconstruct byte-identical=${identical}`);
  }

  console.log("\n— frame guard —");
  const A = { frame: { fingerprint: "x" }, d: 2560, n_layers: 30, ff: 6912, n_heads: 20, n_kv_heads: 5, hd: 128, vocab: 128256 };
  const Bsame = { ...A }, Bdiff = { ...A, d: 3584 };
  console.log(`  same frame+arch shareable: ${shareable(A, Bsame)}  ·  different arch shareable: ${shareable(A, Bdiff)}`);
  // and that deltaModel refuses a mismatched pair
  try { deltaModel(A, Bdiff, {}, {}); console.log("  ERROR: deltaModel should have refused"); }
  catch (e) { console.log(`  deltaModel correctly refused mismatch: "${e.message.slice(0, 60)}…"`); }
}
