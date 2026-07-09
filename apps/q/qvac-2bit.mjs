// qvac-2bit.mjs — NATIVE 2-bit WebGPU matmul: read 2-bit weights DIRECTLY on the GPU (no decode to Q8),
// undo incoherence with a runtime Hadamard, accumulate in f32. This is the on-GPU realization of the E₈/
// QuIP# 2-bit win: the per-token weight sweep drops ~4× vs Q8, so a 7B model (≈1.75 GB at 2-bit) fits
// resident in consumer VRAM and runs at VRAM bandwidth instead of paging from disk.
//
// Math (one-sided incoherence, the efficient form): let R = FWHT∘diag(sign) — orthogonal AND self-inverse
// (FWHT normalized 1/√K, sign ∈ ±1). Store Ŵ′ = quantize₂(R·Wₙ) per row (R isotropizes the row so a 2-bit
// grid quantizes it well). At inference rotate the INPUT once, x′ = R·x, then yₙ = Σ Ŵ′[n,k]·x′[k] ≈
// (R·Wₙ)·(R·x) = Wₙ·x — the rotation cancels for free, no output Hadamard. Cost: one length-K Hadamard
// per matmul (O(K log K), negligible beside the O(N·K) matmul). Pure WebGPU; the codebook is a uniform
// 4-level grid {−3,−1,1,3}·scale with a per-32 block scale (same scale layout the engine's Q8 path uses).

const FWHT_WG = 256;                                   // single-workgroup input rotation (K ≤ 2048)
const MM_WG = 64;                                      // one workgroup per output row, 64-thread reduce

// ── CPU: deterministic ±1 signs (re-derivable from K, matches e8-quant's xorshift) ──
export function signsFor(K) {
  const s = new Float32Array(K); let x = (0x9e3779b9 ^ K) >>> 0;
  for (let i = 0; i < K; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; s[i] = (x & 1) ? 1 : -1; }
  return s;
}
function fwht(a) {                                      // in place, normalized (self-inverse)
  const n = a.length;
  for (let len = 1; len < n; len <<= 1) for (let i = 0; i < n; i += len << 1) for (let j = i; j < i + len; j++) { const u = a[j], v = a[j + len]; a[j] = u + v; a[j + len] = u - v; }
  const s = 1 / Math.sqrt(n); for (let i = 0; i < n; i++) a[i] *= s;
}

// ── CPU: pack a weight matrix W [N,K] (row-major) to incoherent 2-bit + per-32 scales ──
// Returns { qw:Uint32Array(N*K/16), sc:Float32Array(N*K/32), sign:Float32Array(K) }.
// incoherent=false skips the rotation (naive 2-bit) — for the quality contrast only.
export function pack2bit(W, N, K, { incoherent = true } = {}) {
  const nblk = K / 32, qw = new Uint32Array((N * K) / 16), sc = new Float32Array(N * nblk), sign = signsFor(K);
  const row = new Float64Array(K);
  for (let n = 0; n < N; n++) {
    for (let k = 0; k < K; k++) row[k] = incoherent ? W[n * K + k] * sign[k] : W[n * K + k];
    if (incoherent) fwht(row);                          // row ← R·Wₙ
    // per-block scale: MSE-optimal step for a 4-level uniform grid {−3,−1,1,3}·s on ~Gaussian data is
    // s ≈ 0.5·σ (grid spans ±1.5σ). Outliers beyond ±1.5σ clip — which is exactly what incoherence
    // removes (the Hadamard Gaussianizes the row), so naive-2-bit clips heavy tails and incoherent does not.
    for (let b = 0; b < nblk; b++) { let ss = 0; for (let i = 0; i < 32; i++) { const a = row[b * 32 + i]; ss += a * a; } sc[n * nblk + b] = (0.5 * Math.sqrt(ss / 32)) || 1e-12; }
    for (let k = 0; k < K; k++) {
      const t = row[k] / sc[n * nblk + (k >> 5)];
      let q = Math.round((t + 3) / 2); if (q < 0) q = 0; else if (q > 3) q = 3;   // grid {−3,−1,1,3}
      const idx = n * K + k; qw[idx >> 4] |= q << ((idx & 15) * 2);
    }
  }
  return { qw, sc, sign };
}
// reconstruct (CPU reference for the stored 2-bit weights, in the ORIGINAL basis): undo R on each row
export function unpack2bit(qw, sc, sign, N, K, { incoherent = true } = {}) {
  const nblk = K / 32, W = new Float32Array(N * K), row = new Float64Array(K);
  for (let n = 0; n < N; n++) {
    for (let k = 0; k < K; k++) { const idx = n * K + k; const q = (qw[idx >> 4] >>> ((idx & 15) * 2)) & 3; row[k] = (q * 2 - 3) * sc[n * nblk + (k >> 5)]; }
    if (incoherent) { fwht(row); for (let k = 0; k < K; k++) row[k] *= sign[k]; }    // R is self-inverse
    for (let k = 0; k < K; k++) W[n * K + k] = row[k];
  }
  return W;
}

