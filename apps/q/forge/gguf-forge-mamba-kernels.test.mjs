// Mamba kernel fidelity witness: the JS ssmConv1d + selectiveScan vs ggml's REAL
// ggml_ssm_conv / ggml_ssm_scan (compiled into ssm-ref.exe from the llama.cpp fork),
// on random single-token inputs. conv is pure multiply-add (bit-exact); scan uses
// expf/softplus via libm so it's compared within tolerance (greedy-parity bar).
//
// ssm-ref.exe runs via execFileSync with the MinGW bin on PATH (runtime DLLs).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import assert from "node:assert";
import { ssmConv1d, selectiveScan, selectiveScan2, wkv7, conv1d } from "./gguf-forge-kernels.mjs";
import { f32ToF16 } from "./gguf-forge-matmul.mjs";
import { f16ToF32 } from "../qvac-ingest.mjs";
const f16r = (x) => f16ToF32(f32ToF16(x));

const QV = "C:/Users/pavel/Desktop/qvac-fabric-llm.cpp-master/qvac-fabric-llm.cpp-master";
const REF = `${QV}/ssm-ref.exe`;
const MINGW = "C:/Users/pavel/AppData/Local/Microsoft/WinGet/Packages/BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe/mingw64/bin";

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hx = (f) => { const b = new ArrayBuffer(4); new Float32Array(b)[0] = f; return new Uint32Array(b)[0].toString(16).padStart(8, "0"); };
const unhx = (s) => new Float32Array(new Uint32Array([parseInt(s, 16) >>> 0]).buffer)[0];

function ref(mode, dims, floats) {
  const out = execFileSync(REF, [mode, ...dims.map(String)], {
    input: floats.map(hx).join(" "), env: { ...process.env, PATH: `${MINGW};${process.env.PATH}` }, maxBuffer: 1 << 24,
  }).toString().trim();
  return out.split(/\s+/).map(unhx);
}

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };
assert(existsSync(REF), "ssm-ref.exe missing — build it first");

// ── ssm_conv: bit-exact (pure multiply-add, same summation order) ──
t("ssmConv1d bit-exact vs ggml_ssm_conv (random, several shapes)", () => {
  let maxbad = 0;
  for (const [dConv, dInner, seed] of [[4, 16, 1], [4, 32, 2], [3, 8, 3], [2, 5, 4]]) {
    const rnd = mulberry32(seed);
    const convState = Float32Array.from({ length: dInner * (dConv - 1) }, () => rnd() * 2 - 1);
    const xin = Float32Array.from({ length: dInner }, () => rnd() * 2 - 1);
    const convW = Float32Array.from({ length: dInner * dConv }, () => rnd() * 2 - 1);
    const js = ssmConv1d(xin, Float32Array.from(convState), convW, dInner, dConv);
    // ggml sx = per channel [convState window ‖ xin]
    const sx = new Float32Array(dInner * dConv);
    for (let ch = 0; ch < dInner; ch++) { for (let k = 0; k < dConv - 1; k++) sx[ch * dConv + k] = convState[ch * (dConv - 1) + k]; sx[ch * dConv + dConv - 1] = xin[ch]; }
    const g = ref("conv", [dConv, dInner], [...sx, ...convW]);
    for (let i = 0; i < dInner; i++) maxbad = Math.max(maxbad, hx(js[i]) === hx(g[i]) ? 0 : 1);
    assert.strictEqual(maxbad, 0, `shape d_conv=${dConv} d_inner=${dInner} mismatch`);
  }
});

