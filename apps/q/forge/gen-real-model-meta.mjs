// gen-real-model-meta.mjs — export everything the BROWSER GPU executor needs to run the real
// DeepSeek-V2-Lite forward by streaming weights from the served .gguf (HTTP Range + WebCrypto verify).
//
// Exports graph ops + weight descriptors (κ/type/dims) + dir (κ→file offset) + expert directory + precomputed
// YaRN uniforms + the CPU oracle (integer-dot argmax == llama.cpp "Berlin", AND a float-dequant-dot trace that
// the GPU raw kernels match tightly per-op). Writes gpu/_qtest/real-model.json. Slow — run in background.
import { openSync, readSync, statSync, closeSync, writeFileSync, mkdirSync } from "node:fs";
import { forgeGgufScan } from "./gguf-forge.mjs";
import { makeDiskStore } from "./gguf-forge-kstore.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { makeTokenizer } from "./gguf-forge-tokenizer.mjs";

const MODEL = ".models/deepseek-v2-lite-q4_k_m.gguf";
const MODEL_URL = "/holo-apps/apps/q/forge/.models/deepseek-v2-lite-q4_k_m.gguf";
const MiB = 1048576, hexOf = (k) => String(k).split(":").pop();
const t0 = Date.now(), el = () => ((Date.now() - t0) / 1000).toFixed(0);
const fd = openSync(MODEL, "r"), size = statSync(MODEL).size;
const rr = (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(fd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };
const header = rr(0, Math.min(size, 48 * MiB));

console.log(`[${el()}s] scanning…`);
const f = await forgeGgufScan(rr, { headerBytes: header });
const g = synthesizeGraph(f.plan);
const store = makeDiskStore({ fd, dir: f.dir, budgetBytes: 3 << 30 });
const fastload = (st, k) => { const b = st.get(hexOf(k)); if (b === undefined) throw new Error("κ not found " + k); return b; };
const tok = makeTokenizer(header);
const ids = tok.encode("The capital of Germany is", { addSpecial: false, parseSpecial: false });
console.log(`[${el()}s] scanned. family=${g.family} layers=${g.stats.n_layer} ids=[${ids}]`);

// YaRN uniforms (mirror gguf-forge-exec mla_attn YaRN branch) — computed once, shipped to the browser.
const mla = g.ops.find((o) => o.op === "mla_attn");
const A = mla.attrs, HK = A.n_embd_head_k, ROPE = A.qk_rope, fb = A.freq_base;
function yarnUniforms(rope, freqBase, factor, origCtx, logMul) {
  const freqScale = 1 / factor, ext = 1.0, lf = Math.log(factor);
  const corrDim = (beta) => rope * Math.log(origCtx / (beta * 2 * Math.PI)) / (2 * Math.log(freqBase));
  const lo = Math.max(0, Math.floor(corrDim(32))), hi = Math.min(rope - 1, Math.ceil(corrDim(1)));
  const getMscale = (s, m) => s <= 1 ? 1 : (0.1 * m * Math.log(s) + 1);
  const mAll = logMul, mSc = (logMul !== 0 && mAll !== 1) ? mAll : 1;
  let attnFactor = logMul !== 0 ? getMscale(factor, mSc) / getMscale(factor, mAll) : getMscale(factor, 1);
  if (ext !== 0) attnFactor *= 1 / (1 + 0.1 * lf);
  const ropeMscale = ext !== 0 ? attnFactor * (1 + 0.1 * lf) : attnFactor;
  const kqMscale = attnFactor * (1 + 0.1 * lf) * (1 + 0.1 * logMul * lf);
  return { freqScale, extFactor: ext, lo, hi, mscale: ropeMscale, kqScale: (kqMscale * kqMscale) / Math.sqrt(HK) };
}
const yarn = A.ropeScaling === "yarn" ? yarnUniforms(ROPE, fb, A.yarnFactor, A.yarnOrigCtx, A.yarn_log_mul || 0) : null;

// weight descriptors + dir (κ→file offset) — the browser range-fetches bytes by these.
const weights = {}; for (const nm in g.weights) { const w = g.weights[nm]; weights[nm] = { hex: hexOf(w.kappa), type: w.type, dims: w.dims }; }
const dir = {}; for (const hx in f.dir) dir[hx] = { off: f.dir[hx].fileOffset, len: f.dir[hx].len };
const expertMeta = {};
for (const nm in f.expertDir.tensors) { const td = f.expertDir.tensors[nm]; expertMeta[nm] = { stride: td.stride, wholeHex: hexOf(g.weights[nm].kappa), experts: td.experts.map((e) => hexOf(e.kappa)) }; }

// ── CPU oracle: integer-dot (== llama.cpp) argmax, then float-dequant-dot trace (matches GPU raw kernels) ──
console.log(`[${el()}s] CPU forward (integer dot)…`);
const logitsInt = forward(f.plan, g, store, ids, { load: fastload, expertDir: f.expertDir });
const argmax = (a) => { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; };
const expectedInt = argmax(logitsInt);
console.log(`[${el()}s] integer argmax=${expectedInt} ("${tok.decode([expectedInt]).replace(/\n/g, "\\n")}")`);

globalThis.__HOLO_FORCE_FLOAT_DEQUANT = true;
const keep = /^(h|e|result_norm|logits)$|^l\d+\.out$/;   // per-layer residual + endpoints (localization)
const trace = {};
const dbg = (label, arr, p) => { if (p === ids.length - 1 && keep.test(label)) trace[label] = Array.from(arr); };
console.log(`[${el()}s] CPU forward (FLOAT dequant dot)…`);
const logitsFloat = forward(f.plan, g, store, ids, { load: fastload, expertDir: f.expertDir, dbg });
globalThis.__HOLO_FORCE_FLOAT_DEQUANT = false;
const floatArgmax = argmax(logitsFloat);
console.log(`[${el()}s] float argmax=${floatArgmax} ("${tok.decode([floatArgmax]).replace(/\n/g, "\\n")}")  (int was ${expectedInt})`);

mkdirSync("gpu/_qtest", { recursive: true });
writeFileSync("gpu/_qtest/real-model.json", JSON.stringify({
  modelUrl: MODEL_URL, ids, vocab: g.weights["output.weight"].dims[1],
  cfg: { nLayer: g.stats.n_layer, D: g.weights["token_embd.weight"].dims[0], NH: A.n_head, HK: A.n_embd_head_k, HV: A.n_embd_head_v,
    ROPE: A.qk_rope, NOPE: A.qk_nope, KVL: A.kv_lora, lite: !!A.lite, leadingDense: g.stats.leading_dense ?? 1,
    E: g.stats.n_expert, USED: g.stats.n_expert_used, eps: A.eps, freqBase: fb, yarn, kqScalePlain: 1 / Math.sqrt(HK) },
  ops: g.ops, weights, dir, expertMeta,
  expectedInt, floatArgmax, floatLogits: Array.from(logitsFloat), trace,
}));
console.log(`[${el()}s] wrote gpu/_qtest/real-model.json — ${Object.keys(weights).length} weights, ${Object.keys(expertMeta).length} expert tensors, trace ${Object.keys(trace).length} ops`);
closeSync(fd);
