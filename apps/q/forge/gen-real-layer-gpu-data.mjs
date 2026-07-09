// gen-real-layer-gpu-data.mjs — REAL DeepSeek-V2-Lite oracle export for the GPU real-weight witness.
//
// Runs the CPU Tier-A `forward` (bit-exact to llama.cpp on this model) once over a short prompt,
// capturing layer-1 (first MoE layer) I/O + the layer's REAL K-quant weight bytes, so the browser can
// run the NEW GPU kernels (Q4_K/Q8_0 mul_mat_id MoE with real 64/6 routing + 2×shared, Q4_K MLA matvec)
// over identical real inputs and match the oracle. Writes gpu/_qtest/real-layer.{json,bin}. Slow (scans +
// decodes a 10 GB model) — run in background. Node.
import { openSync, readSync, statSync, closeSync } from "node:fs";
import { writeFileSync, mkdirSync } from "node:fs";
import { forgeGgufScan } from "./gguf-forge.mjs";
import { makeDiskStore } from "./gguf-forge-kstore.mjs";
import { synthesizeGraph } from "./gguf-forge-graph.mjs";
import { forward } from "./gguf-forge-exec.mjs";
import { loadExpertSlice } from "./gguf-forge-expert-dir.mjs";
import { makeTokenizer } from "./gguf-forge-tokenizer.mjs";

const MODEL = ".models/deepseek-v2-lite-q4_k_m.gguf";
const MiB = 1048576, hexOf = (k) => String(k).split(":").pop();
const t0 = Date.now(), el = () => ((Date.now() - t0) / 1000).toFixed(0);
const fd = openSync(MODEL, "r"), size = statSync(MODEL).size;
const rr = (off, len) => { const b = Buffer.allocUnsafe(len); let g = 0; while (g < len) { const n = readSync(fd, b, g, len - g, off + g); if (n <= 0) break; g += n; } return new Uint8Array(b.buffer, b.byteOffset, len); };
const header = rr(0, Math.min(size, 48 * MiB));

console.log(`[${el()}s] scanning ${(size / 1024 / MiB).toFixed(2)} GiB (hashing each tensor once)…`);
const f = await forgeGgufScan(rr, { headerBytes: header });
console.log(`[${el()}s] scanned. arch=${f.arch}`);
const g = synthesizeGraph(f.plan);
const store = makeDiskStore({ fd, dir: f.dir, budgetBytes: 3 << 30 });
const fastload = (st, k) => { const b = st.get(hexOf(k)); if (b === undefined) throw new Error("κ not found " + k); return b; };
const tok = makeTokenizer(header);

const PROMPT = "The capital of Germany is";
const ids = tok.encode(PROMPT, { addSpecial: false, parseSpecial: false });
console.log(`[${el()}s] prompt "${PROMPT}" → ${ids.length} tokens [${ids}]; running CPU forward (dbg)…`);

const cap = {};
const dbg = (label, arr, p) => { (cap[label] ||= [])[p] = Array.from(arr); };
const logits = forward(f.plan, g, store, ids, { load: fastload, expertDir: f.expertDir, dbg });
const T = ids.length, LP = T - 1;
console.log(`[${el()}s] forward done. layers=${g.stats.n_layer} experts=${g.stats.n_expert}/${g.stats.n_expert_used}`);

// find layer-1 op attrs (first MoE layer = leading_dense=1)
const L = 1;
const mlaOp = g.ops.find((o) => o.op === "mla_attn" && o.out.startsWith(`l${L}.`));
const moeOp = g.ops.find((o) => o.op === "ffn_moe" && o.out.startsWith(`l${L}.`));
if (!moeOp) throw new Error("no ffn_moe at layer " + L);
const A = mlaOp.attrs, M = moeOp.attrs;
const W = (kap) => { for (const nm in g.weights) if (g.weights[nm].kappa === kap) return g.weights[nm]; return null; };
// op.w values are κ strings; map to descriptor for dims/type
const desc = (kap) => { const w = W(kap); return { kappa: kap, dims: w.dims, type: w.type, typeName: w.typeName }; };

// ── pack real raw weight bytes into one bin + manifest ──
const chunks = []; let binLen = 0; const man = {};
const put = (name, bytes) => { man[name] = { off: binLen, len: bytes.byteLength }; chunks.push(bytes); binLen += bytes.byteLength; };

