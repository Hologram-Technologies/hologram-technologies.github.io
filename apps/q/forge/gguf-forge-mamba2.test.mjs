// Mamba-2 end-to-end test. Build a tiny mamba2 with random F32 weights, forge ->
// synthesize -> run forward, and compare logits to an INDEPENDENT float64 reference
// reproducing build_mamba2_layer: RMSNorm -> in_proj split [z|xBC|Δt] -> conv1d over
// xBC (+bias,silu) -> split x,B,C -> Δt+bias -> scalar-decay selective scan (recurrent
// state) -> D skip -> z-gate -> grouped RMSNorm -> out_proj -> residual. n_head heads
// of head_dim, B/C shared per group. 4 tokens exercise the recurrent state.

import assert from "node:assert";
import { forgeGguf } from "./gguf-forge.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { GGML } from "./gguf-forge-dequant.mjs";

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ok  " + name); } catch (e) { fail++; console.log("FAIL  " + name + "\n      " + e.message); } };

// ── tiny dims ──  d_inner=2*D; n_head=DT; head_dim=d_inner/n_head; conv covers x,B,C
const D = 8, DI = 16, DS = 4, DC = 4, NH = 4, HD = DI / NH, NG = 2, VOCAB = 5, NL = 2, EPS = 1e-6;
const DINPROJ = 2 * DI + 2 * NG * DS + NH;     // 52
const CONVCH = DI + 2 * NG * DS;               // 32
const GS = DI / NG;                            // grouped-norm group size

function prng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; }; }
const r = prng(2025);
const randF = (n, scale = 0.3) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r() * scale; return a; };
const normW = (n) => randF(n, 1).map((x) => Math.abs(x) + 0.5);

const L = [];
for (let il = 0; il < NL; il++) L.push({
  attn_norm: normW(D), ssm_in: randF(DINPROJ * D), conv1d: randF(CONVCH * DC), conv1d_b: randF(CONVCH),
  ssm_dt_b: randF(NH), ssm_a: randF(NH, 1).map((x) => -(Math.abs(x) + 0.1)), ssm_d: randF(NH),
  ssm_norm: normW(DI), ssm_out: randF(D * DI),
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
  "general.architecture": "mamba2", "mamba2.block_count": NL, "mamba2.embedding_length": D,
  "mamba2.ssm.conv_kernel": DC, "mamba2.ssm.inner_size": DI, "mamba2.ssm.state_size": DS,
  "mamba2.ssm.time_step_rank": NH, "mamba2.ssm.group_count": NG, "mamba2.attention.layer_norm_rms_epsilon": EPS,
};
const tensors = [["token_embd.weight", [D, VOCAB], w.tok_embd], ["output_norm.weight", [D], w.output_norm]];
for (let il = 0; il < NL; il++) { const p = `blk.${il}.`, x = L[il]; tensors.push(
  [p + "attn_norm.weight", [D], x.attn_norm], [p + "ssm_in.weight", [D, DINPROJ], x.ssm_in],
  [p + "ssm_conv1d.weight", [DC, CONVCH], x.conv1d], [p + "ssm_conv1d.bias", [CONVCH], x.conv1d_b],
  [p + "ssm_dt.bias", [NH], x.ssm_dt_b], [p + "ssm_a", [1, NH], x.ssm_a], [p + "ssm_d", [1, NH], x.ssm_d],
  [p + "ssm_norm.weight", [GS, NG], x.ssm_norm], [p + "ssm_out.weight", [DI, D], x.ssm_out]);
}
const ggufTensors = tensors.map(([name, dims, arr]) => ({ name, type: GGML.F32, dims, bytes: f32bytes(arr) }));

// ── independent float64 reference forward (reproduces build_mamba2_layer) ──
function matvecRef(W, x, K, N) { const y = new Float64Array(N); for (let n = 0; n < N; n++) { let s = 0; for (let k = 0; k < K; k++) s += W[n * K + k] * x[k]; y[n] = s; } return y; }
function rmsRef(x, wt, off = 0) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; const sc = 1 / Math.sqrt(s / x.length + EPS); return Array.from(x, (v, i) => v * sc * wt[off + i]); }
const siluRef = (v) => v / (1 + Math.exp(-v));
const softplusRef = (v) => (v > 20 ? v : Math.log1p(Math.exp(v)));
const addV = (a, b) => a.map((x, i) => x + b[i]);

