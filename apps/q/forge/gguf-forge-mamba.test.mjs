// Mamba-1 end-to-end test. Build a tiny mamba with random F32 weights, forge ->
// synthesize -> run forward, and compare logits to an INDEPENDENT float64 reference
// that reproduces mamba.cpp / mamba-base.cpp build_mamba_layer: RMSNorm -> in_proj
// split [x|z] -> causal conv1d(+bias,silu) with recurrent conv state -> x_proj
// (Δt,B,C) -> dt_proj+bias -> selective scan with recurrent ssm state -> D skip ->
// z-gate(silu) -> out_proj -> residual; no attention, no FFN. A 4-token prompt
// exercises the recurrent state across positions (conv window fill + scan carry).
// Plus a structural check against a real mamba header when present.

import assert from "node:assert";
import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";
import { parseGgufHeader } from "../qvac-ingest.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

// ── tiny dims ──
const D = 8, DI = 16, DS = 4, DC = 4, DT = 3, VOCAB = 5, NL = 2, EPS = 1e-6;

function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const r = prng(99);
const randF = (n, scale = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * scale; return a; };
const normW = (n) => randF(n, 1).map((x) => Math.abs(x) + 0.5);

const L = [];
for (let il = 0; il < NL; il++) L.push({
  attn_norm: normW(D), ssm_in: randF(2 * DI * D), conv1d: randF(DI * DC), conv1d_b: randF(DI),
  ssm_x: randF((DT + 2 * DS) * DI), ssm_dt: randF(DI * DT), ssm_dt_b: randF(DI),
  ssm_a: randF(DS * DI, 1).map((x) => -(Math.abs(x) + 0.1)), ssm_d: randF(DI), ssm_out: randF(D * DI),
});
const w = { tok_embd: randF(VOCAB * D), output_norm: normW(D) };

function buildGguf(meta, tensors) {
  const ALIGN = 32; let off = 0;
  const infos = tensors.map((t) => { const o = off; off = Math.ceil((o + t.bytes.length) / ALIGN) * ALIGN; return { ...t, offset: o }; });
  let parts = [], len = 0; const push = (b) => { parts.push(b); len += b.length; };
  const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); push(b); };
  const f32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, v >>> 0, true); dv.setUint32(4, Math.floor(v / 4294967296), true); push(b); };
  const str = (s) => { const e = new TextEncoder().encode(s); u64(e.length); push(e); };
  push(new TextEncoder().encode("GGUF")); u32(3); u64(tensors.length); u64(Object.keys(meta).length);
  for (const [k, val] of Object.entries(meta)) { str(k); if (typeof val === "string") { u32(8); str(val); } else if (Number.isInteger(val) && val >= 0 && val < 4294967296) { u32(4); u32(val); } else { u32(6); f32(val); } }
  for (const ti of infos) { str(ti.name); u32(ti.dims.length); for (const d of ti.dims) u64(d); u32(ti.type); u64(ti.offset); }
  if (len % ALIGN) push(new Uint8Array(ALIGN - (len % ALIGN)));
  const dataStart = len;
  for (const ti of infos) { while (len < dataStart + ti.offset) push(new Uint8Array(1)); push(ti.bytes); }
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
const f32bytes = (arr) => new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength));

const meta = {
  "general.architecture": "mamba", "mamba.block_count": NL, "mamba.embedding_length": D,
  "mamba.ssm.conv_kernel": DC, "mamba.ssm.inner_size": DI, "mamba.ssm.state_size": DS, "mamba.ssm.time_step_rank": DT,
  "mamba.attention.layer_norm_rms_epsilon": EPS,
};
const tensors = [["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm]];
for (let il = 0; il < NL; il++) { const p = `blk.${il}.`, x = L[il]; tensors.push(
  [p + "attn_norm.weight", [D], x.attn_norm], [p + "ssm_in.weight", [D, 2 * DI], x.ssm_in],
  [p + "ssm_conv1d.weight", [DC, DI], x.conv1d], [p + "ssm_conv1d.bias", [DI], x.conv1d_b],
  [p + "ssm_x.weight", [DI, DT + 2 * DS], x.ssm_x], [p + "ssm_dt.weight", [DT, DI], x.ssm_dt], [p + "ssm_dt.bias", [DI], x.ssm_dt_b],
  [p + "ssm_a", [DS, DI], x.ssm_a], [p + "ssm_d", [DI], x.ssm_d], [p + "ssm_out.weight", [DI, D], x.ssm_out]);
}
const ggufTensors = tensors.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32bytes(arr) }));

// ── independent float64 reference forward (reproduces build_mamba_layer) ──
function matvecRef(W, x, K, N) { const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; for (let k = 0; k < K; k++) s += W[n * K + k] * x[k]; y[n] = s; } return y; }
function rmsRef(x, wt) { let s = 0; for (const v of x) s += v * v; const sc = 1 / Math.sqrt(s / x.length + EPS); return Array.from(x, (v, i) => v * sc * wt[i]); }
const siluRef = (v) => v / (1 + Math.exp(-v));
const softplusRef = (v) => (v > 20 ? v : Math.log1p(Math.exp(v)));
const addV = (a, b) => a.map((x, i) => x + b[i]);

