// Tier-A dequant oracle tests. Two kinds of check:
//  (1) EXACT: crafted unit-scale blocks where the math collapses to integers, so
//      float32 == float64 == the integer truth — verifies layout, nibble order,
//      6-bit scale unpacking, and Q6_K bit assembly with zero tolerance.
//  (2) STRUCTURAL: random blocks dequantized by the oracle (float32) vs the
//      substrate's qvac-ingest dequantizeRaw (float64) — same algebra, so they
//      must agree to a few ULPs. Proves the oracle is the same algorithm, and
//      that the float64 path drifts only marginally.

import assert from "node:assert";
import {
  dequantQ4K, dequantQ6K, dequantQ8_0, dequantQ4_0,
  dequantQ2K, dequantQ3K, dequantQ5K, GGML,
} from "./gguf-forge-dequant.mjs";
import { dequantizeRaw } from "../qvac-ingest.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

const F16_ONE = [0x00, 0x3c];   // 1.0
const F16_ZERO = [0x00, 0x00];  // 0.0

// ── EXACT: Q8_0, d=1 → out == int8 quants ──
t("q8_0 unit-scale == int8 quants", () => {
  const qs = [0, 1, -1, 5, -5, 127, -128, 100, -100, 7, 8, 9, 64, -64, 33, -33,
              2, 3, 4, 6, 10, 11, 12, 13, 14, 15, 16, -16, 50, -50, 99, -99];
  const raw = new Uint8Array([...F16_ONE, ...qs.map((q) => q & 0xff)]);
  const out = dequantQ8_0(raw, 32);
  for (let i = 0; i < 32; i++) assert.strictEqual(out[i], qs[i], `idx ${i}`);
});

// ── EXACT: Q4_0, d=1 → out == nibble-8, interleaved halves ──
t("q4_0 unit-scale == (nibble-8), de-interleaved", () => {
  const qbytes = [];
  for (let j = 0; j < 16; j++) qbytes.push(((j) << 4) | ((15 - j) & 0xf)); // hi=j, lo=15-j
  const raw = new Uint8Array([...F16_ONE, ...qbytes]);
  const out = dequantQ4_0(raw, 32);
  for (let j = 0; j < 16; j++) {
    assert.strictEqual(out[j], (15 - j) - 8, `low ${j}`);        // low nibble → y[j]
    assert.strictEqual(out[16 + j], j - 8, `high ${j}`);         // high nibble → y[j+16]
  }
});

// ── EXACT: Q4_K unit-scale (d=1, dmin=0, all sc=1, all m=0) → out == nibbles ──
t("q4_K unit-scale == de-interleaved nibbles", () => {
  // scales that make get_scale_min_k4 return sc=1,m=0 for every sub-block (see module derivation).
  const scales = [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1];
  const qs = new Array(128);
  for (let k = 0; k < 128; k++) qs[k] = (((k * 3) & 0xf) << 4) | (k & 0xf); // hi=(3k)&F, lo=k&F
  const raw = new Uint8Array([...F16_ONE, ...F16_ZERO, ...scales, ...qs]);
  const out = dequantQ4K(raw, 256);
  // ggml order: for each 64-group g (q advances 32), first 32 = low nibbles, next 32 = high.
  for (let g = 0; g < 4; g++) {
    const qoff = g * 32, yoff = g * 64;
    for (let l = 0; l < 32; l++) {
      assert.strictEqual(out[yoff + l], qs[qoff + l] & 0x0f, `g${g} low ${l}`);
      assert.strictEqual(out[yoff + 32 + l], qs[qoff + l] >> 4, `g${g} high ${l}`);
    }
  }
});

// ── EXACT: Q6_K unit-scale (d=1, all scales=1) → out == reconstructed 6-bit q - 32 ──
t("q6_K unit-scale == (6-bit q − 32)", () => {
  const ql = new Array(128), qh = new Array(64);
  for (let i = 0; i < 128; i++) ql[i] = i & 0xff;
  for (let i = 0; i < 64; i++) qh[i] = (i * 7) & 0xff;
  const scales = new Array(16).fill(1);          // int8 = 1
  const raw = new Uint8Array([...ql, ...qh, ...scales, ...F16_ONE]);
  const out = dequantQ6K(raw, 256);
  // Reconstruct exactly per the C++ bit assembly for the first 128-group (n=0).
  for (let l = 0; l < 32; l++) {
    const q1 = ((ql[l +  0] & 0x0f) | (((qh[l] >> 0) & 3) << 4)) - 32;
    const q2 = ((ql[l + 32] & 0x0f) | (((qh[l] >> 2) & 3) << 4)) - 32;
    const q3 = ((ql[l +  0] >>   4) | (((qh[l] >> 4) & 3) << 4)) - 32;
    const q4 = ((ql[l + 32] >>   4) | (((qh[l] >> 6) & 3) << 4)) - 32;
    assert.strictEqual(out[l +  0], q1, `q1 ${l}`);
    assert.strictEqual(out[l + 32], q2, `q2 ${l}`);
    assert.strictEqual(out[l + 64], q3, `q3 ${l}`);
    assert.strictEqual(out[l + 96], q4, `q4 ${l}`);
  }
});