// MLA: attn_q (Q4_K) — witness a real Q4_K matvec at real dims (2048→3072)
const dq = desc(mlaOp.w.q);
put("attn_q", fastload(store, mlaOp.w.q));

// MoE: routed experts' gate/up (Q4_K) + down (Q8_0) slices, + shared gate/up/down
const sel = cap[`l${L}.moesel`][LP].map((x) => x | 0);
const wts = cap[`l${L}.moewt`][LP];
const dGate = desc(moeOp.w.gate_exps), dUp = desc(moeOp.w.up_exps), dDown = desc(moeOp.w.down_exps);
for (let i = 0; i < sel.length; i++) {
  const e = sel[i];
  put(`gate_${i}`, loadExpertSlice(store, f.expertDir, "blk." + L + ".ffn_gate_exps.weight", e, fastload));
  put(`up_${i}`, loadExpertSlice(store, f.expertDir, "blk." + L + ".ffn_up_exps.weight", e, fastload));
  put(`down_${i}`, loadExpertSlice(store, f.expertDir, "blk." + L + ".ffn_down_exps.weight", e, fastload));
}
const dSg = desc(moeOp.w.gate_shexp), dSu = desc(moeOp.w.up_shexp), dSd = desc(moeOp.w.down_shexp);
put("sgate", fastload(store, moeOp.w.gate_shexp));
put("sup", fastload(store, moeOp.w.up_shexp));
put("sdown", fastload(store, moeOp.w.down_shexp));

const bin = new Uint8Array(binLen); { let o = 0; for (const c of chunks) { bin.set(c, o); o += c.byteLength; } }

const moeOut = cap[`l${L}.moe_out`][LP], shexp = cap[`l${L}.shexp`][LP];
const final = moeOut.map((v, j) => v + shexp[j]);   // DeepSeek ungated shared (a.sharedGate===false)

mkdirSync("gpu/_qtest", { recursive: true });
writeFileSync("gpu/_qtest/real-layer.bin", Buffer.from(bin.buffer, bin.byteOffset, bin.byteLength));
const argmax = (a) => { let m = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[m]) m = i; return m; };
writeFileSync("gpu/_qtest/real-layer.json", JSON.stringify({
  model: "deepseek-v2-lite-q4_k_m", layer: L, ids, promptTokens: T,
  cfg: { D: g.stats.n_embd || A.n_embd || 2048, FF: dGate.dims[1], E: dGate.dims[2], USED: sel.length,
    gating: M.gating, normW: M.normW, wScale: M.wScale, sharedGate: M.sharedGate },
  moe: {
    x: cap[`l${L}.moe_in`][LP], selected: sel, weights: wts,
    gate_inp: Array.from(fastloadF32(store, moeOp.w.gate_inp)),
    gateType: dGate.type, upType: dUp.type, downType: dDown.type,
    sgateType: dSg.type, supType: dSu.type, sdownType: dSd.type,
    gateN: dGate.dims[1], gateK: dGate.dims[0], downN: dDown.dims[1], downK: dDown.dims[0],
    sgateN: dSg.dims[1], sgateK: dSg.dims[0], sdownN: dSd.dims[1], sdownK: dSd.dims[0],
    expected: final, moe_out: moeOut, shexp,
  },
  attnQ: { x: cap[`l${L}.mla_in`][LP], expected: cap[`l${L}.q`][LP], type: dq.type, N: dq.dims[1], K: dq.dims[0] },
  manifest: man, logits: Array.from(logits), argmax: argmax(logits),
}));
console.log(`[${el()}s] wrote gpu/_qtest/real-layer.{json,bin} (${(binLen / MiB).toFixed(1)} MiB bin)`);
console.log(`  layer ${L}: MoE ${sel.length}/${dGate.dims[2]} experts [${sel}] gate/up=${dGate.typeName || dGate.type} down=${dDown.type}`);
console.log(`  gen argmax=${argmax(logits)}  ("${tok.decode([argmax(logits)]).replace(/\n/g, "\\n")}")`);
closeSync(fd);

// helper: dequantize an F32 (or any) small weight to Float32Array via the store
function fastloadF32(st, kap) { const w = W(kap); const bytes = fastload(st, kap); if (w.type === 0) return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4); throw new Error("gate_inp expected F32, got type " + w.type); }