function referenceForward(tokens) {
  const H = tokens.map((tk) => Array.from(w.tok_embd.slice(tk * D, tk * D + D)));
  const convSt = Array.from({ length: NL }, () => new Float64Array(DI * (DC - 1)));
  const ssmSt = Array.from({ length: NL }, () => new Float64Array(DI * DS));
  for (let pos = 0; pos < tokens.length; pos++) {
    let h = H[pos];
    for (let il = 0; il < NL; il++) {
      const x = L[il], cs = convSt[il], ss = ssmSt[il];
      const xn = rmsRef(h, x.attn_norm);
      const xz = matvecRef(x.ssm_in, xn, D, 2 * DI);
      const xin = xz.slice(0, DI), z = xz.slice(DI, 2 * DI);
      // causal conv1d (+bias, silu), slide conv state
      const xc = new Array(DI);
      for (let ch = 0; ch < DI; ch++) {
        const base = ch * (DC - 1), wb = ch * DC; let s = 0;
        for (let k = 0; k < DC - 1; k++) s += cs[base + k] * x.conv1d[wb + k];
        s += xin[ch] * x.conv1d[wb + DC - 1];
        xc[ch] = siluRef(s + x.conv1d_b[ch]);
        for (let k = 0; k < DC - 2; k++) cs[base + k] = cs[base + k + 1];
        cs[base + DC - 2] = xin[ch];
      }
      const xdb = matvecRef(x.ssm_x, xc, DI, DT + 2 * DS);
      const B = xdb.slice(DT, DT + DS), C = xdb.slice(DT + DS, DT + 2 * DS);
      const dt = addV(Array.from(matvecRef(x.ssm_dt, xdb.slice(0, DT), DT, DI)), Array.from(x.ssm_dt_b));
      const y = new Array(DI);
      for (let ch = 0; ch < DI; ch++) {
        const dtsp = softplusRef(dt[ch]), xdt = xc[ch] * dtsp, sb = ch * DS; let acc = 0;
        for (let i0 = 0; i0 < DS; i0++) { const st = ss[sb + i0] * Math.exp(dtsp * x.ssm_a[sb + i0]) + B[i0] * xdt; acc += st * C[i0]; ss[sb + i0] = st; }
        y[ch] = siluRef(z[ch]) * (acc + xc[ch] * x.ssm_d[ch]);
      }
      h = addV(Array.from(matvecRef(x.ssm_out, y, DI, D)), h); // out_proj + residual
      H[pos] = h;
    }
  }
  const fn = rmsRef(H[tokens.length - 1], w.output_norm);
  return Array.from(matvecRef(w.tok_embd, fn, D, VOCAB)); // tied lm_head
}

const f = forgeGguf(buildGguf(meta, ggufTensors));
const graph = synthesizeGraph(f.plan);
const store = { get: (hex) => f.blocks.get(hex) };
const tokens = [3, 1, 4, 2];

t("graph is family=ssm, correct op count + all weights resolve", () => {
  assert.strictEqual(graph.family, "ssm", graph.reason);
  assert.strictEqual(graph.stats.n_layer, NL);
  assert.deepStrictEqual([graph.stats.d_conv, graph.stats.d_inner, graph.stats.d_state, graph.stats.dt_rank], [DC, DI, DS, DT]);
  assert.strictEqual(graph.stats.ops, 3 + 3 * NL);                  // embd + (norm+mamba+add)*L + result_norm + lm_head
  assert.strictEqual(graph.stats.weightsUsed, tensors.length);
  const hist = {}; for (const o of graph.ops) hist[o.op] = (hist[o.op] || 0) + 1;
  assert.strictEqual(hist.mamba, NL);
});

t("executor logits match independent f64 reference (mamba forward, recurrent state)", () => {
  const got = forward(f.plan, graph, store, tokens), ref = referenceForward(tokens);
  assert.strictEqual(got.length, VOCAB);
  for (let i = 0; i < VOCAB; i++) {
    const rel = Math.abs(got[i] - ref[i]) / (Math.abs(ref[i]) + 1e-4);
    assert.ok(rel < 5e-3, `logit ${i}: got ${got[i]} ref ${ref[i]} rel ${rel}`);
  }
  console.log(`      logits: [${Array.from(got).map((x) => x.toFixed(4)).join(", ")}]`);
});

t("argmax (greedy token) matches reference", () => {
  const am = (a) => a.indexOf(Math.max(...a));
  assert.strictEqual(am(Array.from(forward(f.plan, graph, store, tokens))), am(referenceForward(tokens)));
});

t("executor is deterministic", () => {
  const a = forward(f.plan, graph, store, tokens), b = forward(f.plan, graph, store, tokens);
  for (let i = 0; i < VOCAB; i++) assert.strictEqual(a[i], b[i]);
});

// ── structural check against a real mamba header (skipped if absent) ──
const REALS = [
  "C:/Users/pavel/.lmstudio/models/lmstudio-community/mamba-2.8b-GGUF/mamba-2.8b-Q4_K_M.gguf",
  `${process.env.HOME || ""}/.cache/lm-studio/models/mamba.gguf`,
];
t("real mamba header: family=ssm, every tensor resolves, ssm hparams correct", () => {
  const path = REALS.find((p) => existsSync(p));
  if (!path) { console.log("      (skipped — no mamba model present)"); return; }
  const fd = openSync(path, "r"); const buf = Buffer.alloc(64 * 1024 * 1024); readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
  const h = parseGgufHeader(new Uint8Array(buf));
  const plan = { arch: h.meta["general.architecture"], meta: h.meta,
    tensors: h.tensors.map((x) => ({ name: x.name, dims: x.dims, type: x.ggmlType, typeName: String(x.ggmlType), kappa: "sha256:" + "0".repeat(64) })) };
  const g = synthesizeGraph(plan);
  assert.strictEqual(g.family, "ssm", g.reason);
  assert.strictEqual(g.stats.weightsUsed, h.tensors.length, "every tensor referenced");
  console.log(`      ${plan.arch}: ${g.stats.n_layer}L d_inner=${g.stats.d_inner} d_state=${g.stats.d_state} d_conv=${g.stats.d_conv}, ${g.stats.weightsUsed}/${h.tensors.length} tensors`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