// f32 → f16 bits (Uint16). Scales are small positives; round-toward-zero of the mantissa is fine.
export function f32ToF16(val) {
  _f32[0] = val; const x = _u32[0];
  const sign = (x >>> 16) & 0x8000; let exp = ((x >>> 23) & 0xff) - 112; const mant = x & 0x7fffff;
  if (exp <= 0) { if (exp < -10) return sign; const m = (mant | 0x800000) >> (1 - exp); return sign | (m >> 13); }
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (mant >> 13);
}
const _f32 = new Float32Array(1), _u32 = new Uint32Array(_f32.buffer);

// CODEBOOK-AWARE LDLQ to the 2-bit SCALAR grid {−3,−1,1,3}·sc — the engine's native 2-bit codebook, with
// NO incoherence (so no power-of-2 padding, no runtime Hadamard). Rounds input columns high→low feeding
// each future column's error back through L (the LDL factor of the input Hessian); L=null ⇒ plain scalar
// 2-bit (the fallback when no calibration Hessian of the right dim exists, e.g. the FFN down-proj). Returns
// the packed 2-bit indices (16 weights/u32, no padding — K must be a multiple of 16). sc = per-32 scales.
// `band` caps the feedback to the nearest `band` future columns (0 = full). The LDL factor's off-diagonal
// mass concentrates near the diagonal, so a band recovers most of the gain at O(N·K·band) instead of
// O(N·K²) — the difference between a feasible and an infeasible 7B compile in single-thread JS.
export function ldlqRound2bit(W, N, K, L, sc, band = 0, chunk = 4096) {
  const qw = new Uint32Array((N * K) / 16), nb = K / 32, CH = Math.min(chunk, N), E = new Float32Array(CH * K);
  for (let r0 = 0; r0 < N; r0 += CH) {                          // rows are independent in LDLQ → chunk them (E is CH·K, not N·K)
    const rN = Math.min(CH, N - r0); E.fill(0, 0, rN * K);
    for (let k = K - 1; k >= 0; k--) for (let ii = 0; ii < rN; ii++) {
      const i = r0 + ii;
      let corr = W[i * K + k]; if (L) { const jm = band ? Math.min(K, k + 1 + band) : K; for (let j = k + 1; j < jm; j++) corr += E[ii * K + j] * L[j * K + k]; }
      const s = sc[i * nb + (k >> 5)]; let q = Math.round(corr / s / 2 + 1.5); if (q < 0) q = 0; else if (q > 3) q = 3;
      E[ii * K + k] = W[i * K + k] - (q * 2 - 3) * s;
      const idx = i * K + k; qw[idx >> 4] |= q << ((idx & 15) * 2);
    }
  }
  return qw;
}