// ── ssm_scan: within tolerance (expf/softplus libm seam) ──
t("selectiveScan matches ggml_ssm_scan within tol (random, several shapes)", () => {
  let worst = 0;
  for (const [dState, dInner, seed] of [[16, 16, 11], [16, 32, 12], [8, 8, 13], [4, 6, 14]]) {
    const rnd = mulberry32(seed);
    const ssmState = Float32Array.from({ length: dInner * dState }, () => rnd() * 2 - 1);
    const x = Float32Array.from({ length: dInner }, () => rnd() * 2 - 1);
    const dt = Float32Array.from({ length: dInner }, () => rnd() * 2 - 1);                 // post-bias Δt
    const A = Float32Array.from({ length: dInner * dState }, () => -(rnd() * 2 + 0.05));   // A = −exp(A_log) < 0
    const B = Float32Array.from({ length: dState }, () => rnd() * 2 - 1);
    const C = Float32Array.from({ length: dState }, () => rnd() * 2 - 1);
    const js = selectiveScan(x, dt, A, B, C, Float32Array.from(ssmState), dInner, dState);
    const g = ref("scan", [dState, dInner], [...ssmState, ...x, ...dt, ...A, ...B, ...C]);
    for (let i = 0; i < dInner; i++) worst = Math.max(worst, Math.abs(js[i] - g[i]) / (Math.abs(g[i]) + 1e-4));
  }
  console.log(`      worst relErr vs ggml: ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-4, `scan rel err ${worst} exceeds tol`);
});

// ── ssm_scan Mamba-2 (scalar decay per head, grouped B/C) within tolerance ──
t("selectiveScan2 matches ggml_ssm_scan (Mamba-2) within tol", () => {
  let worst = 0;
  for (const [dState, nHead, headDim, nGroup, seed] of [[16, 8, 16, 1, 21], [16, 4, 12, 2, 22], [16, 6, 8, 3, 23], [8, 2, 4, 1, 24]]) {
    const rnd = mulberry32(seed), dInner = nHead * headDim;
    const ssmState = Float32Array.from({ length: dInner * dState }, () => rnd() * 2 - 1);
    const x = Float32Array.from({ length: dInner }, () => rnd() * 2 - 1);
    const dt = Float32Array.from({ length: nHead }, () => rnd() * 2 - 1);
    const A = Float32Array.from({ length: nHead }, () => -(rnd() * 2 + 0.05));        // scalar per head, < 0
    const B = Float32Array.from({ length: nGroup * dState }, () => rnd() * 2 - 1);
    const C = Float32Array.from({ length: nGroup * dState }, () => rnd() * 2 - 1);
    const js = selectiveScan2(x, dt, A, B, C, Float32Array.from(ssmState), nHead, headDim, dState, nGroup);
    const g = ref("scan2", [dState, nHead, headDim, nGroup], [...ssmState, ...x, ...dt, ...A, ...B, ...C]);
    for (let i = 0; i < dInner; i++) worst = Math.max(worst, Math.abs(js[i] - g[i]) / (Math.abs(g[i]) + 1e-4));
  }
  console.log(`      worst relErr vs ggml: ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-4, `scan2 rel err ${worst} exceeds tol`);
});

// ── RWKV7 WKV (delta-rule) within tolerance vs ggml_rwkv_wkv7 ──
t("wkv7 matches ggml_rwkv_wkv7 within tol (random, several shapes)", () => {
  let worst = 0;
  // ggml's wkv7 SIMD path has no scalar tail → head_size must be a multiple of the
  // SIMD step (real RWKV7 uses 64). Witness at 64/32 (matches production).
  for (const [S, H, seed] of [[64, 2, 31], [64, 3, 32], [32, 4, 33], [32, 2, 34]]) {
    const rnd = mulberry32(seed), C = S * H;
    const mk = (n, f = () => rnd() * 2 - 1) => Float32Array.from({ length: n }, f);
    const r = mk(C), k = mk(C), v = mk(C), a = mk(C), b = mk(C), state = mk(H * S * S);
    const w = mk(C, () => Math.exp(-(rnd() * 0.5 + 0.1)));      // decay in (0,1)
    const js = wkv7(r, w, k, v, a, b, Float32Array.from(state), H, S);
    const g = ref("wkv7", [S, H], [...r, ...w, ...k, ...v, ...a, ...b, ...state]);
    for (let i = 0; i < C; i++) worst = Math.max(worst, Math.abs(js[i] - g[i]) / (Math.abs(g[i]) + 1e-4));
  }
  console.log(`      worst relErr vs ggml: ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-4, `wkv7 rel err ${worst} exceeds tol`);
});

// ── Whisper conv stem: multi-channel strided Conv1d vs ggml_conv_1d ──
t("conv1d matches ggml_conv_1d within tol (whisper stem shapes)", () => {
  let worst = 0;
  // [K, IC, OC, L, stride]: conv1 (k3,s1) and conv2 (k3,s2), small channel counts
  for (const [K, IC, OC, L, stride, seed] of [[3, 8, 6, 20, 1, 41], [3, 6, 6, 20, 2, 42], [3, 10, 4, 16, 1, 43], [3, 4, 8, 15, 2, 44]]) {
    const rnd = mulberry32(seed), pad = K >> 1;
    const wRaw = Float32Array.from({ length: K * IC * OC }, () => rnd() * 2 - 1);
    const inp = Float32Array.from({ length: L * IC }, () => rnd() * 2 - 1);
    const wF16 = wRaw.map(f16r);                          // ggml stores the kernel as F16
    const js = conv1d(inp, wF16, IC, OC, K, L, stride, pad);
    const g = ref("conv1d", [K, IC, OC, L, stride], [...wRaw, ...inp]);
    assert.strictEqual(js.length, g.length, "OL*OC mismatch");
    for (let i = 0; i < js.length; i++) worst = Math.max(worst, Math.abs(js[i] - g[i]) / (Math.abs(g[i]) + 1e-4));
  }
  console.log(`      worst relErr vs ggml: ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-4, `conv1d rel err ${worst} exceeds tol`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
