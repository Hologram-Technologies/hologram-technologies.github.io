// Integer-dot oracle tests.
//  (1) Q8_K round-trip: dequant(quantize(act)) within the q8 step (|max|/127).
//  (2) Algebraic equivalence: the integer dot equals Σ dequant(weight)·dequant(q8k)
//      computed independently in float64 — proving the integer path computes the
//      right quantity (the float32 vs float64 gap is the only divergence).
//
// Full BIT-exactness vs llama.cpp is gate row 4 (task #4), pending reference
// vectors from llama-cli. These checks prove correctness of the algorithm itself.

import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { quantizeRowQ8K, vecDotQ4K, vecDotQ6K, vecDotTq2_0, vecDotF16, f16Row, nearestInt, quantizeRowQ8_0, vecDotQ8_0, vecDotQ5_0, vecDotQ4_0, f32ToF16 } from "./gguf-forge-matmul.mjs";
import { dequantQ4K, dequantQ6K, dequantQ8_0, dequantQ5_0, dequantQ4_0, dequantTq2_0 } from "./gguf-forge-dequant.mjs";
import { f16ToF32 } from "../qvac-ingest.mjs";

// F16 vec_dot ground truth: ggml's ggml_vec_dot_f16, built against the SAME ggml libs/flags
// as forge-ref.exe (SSE3 tier). vecdot-ref.exe converts both operands to f16 and dots.
const QV = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master";
const VECDOT_REF = `${QV}/vecdot-ref.exe`;            // SSE3 tier (forge-ref's build)
const VECDOT_REF_AVX2 = `${QV}/vecdot-ref-avx2.exe`; // AVX2+F16C+FMA tier
const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";
const REF_ENV = { env: { ...process.env, PATH: `${MINGW};${process.env.PATH}` }, maxBuffer: 1 << 26 };
const f32bits = (f) => { const b = new ArrayBuffer(4); new Float32Array(b)[0] = f; return new Uint32Array(b)[0] >>> 0; };
const bhex = (f) => f32bits(f).toString(16).padStart(8, "0");

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

function prng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function randBytes(n, r) { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (r() * 256) | 0; return b; }
function randActs(n, r, amp = 3) { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.fround((r() * 2 - 1) * amp); return a; }

t("nearestInt matches round-half-to-even on exact halves", () => {
  assert.strictEqual(nearestInt(2.5), 2);   // ties to even
  assert.strictEqual(nearestInt(3.5), 4);
  assert.strictEqual(nearestInt(-2.5), -2);
  assert.strictEqual(nearestInt(1.4), 1);
  assert.strictEqual(nearestInt(1.6), 2);
  assert.strictEqual(nearestInt(-0.0), 0);
});

t("Q8_K round-trip error bounded by |max|/127", () => {
  const r = prng(7);
  const act = randActs(512, r);
  const { d, qs } = quantizeRowQ8K(act, 512);
  for (let blk = 0; blk < 2; blk++) {
    let amax = 0; for (let j = 0; j < 256; j++) amax = Math.max(amax, Math.abs(act[blk * 256 + j]));
    const bound = amax / 127 * 1.01 + 1e-6;
    for (let j = 0; j < 256; j++) {
      const recon = d[blk] * qs[blk * 256 + j];
      assert.ok(Math.abs(recon - act[blk * 256 + j]) <= bound, `blk${blk} idx${j}: err ${Math.abs(recon - act[blk * 256 + j])} > ${bound}`);
    }
  }
});

// reference float64 dot of dequant(weight) · dequant(q8k)
function refDot(deqW, q8k, nb) {
  let s = 0;
  for (let blk = 0; blk < nb; blk++) {
    const d = q8k.d[blk];
    for (let j = 0; j < 256; j++) s += deqW[blk * 256 + j] * (d * q8k.qs[blk * 256 + j]);
  }
  return s;
}
const relerr = (a, b) => Math.abs(a - b) / (Math.abs(b) + 1e-6);

t("Q4_K integer dot ≡ float reference (4 seeds)", () => {
  for (let seed = 1; seed <= 4; seed++) {
    const r = prng(seed * 101), nb = 2;
    const w = randBytes(nb * 144, r);          // random valid Q4_K blocks
    const act = randActs(nb * 256, r);
    const q8k = quantizeRowQ8K(act, nb * 256);
    const got = vecDotQ4K(nb, w, q8k);
    const ref = refDot(dequantQ4K(w, nb * 256), q8k, nb);
    assert.ok(relerr(got, ref) < 2e-3, `seed${seed}: got ${got} ref ${ref} rel ${relerr(got, ref)}`);
  }
});

t("Q6_K integer dot ≡ float reference (4 seeds)", () => {
  for (let seed = 1; seed <= 4; seed++) {
    const r = prng(seed * 211), nb = 2;
    const w = randBytes(nb * 210, r);
    const act = randActs(nb * 256, r);
    const q8k = quantizeRowQ8K(act, nb * 256);
    const got = vecDotQ6K(nb, w, q8k);
    const ref = refDot(dequantQ6K(w, nb * 256), q8k, nb);
    assert.ok(relerr(got, ref) < 2e-3, `seed${seed}: got ${got} ref ${ref} rel ${relerr(got, ref)}`);
  }
});