export const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return p; };
// re-quantize an engine Q8 tensor (int8 quants + per-32 f32 scales) → incoherent 2-bit, padding the input
// dim K to Kp = next power of 2 (the FWHT needs a pow2 length; padded weights/inputs are zeros ⇒ exact).
// Returns { q: packed 2-bit bytes [N*Kp/4], s: f32 scales [N*Kp/32], Kp }. The runtime rotates the input by
// the SAME R_Kp (signsFor(Kp)+FWHT), so Ŵ′·x′ = (R·W)(R·x) = W·x.
export function requant2bit(q8, s, N, K) {
  const Kp = nextPow2(K), nb = Kp / 32, sb = K / 32;
  const q = new Int8Array(q8.buffer, q8.byteOffset, N * K);
  const sign = signsFor(Kp), row = new Float64Array(Kp);
  const qw = new Uint32Array((N * Kp) / 16), sc = new Float32Array(N * nb);
  for (let n = 0; n < N; n++) {
    for (let k = 0; k < Kp; k++) row[k] = (k < K ? q[n * K + k] * s[n * sb + (k >> 5)] : 0) * sign[k];
    fwht(row);
    for (let b = 0; b < nb; b++) { let ss = 0; for (let i = 0; i < 32; i++) { const a = row[b * 32 + i]; ss += a * a; } sc[n * nb + b] = (0.5 * Math.sqrt(ss / 32)) || 1e-12; }   // MSE-optimal step for the {−3,−1,1,3} grid on Gaussianised (incoherent) weights
    for (let k = 0; k < Kp; k++) { const t = row[k] / sc[n * nb + (k >> 5)]; let qq = Math.round((t + 3) / 2); if (qq < 0) qq = 0; else if (qq > 3) qq = 3; const idx = n * Kp + k; qw[idx >> 4] |= qq << ((idx & 15) * 2); }
  }
  return { q: new Uint8Array(qw.buffer), s: sc, Kp };
}

// ── WGSL: input rotation x′ = FWHT(sign ⊙ x), single workgroup, shared memory ──
const FWHT_WGSL = `
@group(0) @binding(0) var<storage,read> x: array<f32>;
@group(0) @binding(1) var<storage,read> sgn: array<f32>;
@group(0) @binding(2) var<storage,read_write> xr: array<f32>;
@group(0) @binding(3) var<uniform> P: vec4<u32>;        // K, _, _, _
var<workgroup> sh: array<f32, 4096>;                    // 16 KB = the WebGPU min workgroup-storage limit; K ≤ 4096 (covers d up to 7B-class)
@compute @workgroup_size(${FWHT_WG})
fn main(@builtin(local_invocation_id) lid: vec3<u32>) {
  let K = P.x; let t = lid.x;
  for (var i = t; i < K; i += ${FWHT_WG}u) { sh[i] = x[i] * sgn[i]; }
  workgroupBarrier();
  var len = 1u;
  loop {
    if (len >= K) { break; }
    let half = K >> 1u;
    for (var i = t; i < half; i += ${FWHT_WG}u) {
      let blk = i / len; let j = i % len;
      let a = blk * (len << 1u) + j; let b = a + len;
      let u = sh[a]; let v = sh[b]; sh[a] = u + v; sh[b] = u - v;
    }
    workgroupBarrier();
    len = len << 1u;
  }
  let nrm = 1.0 / sqrt(f32(K));
  for (var i = t; i < K; i += ${FWHT_WG}u) { xr[i] = sh[i] * nrm; }
}`;

// ── WGSL: 2-bit GEMV — WORD-ORIENTED: each thread loads one u32 (16 weights), unpacks in registers,
// hoists the per-32 block scale (16 weights at a 16-aligned base never cross a 32 boundary → one scale
// read per word). Threads stride by workgroup over words → coalesced loads. f32 accumulate. ──
const MM2_WGSL = `
@group(0) @binding(0) var<storage,read> qw: array<u32>;
@group(0) @binding(1) var<storage,read> sc: array<f32>;
@group(0) @binding(2) var<storage,read> x: array<f32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;
@group(0) @binding(4) var<uniform> P: vec4<u32>;        // N, K, nblk, _
var<workgroup> red: array<f32, ${MM_WG}>;
@compute @workgroup_size(${MM_WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let n = wid.x; let K = P.y; let words = K >> 4u; let rowW = n * words; let rowS = n * P.z;
  var acc = 0.0; var w = lid.x;
  loop {
    if (w >= words) { break; }
    let packed = qw[rowW + w];
    let kb = w << 4u; let s = sc[rowS + (kb >> 5u)];
    for (var j = 0u; j < 16u; j = j + 1u) { acc = acc + x[kb + j] * f32(i32((packed >> (j * 2u)) & 3u) * 2 - 3) * s; }
    w = w + ${MM_WG}u;
  }
  red[lid.x] = acc; workgroupBarrier();
  var r = ${MM_WG >> 1}u;
  loop { if (r == 0u) { break; } if (lid.x < r) { red[lid.x] = red[lid.x] + red[lid.x + r]; } workgroupBarrier(); r = r >> 1u; }
  if (lid.x == 0u) { o[n] = red[0]; }
}`;