function referenceForward(tokens) {
  const H = tokens.map((tk) => Array.from(w.tok_embd.slice(tk * D, tk * D + D)));
  const convSt = Array.from({ length: NL }, () => new Float64Array(CONVCH * (DC - 1)));
  const ssmSt = Array.from({ length: NL }, () => new Float64Array(NH * HD * DS));
  for (let pos = 0; pos < tokens.length; pos++) {
    let h = H[pos];
    for (let il = 0; il < NL; il++) {
      const lw = L[il], cs = convSt[il], ss = ssmSt[il];
      const xn = rmsRef(h, lw.attn_norm);
      const zxBCdt = matvecRef(lw.ssm_in, xn, D, DINPROJ);
      const z = zxBCdt.slice(0, DI), xBC = zxBCdt.slice(DI, DI + CONVCH), dtRaw = zxBCdt.slice(DI + CONVCH, DI + CONVCH + NH);
      // conv1d over xBC, +bias, silu, slide state
      const xbc = new Array(CONVCH);
      for (let ch = 0; ch < CONVCH; ch++) {
        const base = ch * (DC - 1), wb = ch * DC; let s = 0;
        for (let k = 0; k < DC - 1; k++) s += cs[base + k] * lw.conv1d[wb + k];
        s += xBC[ch] * lw.conv1d[wb + DC - 1];
        xbc[ch] = siluRef(s + lw.conv1d_b[ch]);
        for (let k = 0; k < DC - 2; k++) cs[base + k] = cs[base + k + 1];
        cs[base + DC - 2] = xBC[ch];
      }
      const x = xbc.slice(0, DI), B = xbc.slice(DI, DI + NG * DS), C = xbc.slice(DI + NG * DS, DI + 2 * NG * DS);
      const dt = addV(dtRaw, Array.from(lw.ssm_dt_b));
      // scalar-decay scan
      const y = new Array(DI);
      for (let hh = 0; hh < NH; hh++) {
        const dtsp = softplusRef(dt[hh]), dA = Math.exp(dtsp * lw.ssm_a[hh]), g = Math.floor(hh / (NH / NG));
        for (let i1 = 0; i1 < HD; i1++) {
          const ii = i1 + hh * HD, xdt = x[ii] * dtsp, sb = ii * DS, gb = g * DS; let acc = 0;
          for (let i0 = 0; i0 < DS; i0++) { const st = ss[sb + i0] * dA + B[gb + i0] * xdt; acc += st * C[gb + i0]; ss[sb + i0] = st; }
          y[ii] = siluRef(z[ii]) * (acc + x[ii] * lw.ssm_d[hh]); // D skip + z-gate
        }
      }
      // grouped RMSNorm (per group of GS), then out_proj + residual
      const yn = new Array(DI);
      for (let gp = 0; gp < NG; gp++) { const n = rmsRef(y.slice(gp * GS, (gp + 1) * GS), lw.ssm_norm, gp * GS); for (let j = 0; j < GS; j++) yn[gp * GS + j] = n[j]; }
      h = addV(Array.from(matvecRef(lw.ssm_out, yn, DI, D)), h);
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

t("graph is family=ssm (mamba2), correct shapes + all weights resolve", () => {
  assert.strictEqual(graph.family, "ssm", graph.reason);
  assert.strictEqual(graph.stats.mamba2, true);
  assert.deepStrictEqual([graph.stats.n_head, graph.stats.head_dim, graph.stats.n_group], [NH, HD, NG]);
  assert.strictEqual(graph.stats.ops, 3 + 3 * NL);
  assert.strictEqual(graph.stats.weightsUsed, tensors.length);
  const hist = {}; for (const o of graph.ops) hist[o.op] = (hist[o.op] || 0) + 1;
  assert.strictEqual(hist.mamba2, NL);
});

t("executor logits match independent f64 reference (mamba2 forward)", () => {
  const got = forward(f.plan, graph, store, tokens), ref = referenceForward(tokens);
  assert.strictEqual(got.length, VOCAB);
  for (let i = 0; i < VOCAB; i++) {
    const rel = Math.abs(got[i] - ref[i]) / (Math.abs(ref[i]) + 1e-4);
    assert.ok(rel < 5e-3, `logit ${i}: got ${got[i]} ref ${ref[i]} rel ${rel}`);
  }
  console.log(`      logits: [${Array.from(got).map((x) => x.toFixed(4)).join(", ")}]`);
});

t("argmax matches reference + deterministic", () => {
  const am = (a) => a.indexOf(Math.max(...a));
  const a = forward(f.plan, graph, store, tokens), b = forward(f.plan, graph, store, tokens);
  assert.strictEqual(am(Array.from(a)), am(referenceForward(tokens)));
  for (let i = 0; i < VOCAB; i++) assert.strictEqual(a[i], b[i]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