t("TQ2_0 integer dot ≡ float reference (4 seeds)", () => {
  for (let seed = 1; seed <= 4; seed++) {
    const r = prng(seed * 521), nb = 2;
    // valid block_tq2_0: 64 random 2-bit-code bytes + a representable f16 d (offset 64).
    const w = new Uint8Array(nb * 66);
    for (let b = 0; b < nb; b++) {
      for (let i = 0; i < 64; i++) w[b * 66 + i] = (r() * 256) | 0;
      new DataView(w.buffer).setUint16(b * 66 + 64, f32ToF16(Math.fround((r() * 2 - 1) * 0.5)), true);
    }
    const act = randActs(nb * 256, r);
    const q8k = quantizeRowQ8K(act, nb * 256);
    const got = vecDotTq2_0(nb, w, q8k);
    const ref = refDot(dequantTq2_0(w, nb * 256), q8k, nb);
    assert.ok(relerr(got, ref) < 2e-3, `seed${seed}: got ${got} ref ${ref} rel ${relerr(got, ref)}`);
  }
});

// ggml f16·f16 dot of a raw-f32 weight row and a raw-f32 activation (oracle converts both).
function refF16Dot(exe, K, wF32, xF32) {
  const parts = [];
  for (let i = 0; i < K; i++) parts.push(bhex(wF32[i]));
  for (let i = 0; i < K; i++) parts.push(bhex(xF32[i]));
  const out = execFileSync(exe, [String(K)], { ...REF_ENV, input: parts.join(" ") + "\n" }).toString().trim();
  return parseInt(out, 16) >>> 0;
}

// One implementation, bit-exact to BOTH x86 CPU tiers: SSE3 (forge-ref) AND AVX2+F16C+FMA.
// For f16 operands the per-step rounding (two-step vs fused) is provably a no-op (product
// ≤22 bits ≤ f32), so the tiers coincide; this asserts it against both real ggml oracles.
t("F16 dot BIT-EXACT vs ggml_vec_dot_f16 — SSE3 + AVX2 tiers (tail + no-tail, 4 seeds)", () => {
  assert.ok(existsSync(VECDOT_REF), "vecdot-ref.exe missing — build vs qvac build-cpu ggml libs");
  assert.ok(existsSync(VECDOT_REF_AVX2), "vecdot-ref-avx2.exe missing — build vec.cpp -mavx2 -mf16c -mfma");
  // K=2048 (no tail), 5460 (ffn_down: 170·32+20 tail), 20 (<step, pure scalar), 5461 (odd tail)
  for (const K of [2048, 5460, 20, 5461]) {
    for (let seed = 1; seed <= 4; seed++) {
      const r = prng(seed * 9173 + K);
      const wF32 = new Float32Array(K), xF32 = new Float32Array(K);
      for (let i = 0; i < K; i++) { wF32[i] = Math.fround((r() * 2 - 1) * 2); xF32[i] = Math.fround((r() * 2 - 1) * 3); }
      // weight stored as f16 bytes (via our f32ToF16); activation → f16 grid via f16Row (production path)
      const wb = new Uint8Array(K * 2), dv = new DataView(wb.buffer);
      for (let i = 0; i < K; i++) dv.setUint16(i * 2, f32ToF16(wF32[i]), true);
      const xh = f16Row(xF32, K);
      const got = f32bits(vecDotF16(dv, K, xh, 0));
      assert.strictEqual(got, refF16Dot(VECDOT_REF, K, wF32, xF32), `SSE3 K=${K} seed${seed}`);
      assert.strictEqual(got, refF16Dot(VECDOT_REF_AVX2, K, wF32, xF32), `AVX2 K=${K} seed${seed}`);
    }
  }
});

t("f32ToF16 round-trips representable values exactly", () => {
  for (const v of [0, 1, -1, 0.5, 2, 0.0625, -3.5, 100, 0.015625]) assert.strictEqual(f16ToF32(f32ToF16(v)), v, `v=${v}`);
});

// Q8_0-activation dots vs float reference: dequant(weight) · dequant(q8_0 act).
function refDotQ8_0(deqW, q8a, nb) {
  let s = 0;
  for (let blk = 0; blk < nb; blk++) { const d = q8a.d[blk]; for (let j = 0; j < 32; j++) s += deqW[blk * 32 + j] * (d * q8a.qs[blk * 32 + j]); }
  return s;
}
for (const [name, type, bBytes, deq, dot] of [
  ["Q8_0", 8, 34, dequantQ8_0, vecDotQ8_0], ["Q5_0", 6, 22, dequantQ5_0, vecDotQ5_0], ["Q4_0", 2, 18, dequantQ4_0, vecDotQ4_0],
]) {
  t(`${name} integer dot ≡ float reference (4 seeds)`, () => {
    for (let seed = 1; seed <= 4; seed++) {
      const r = prng(seed * 307 + type), nb = 3;
      const w = randBytes(nb * bBytes, r), act = randActs(nb * 32, r);
      for (let b = 0; b < nb; b++) w[b * bBytes + 1] &= 0xbf; // clear f16 exp bit6 -> no Inf/NaN scale
      const q8a = quantizeRowQ8_0(act, nb * 32);
      const got = dot(nb, w, q8a);
      const ref = refDotQ8_0(deq(w, nb * 32), q8a, nb);
      assert.ok(relerr(got, ref) < 2e-3, `${name} seed${seed}: got ${got} ref ${ref} rel ${relerr(got, ref)}`);
    }
  });
}

t("dot is deterministic (same inputs -> identical bits)", () => {
  const r = prng(999), nb = 3;
  const w = randBytes(nb * 144, r), act = randActs(nb * 256, r);
  const q8k = quantizeRowQ8K(act, nb * 256);
  assert.strictEqual(vecDotQ4K(nb, w, q8k), vecDotQ4K(nb, w, q8k));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