// ── WGSL: Q8 GEMV (the engine's current format) — WORD-ORIENTED too, so the comparison is purely the
// bytes-read difference, not kernel quality. Each thread loads one u32 (4 int8), unpacks 4. ──
const MM8_WGSL = `
@group(0) @binding(0) var<storage,read> qw: array<u32>;
@group(0) @binding(1) var<storage,read> sc: array<f32>;
@group(0) @binding(2) var<storage,read> x: array<f32>;
@group(0) @binding(3) var<storage,read_write> o: array<f32>;
@group(0) @binding(4) var<uniform> P: vec4<u32>;
var<workgroup> red: array<f32, ${MM_WG}>;
@compute @workgroup_size(${MM_WG})
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
  let n = wid.x; let K = P.y; let words = K >> 2u; let rowW = n * words; let rowS = n * P.z;
  var acc = 0.0; var w = lid.x;
  loop {
    if (w >= words) { break; }
    let packed = qw[rowW + w];
    let kb = w << 2u; let s = sc[rowS + (kb >> 5u)];
    for (var j = 0u; j < 4u; j = j + 1u) { let b = (packed >> (j * 8u)) & 0xffu; acc = acc + x[kb + j] * f32(i32(b << 24u) >> 24u) * s; }
    w = w + ${MM_WG}u;
  }
  red[lid.x] = acc; workgroupBarrier();
  var r = ${MM_WG >> 1}u;
  loop { if (r == 0u) { break; } if (lid.x < r) { red[lid.x] = red[lid.x] + red[lid.x + r]; } workgroupBarrier(); r = r >> 1u; }
  if (lid.x == 0u) { o[n] = red[0]; }
}`;

// ── GPU helpers ──
const U = (typeof GPUBufferUsage !== "undefined") ? GPUBufferUsage : {};
function pipe(dev, code) { const m = dev.createShaderModule({ code }); return dev.createComputePipeline({ layout: "auto", compute: { module: m, entryPoint: "main" } }); }
function sbuf(dev, src) { const b = dev.createBuffer({ size: Math.max(16, src.byteLength), usage: U.STORAGE | U.COPY_DST | U.COPY_SRC }); dev.queue.writeBuffer(b, 0, src); return b; }
function obuf(dev, bytes) { return dev.createBuffer({ size: Math.max(16, bytes), usage: U.STORAGE | U.COPY_SRC }); }
function ubuf(dev, arr) { const b = dev.createBuffer({ size: 16, usage: U.UNIFORM | U.COPY_DST }); dev.queue.writeBuffer(b, 0, arr); return b; }
async function readf32(dev, buf, n) { const st = dev.createBuffer({ size: n * 4, usage: U.MAP_READ | U.COPY_DST }); const e = dev.createCommandEncoder(); e.copyBufferToBuffer(buf, 0, st, 0, n * 4); dev.queue.submit([e.finish()]); await st.mapAsync(GPUMapMode.READ); const out = new Float32Array(st.getMappedRange().slice(0)); st.unmap(); st.destroy(); return out; }