// ── EXACT: Q2_K. scales=0x01 → dl=d*(sc&0xF)=d, ml=min*(sc>>4)=0; d=1,dmin=0 →
//    out == the 2-bit field (qs>>shift)&3. qs=0x1B = 00011011 → 3,2,1,0 per shift. ──
t("q2_K unit-scale == 2-bit fields in shift order", () => {
  const scales = new Array(16).fill(0x01);
  const qs = new Array(64).fill(0x1b);
  const raw = new Uint8Array([...scales, ...qs, ...F16_ONE, ...F16_ZERO]); // d@80, dmin@82
  const out = dequantQ2K(raw, 256);
  for (let i = 0; i < 256; i++) {
    const expect = 3 - Math.floor((i % 128) / 32);
    assert.strictEqual(out[i], expect, `idx ${i}`);
  }
});

// ── EXACT: Q3_K. all scale bytes 0 → unpacked sb=0 → (sb-32)=-32; d=-1/32 (exact f16)
//    → dl=d*(sb-32)=1. hmask=0xFF → high-bit set → subtract 0. qs=0x1B → 2-bit fields. ──
t("q3_K unit-scale == 2-bit fields (hmask set, dl=1)", () => {
  const hmask = new Array(32).fill(0xff);
  const qs = new Array(64).fill(0x1b);
  const scales = new Array(12).fill(0x00);
  const F16_NEG_1_32 = [0x00, 0xa8];           // -0.03125 = -2^-5
  const raw = new Uint8Array([...hmask, ...qs, ...scales, ...F16_NEG_1_32]); // d@108
  const out = dequantQ3K(raw, 256);
  for (let i = 0; i < 256; i++) {
    const expect = 3 - Math.floor((i % 128) / 32);
    assert.strictEqual(out[i], expect, `idx ${i}`);
  }
});

// ── EXACT: Q5_K, qh=0 (no 5th bit) → identical to Q4_K nibble layout. ──
t("q5_K unit-scale (qh=0) == de-interleaved nibbles", () => {
  const scales = [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1]; // get_scale_min_k4 → sc=1,m=0
  const qh = new Array(32).fill(0x00);
  const ql = new Array(128);
  for (let k = 0; k < 128; k++) ql[k] = (((k * 3) & 0xf) << 4) | (k & 0xf);
  const raw = new Uint8Array([...F16_ONE, ...F16_ZERO, ...scales, ...qh, ...ql]); // d@0,dmin@2
  const out = dequantQ5K(raw, 256);
  for (let g = 0; g < 4; g++) {
    const qoff = g * 32, yoff = g * 64;
    for (let l = 0; l < 32; l++) {
      assert.strictEqual(out[yoff + l], ql[qoff + l] & 0x0f, `g${g} low ${l}`);
      assert.strictEqual(out[yoff + 32 + l], ql[qoff + l] >> 4, `g${g} high ${l}`);
    }
  }
});

// ── EXACT: Q5_K, qh=0xFF, ql=0 → every value gets the 5th bit (+16); u1/u2 shift
//    across all 4 groups → all 256 outputs == 16. Proves qh wiring + u progression. ──
t("q5_K 5th-bit (qh=0xFF, ql=0) == 16 everywhere", () => {
  const scales = [1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1];
  const qh = new Array(32).fill(0xff);
  const ql = new Array(128).fill(0x00);
  const raw = new Uint8Array([...F16_ONE, ...F16_ZERO, ...scales, ...qh, ...ql]);
  const out = dequantQ5K(raw, 256);
  for (let i = 0; i < 256; i++) assert.strictEqual(out[i], 16, `idx ${i}`);
});

// ── STRUCTURAL: oracle (f32) vs qvac-ingest dequantizeRaw (f64), random blocks ──
function rnd(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function randBytes(n, r) { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (r() * 256) | 0; return b; }
// compare only where the f64 reference is finite — random bytes can encode an Inf/NaN
// f16 scale, and both impls agree on producing Inf there (not a transcription concern).
function maxAbsDiff(a, b) { let m = 0; for (let i = 0; i < a.length; i++) { if (!Number.isFinite(b[i])) continue; const d = Math.abs(a[i] - b[i]); if (d > m) m = d; } return m; }

const ORACLE = {
  [GGML.Q2_K]: dequantQ2K, [GGML.Q3_K]: dequantQ3K, [GGML.Q4_K]: dequantQ4K,
  [GGML.Q5_K]: dequantQ5K, [GGML.Q6_K]: dequantQ6K, [GGML.Q8_0]: dequantQ8_0,
};
for (const [name, type, blockBytes] of [
  ["Q2_K", GGML.Q2_K, 84], ["Q3_K", GGML.Q3_K, 110], ["Q4_K", GGML.Q4_K, 144],
  ["Q5_K", GGML.Q5_K, 176], ["Q6_K", GGML.Q6_K, 210], ["Q8_0", GGML.Q8_0, 34],
]) {
  t(`${name} oracle≈dequantizeRaw within tolerance (8 random blocks)`, () => {
    const r = rnd(0xC0FFEE ^ type);
    const nblk = 8, elems = (type === GGML.Q8_0 ? 32 : 256) * nblk;
    const raw = randBytes(blockBytes * nblk, r);
    const exact = ORACLE[type](raw, elems);
    const ref = dequantizeRaw(type, raw, elems);
    const d = maxAbsDiff(exact, ref);
    // same algebra, f32 vs f64 → only ULP-scale drift relative to the value range.
    let amax = 0; for (const v of ref) if (Number.isFinite(v) && Math.abs(v) > amax) amax = Math.abs(v);
    assert.ok(d <= amax * 1e-5 + 1e-6, `maxdiff ${d} (amax ${amax})`);
    // both impls must agree on which entries are finite (catches a divergent NaN/Inf path).
    for (let i = 0; i < ref.length; i++) assert.strictEqual(Number.isFinite(exact[i]), Number.isFinite(ref[i]), `finite mismatch @${i}`);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