// ── the bench: correctness (2-bit incoherent vs f32 ref vs naive-2-bit vs Q8) + perf + memory ──
export async function runBench(dev, { N = 2048, K = 2048, iters = 200 } = {}) {
  const nblk = K / 32;
  // random Gaussian weights + input (a realistic single layer matmul)
  let s = 1234567; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const gauss = () => { const u = Math.max(1e-12, rnd()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  // heavy-tailed weights like real LLM layers (kurtosis ≫ 3): a Gaussian bulk plus sparse large spikes —
  // the outliers that wreck naive low-bit quantization and that incoherence (the Hadamard) spreads out.
  const W = new Float32Array(N * K); for (let i = 0; i < N * K; i++) { let w = gauss() * 0.05; if (rnd() < 0.02) w *= 6; W[i] = w; }
  const x = new Float32Array(K); for (let i = 0; i < K; i++) x[i] = gauss();
  // f32 reference y = W·x
  const yref = new Float32Array(N); for (let n = 0; n < N; n++) { let a = 0; for (let k = 0; k < K; k++) a += W[n * K + k] * x[k]; yref[n] = a; }
  const relErr = (y) => { let e = 0, r = 0; for (let n = 0; n < N; n++) { const d = y[n] - yref[n]; e += d * d; r += yref[n] * yref[n]; } return Math.sqrt(e / r); };

  // pack incoherent 2-bit + naive 2-bit + Q8 (per-32 scale, the engine format)
  const inc = pack2bit(W, N, K, { incoherent: true });
  const nai = pack2bit(W, N, K, { incoherent: false });
  const q8 = new Int8Array(N * K), q8s = new Float32Array(N * nblk);
  for (let n = 0; n < N; n++) for (let b = 0; b < nblk; b++) { let mx = 0; for (let i = 0; i < 32; i++) { const a = Math.abs(W[n * K + b * 32 + i]); if (a > mx) mx = a; } const sca = (mx / 127) || 1e-12; q8s[n * nblk + b] = sca; for (let i = 0; i < 32; i++) { let q = Math.round(W[n * K + b * 32 + i] / sca); if (q > 127) q = 127; else if (q < -127) q = -127; q8[n * K + b * 32 + i] = q; } }

  // GPU pipelines
  const pF = pipe(dev, FWHT_WGSL), p2 = pipe(dev, MM2_WGSL), p8 = pipe(dev, MM8_WGSL);
  // buffers
  const xB = sbuf(dev, x), xrB = obuf(dev, K * 4), sgnB = sbuf(dev, inc.sign), Pf = ubuf(dev, new Uint32Array([K, 0, 0, 0]));
  const qwB = sbuf(dev, inc.qw), scB = sbuf(dev, inc.sc), oB = obuf(dev, N * 4), P2 = ubuf(dev, new Uint32Array([N, K, nblk, 0]));
  const naiqwB = sbuf(dev, nai.qw), naiscB = sbuf(dev, nai.sc), oNB = obuf(dev, N * 4);
  const q8B = sbuf(dev, new Uint8Array(q8.buffer)), q8sB = sbuf(dev, q8s), o8B = obuf(dev, N * 4);

  const bgF = (xin) => dev.createBindGroup({ layout: pF.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: xin } }, { binding: 1, resource: { buffer: sgnB } }, { binding: 2, resource: { buffer: xrB } }, { binding: 3, resource: { buffer: Pf } }] });
  const bg2 = (qw, sc, xin, o) => dev.createBindGroup({ layout: p2.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: qw } }, { binding: 1, resource: { buffer: sc } }, { binding: 2, resource: { buffer: xin } }, { binding: 3, resource: { buffer: o } }, { binding: 4, resource: { buffer: P2 } }] });
  const bg8 = dev.createBindGroup({ layout: p8.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: q8B } }, { binding: 1, resource: { buffer: q8sB } }, { binding: 2, resource: { buffer: xB } }, { binding: 3, resource: { buffer: o8B } }, { binding: 4, resource: { buffer: P2 } }] });

  // ── correctness ──
  const doInc = K <= 4096;                               // single-workgroup FWHT covers K ≤ 4096 (16 KB shared)
  let yInc = null, gpuCpu = null;
  if (doInc) {
    // incoherent path: GPU rotate x→x′, then 2-bit matmul with x′
    { const e = dev.createCommandEncoder(); const p = e.beginComputePass(); p.setPipeline(pF); p.setBindGroup(0, bgF(xB)); p.dispatchWorkgroups(1); p.setPipeline(p2); p.setBindGroup(0, bg2(qwB, scB, xrB, oB)); p.dispatchWorkgroups(N); p.end(); dev.queue.submit([e.finish()]); }
    yInc = await readf32(dev, oB, N);
    // CPU re-derivation of the SAME stored 2-bit weights — independent check the GPU kernel agrees
    const Wrec = unpack2bit(inc.qw, inc.sc, inc.sign, N, K, { incoherent: true });
    const yCpu = new Float32Array(N); for (let n = 0; n < N; n++) { let a = 0; for (let k = 0; k < K; k++) a += Wrec[n * K + k] * x[k]; yCpu[n] = a; }
    let e2 = 0, rr = 0; for (let n = 0; n < N; n++) { const d = yInc[n] - yCpu[n]; e2 += d * d; rr += yCpu[n] * yCpu[n]; } gpuCpu = Math.sqrt(e2 / rr);
  }
  // naive path (no rotation) + Q8 path
  { const e = dev.createCommandEncoder(); const p = e.beginComputePass(); p.setPipeline(p2); p.setBindGroup(0, bg2(naiqwB, naiscB, xB, oNB)); p.dispatchWorkgroups(N); p.end(); dev.queue.submit([e.finish()]); }
  const yNai = await readf32(dev, oNB, N);
  { const e = dev.createCommandEncoder(); const p = e.beginComputePass(); p.setPipeline(p8); p.setBindGroup(0, bg8); p.dispatchWorkgroups(N); p.end(); dev.queue.submit([e.finish()]); }
  const yQ8 = await readf32(dev, o8B, N);

  // ── perf — apples-to-apples: time each MATMUL alone (incoherence rotation measured separately) ──
  // pre-rotate x once so the 2-bit matmul reads x′ without re-running the FWHT in the timed loop.
  if (doInc) { const e = dev.createCommandEncoder(); const p = e.beginComputePass(); p.setPipeline(pF); p.setBindGroup(0, bgF(xB)); p.dispatchWorkgroups(1); p.end(); dev.queue.submit([e.finish()]); }
  const time = async (fn) => { fn(); await dev.queue.onSubmittedWorkDone(); const t0 = performance.now(); for (let i = 0; i < iters; i++) fn(); await dev.queue.onSubmittedWorkDone(); return (performance.now() - t0) / iters; };
  const run2mm = () => { const e = dev.createCommandEncoder(); const p = e.beginComputePass(); p.setPipeline(p2); p.setBindGroup(0, bg2(qwB, scB, doInc ? xrB : xB, oB)); p.dispatchWorkgroups(N); p.end(); dev.queue.submit([e.finish()]); };
  const run8mm = () => { const e = dev.createCommandEncoder(); const p = e.beginComputePass(); p.setPipeline(p8); p.setBindGroup(0, bg8); p.dispatchWorkgroups(N); p.end(); dev.queue.submit([e.finish()]); };
  const runF = () => { const e = dev.createCommandEncoder(); const p = e.beginComputePass(); p.setPipeline(pF); p.setBindGroup(0, bgF(xB)); p.dispatchWorkgroups(1); p.end(); dev.queue.submit([e.finish()]); };
  const ms2 = await time(run2mm), ms8 = await time(run8mm), msF = doInc ? await time(runF) : null;

  const bytes2 = inc.qw.byteLength + inc.sc.byteLength, bytes8 = q8.byteLength + q8s.byteLength;
  const gbps = (b, ms) => (b / 1e9) / (ms / 1e3);
  return {
    N, K, iters,
    err: { incoherent2bit: doInc ? relErr(yInc) : null, naive2bit: relErr(yNai), q8: relErr(yQ8), gpu_vs_cpu_2bit: gpuCpu },
    perf: { ms_2bit_mm: +ms2.toFixed(4), ms_q8_mm: +ms8.toFixed(4), ms_fwht: msF == null ? null : +msF.toFixed(4), matmul_speedup: +(ms8 / ms2).toFixed(2), gbps_2bit: +gbps(bytes2, ms2).toFixed(0), gbps_q8: +gbps(bytes8, ms8).toFixed(0) },
    mem: { MB_2bit: +(bytes2 / 1e6).toFixed(2), MB_q8: +(bytes8 / 1e6).toFixed(2), ratio: +(bytes8 / bytes2).toFixed(2), bits_per_weight: +(bytes2 * 8 / (N * K)).toFixed(2) },
  };
}
