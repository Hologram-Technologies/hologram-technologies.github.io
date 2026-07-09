// holo-qwen35-gpu-real.mjs — the REAL qwen35 9B thinking brain on WebGPU: streams the .holo's quantized weights,
// keeps them packed in VRAM, runs the whole forward on-GPU (no per-op readback — only the final logits come
// back), and generates. Reuses the forge tokenizer (makeTokenizer) + the engine's quantized matvec + the
// parity-verified qwen35 kernels. Every mechanic here is verified against the CPU oracle (which matches HF and
// produces "Paris"): quantized matvec (Q4_K/Q5_K/Q6_K), the v-head block permutation, both mixers, whole model.
//
//   const brain = await loadQwen35Brain({ holoUrl, onProgress });
//   for await (const delta of brain.generate(messages, { maxTokens })) ui.append(delta);
//
// NOTE: full-sequence forward per token (correct; KV-cache incremental decode is the next optimization). The
// 9B needs ~5.6 GB VRAM resident — the device is requested with the adapter's max limits; weak GPUs should be
// gated away (holo-q-think-tier). This is a browser module (WebGPU); verified live, never by eye.

import { createGpuRuntime, MATVECQ4KRAW, MATVECQ5RAW, MATVECQ6KRAW, RMS, SWIGLU, ADD, G } from "./holo-gguf-gpu.mjs";
import { RMSNORM_1P_WGSL, GATED_RMSNORM_WGSL, CONV1D_STEP_WGSL, QWEN_PREP_WGSL, HEAD_NORM_ROPE_WGSL, CAUSAL_GQA_WGSL } from "./holo-qwen35-kernels.mjs";
import { GATED_DELTA_STEP_WGSL } from "./holo-gated-delta-gpu.mjs";
import { openHoloStream } from "../holo-archive.mjs";
import { parseGgufHeader } from "../../qvac-ingest.mjs";
import { makeTokenizer } from "../gguf-forge-tokenizer.mjs";

const RAW = { 12: MATVECQ4KRAW, 13: MATVECQ5RAW, 14: MATVECQ6KRAW };   // ggmlType → raw quantized matvec kernel
const BPB = { 12: 144, 13: 176, 14: 210 };
const EOS = new Set([248046, 248044]);   // qwen35 eos / pad (from meta)

export async function loadQwen35Brain({ holoUrl, onProgress = () => {} }) {
  if (!navigator.gpu) throw new Error("WebGPU not available in this browser");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  const L = adapter.limits;
  const device = await adapter.requestDevice({ requiredLimits: {
    maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxBufferSize: L.maxBufferSize,
    maxStorageBuffersPerShaderStage: Math.min(10, L.maxStorageBuffersPerShaderStage),
  } });
  const rt = createGpuRuntime(device);
  const pipes = { rms1p: pipe(RMSNORM_1P_WGSL), gnorm: pipe(GATED_RMSNORM_WGSL), conv: pipe(CONV1D_STEP_WGSL), prep: pipe(QWEN_PREP_WGSL), hnr: pipe(HEAD_NORM_ROPE_WGSL), gqa: pipe(CAUSAL_GQA_WGSL), gd: pipe(GATED_DELTA_STEP_WGSL), q4: rt.P.q4kraw, q5: rt.P.q5raw, q6: rt.P.q6kraw, rms: rt.P.rms, swiglu: rt.P.swiglu, add: rt.P.add };
  function pipe(code) { return device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } }); }

  // ── stream + parse the .holo ──
  const totalLen = Number((await fetch(holoUrl, { method: "HEAD" })).headers.get("content-length") || 0);
  const rr = async (off, len) => new Uint8Array(await (await fetch(holoUrl, { headers: { Range: `bytes=${off}-${off + len - 1}` } })).arrayBuffer());
  const h = await openHoloStream(rr);
  // ── B1: content-addressed body delivery (fabric commons). Each weight body is κ-addressed, so resolve it
  // OPFS (own-device durable cache — 0 network, offline) → commons/peer (resolveData, κ-route, VERIFIED by
  // re-derivation) → origin (L5-verified by openHoloStream), mirroring every fetched body into OPFS. On a
  // reload the 5.6GB streams from LOCAL disk: ~0 bytes from origin. Fabric-gated; origin path unchanged when off.
  const loadBytes = { origin: 0, cache: 0, peer: 0 };
  const fabricOn = () => { try { return globalThis.holoFabric ? globalThis.holoFabric.enabled !== false : true; } catch (e) { return true; } };
  let _opfsDir = null;
  const opfsDir = async () => { if (_opfsDir === null) { try { const root = await navigator.storage.getDirectory(); _opfsDir = await root.getDirectoryHandle("q-holo-cache", { create: true }); try { navigator.storage.persist && navigator.storage.persist(); } catch (e) {} } catch (e) { _opfsDir = false; } } return _opfsDir; };
  const opfsGet = async (hex) => { try { const d = await opfsDir(); if (!d) return null; const f = await (await d.getFileHandle(hex)).getFile(); return new Uint8Array(await f.arrayBuffer()); } catch (e) { return null; } };
  const opfsPut = async (hex, bytes) => { try { const d = await opfsDir(); if (!d) return; const w = await (await d.getFileHandle(hex, { create: true })).createWritable(); await w.write(bytes); await w.close(); } catch (e) {} };
  const sha256hex = async (bytes) => { const b = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); };
  const origGetBody = h.getBody.bind(h);
  h.getBody = async (kappa) => {
    const hex = String(kappa).split(":").pop();
    if (fabricOn()) {
      const c = await opfsGet(hex); if (c) { loadBytes.cache += c.length; return c; }                                       // own-device durable cache (trusted: we cached L5-verified bytes)
      if (globalThis.resolveData) { try { const b = await globalThis.resolveData(kappa); if (b) { const u = new Uint8Array(b); if (await sha256hex(u) === hex) { loadBytes.peer += u.length; opfsPut(hex, u); return u; } } } catch (e) {} }   // commons/peer — VERIFIED before use
    }
    const b = await origGetBody(kappa); loadBytes.origin += b.length; if (fabricOn()) opfsPut(hex, b);                        // origin (L5-verified) → mirror to OPFS for next time
    return b;
  };
  const { meta, tensors } = parseGgufHeader(h.headerBytes);
  const tok = makeTokenizer(h.headerBytes);
  const info = new Map(tensors.map((t) => [t.name, t]));
  const kByName = new Map(h.order.map((o) => [o.name, String(o.kappa).split(":").pop()]));
  const g = (k) => meta["qwen35." + k];
  const D = {
    d_model: g("embedding_length"), n_layer: g("block_count"), vocab: 248320, ffn: g("feed_forward_length"), eps: g("attention.layer_norm_rms_epsilon") || 1e-6,
    head_k: g("ssm.state_size"), num_k_heads: g("ssm.group_count"), value_dim: g("ssm.inner_size"), conv_k: g("ssm.conv_kernel"),
    n_head: g("attention.head_count"), n_kv: g("attention.head_count_kv"), head_dim: g("attention.key_length"), rope_dim: g("rope.dimension_count"), rope_theta: g("rope.freq_base"), interval: g("full_attention_interval"),
  };
  D.head_v = D.head_k; D.num_v_heads = Math.round(D.value_dim / D.head_v); D.key_dim = D.num_k_heads * D.head_k; D.conv_dim = 2 * D.key_dim + D.value_dim;
  const vperm = (() => { const p = new Int32Array(D.num_v_heads); for (let s = 0; s < D.num_v_heads; s++) p[s] = (s % 2 === 0) ? (s >> 1) : (D.num_v_heads / 2 + ((s - 1) >> 1)); return p; })();

  // ── buffer helpers ──
  const sb = (nFloats) => device.createBuffer({ size: Math.max(16, nFloats * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const wF = (arr) => { const b = device.createBuffer({ size: Math.max(16, arr.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }); device.queue.writeBuffer(b, 0, arr); return b; };   // COPY_SRC: F32 norm/conv/a/dt weights are read back via normW
  const wRaw = (u8) => wF(new Uint32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4));

  // load a weight tensor's raw quantized bytes → GPU buffer (+ optional v-head ROW-block permutation).
  async function loadQ(name, blockRows = 0) {   // v-head row-permute: blockRows = OUTPUT rows per v-head (0 = none)
    const t = info.get(name); let bytes = await h.getBody(kByName.get(name));
    if (blockRows) { const K = t.dims[0], nb = K / 256, rowBytes = nb * BPB[t.ggmlType], blk = blockRows * rowBytes, out = new Uint8Array(bytes.length); for (let s = 0; s < D.num_v_heads; s++) out.set(bytes.subarray(vperm[s] * blk, (vperm[s] + 1) * blk), s * blk); bytes = out; }
    return { buf: wRaw(bytes), type: t.ggmlType, N: t.dims[1], K: t.dims[0] };
  }
  const deqF32 = async (name) => { const { dequantizeExact } = await import("../gguf-forge-dequant.mjs"); const t = info.get(name); return dequantizeExact(t.ggmlType, await h.getBody(kByName.get(name)), t.dims.reduce((a, b) => a * b, 1)); };

  // ── load all weights (with the solved conventions) ──
  onProgress("loading weights…", 0);
  const embed = { t: info.get("token_embd.weight"), bytes: await h.getBody(kByName.get("token_embd.weight")) };   // gathered on host per token
  const lmHead = await loadQ("output.weight");
  const outNorm = wF((await deqF32("output_norm.weight")).map((x) => x - 1));   // baked +1 → (1+(w-1))=w
  const sched = Array.from({ length: D.n_layer }, (_, i) => ((i + 1) % D.interval === 0) ? "attn" : "linear");
  const layers = [];
  for (let Lx = 0; Lx < D.n_layer; Lx++) {
    const N = `blk.${Lx}.`, type = sched[Lx], W = {};
    W.attn_norm = wF((await deqF32(N + "attn_norm.weight")).map((x) => x - 1));
    W.post_attention_norm = wF((await deqF32(N + "post_attention_norm.weight")).map((x) => x - 1));
    W.ffn_gate = await loadQ(N + "ffn_gate.weight"); W.ffn_up = await loadQ(N + "ffn_up.weight"); W.ffn_down = await loadQ(N + "ffn_down.weight");
    if (type === "linear") {
      W.attn_qkv = await loadQ(N + "attn_qkv.weight");       // v-rows permuted below (split path); q/k identity
      W.attn_gate = await loadQ(N + "attn_gate.weight", D.head_v);   // z: 32 v-heads × head_v rows each
      W.ssm_alpha = await loadQ(N + "ssm_alpha.weight", 1); W.ssm_beta = await loadQ(N + "ssm_beta.weight", 1);   // 32 out rows (1/v-head)
      W.ssm_out = await loadQ(N + "ssm_out.weight");          // in-cols v-head-indexed → activation permuted at runtime (linearStep)
      // attn_qkv v-rows: permute just the v-head block ranges (rows keyDim2..end); q/k rows identity
      { const t = info.get(N + "attn_qkv.weight"); let b = await h.getBody(kByName.get(N + "attn_qkv.weight")); const K = t.dims[0], nb = K / 256, rB = nb * BPB[t.ggmlType], vOff = 2 * D.key_dim; const out = Uint8Array.from(b); for (let s = 0; s < D.num_v_heads; s++) for (let r = 0; r < D.head_v; r++) { const dstRow = vOff + s * D.head_v + r, srcRow = vOff + vperm[s] * D.head_v + r; out.set(b.subarray(srcRow * rB, (srcRow + 1) * rB), dstRow * rB); } W.attn_qkv = { buf: wRaw(out), type: t.ggmlType, N: t.dims[1], K }; }
      const aRaw = (await deqF32(N + "ssm_a")); const aPerm = new Float32Array(D.num_v_heads); for (let s = 0; s < D.num_v_heads; s++) aPerm[s] = Math.log(-aRaw[vperm[s]]); W.ssm_a = wF(aPerm);
      const dtRaw = (await deqF32(N + "ssm_dt.bias")); const dtP = new Float32Array(D.num_v_heads); for (let s = 0; s < D.num_v_heads; s++) dtP[s] = dtRaw[vperm[s]]; W.ssm_dt = wF(dtP);
      W.ssm_norm = wF(await deqF32(N + "ssm_norm.weight"));   // RMSNormGated: plain w
      const cwRaw = await deqF32(N + "ssm_conv1d.weight"), C = info.get(N + "ssm_conv1d.weight").dims[1], K = info.get(N + "ssm_conv1d.weight").dims[0];
      const conv = new Float32Array(K * C); for (let c = 0; c < C; c++) for (let j = 0; j < K; j++) conv[j * C + c] = cwRaw[c * K + j];
      const convP = Float32Array.from(conv); for (let j = 0; j < K; j++) for (let s = 0; s < D.num_v_heads; s++) convP.set(conv.subarray(j * C + 2 * D.key_dim + vperm[s] * D.head_v, j * C + 2 * D.key_dim + (vperm[s] + 1) * D.head_v), j * C + 2 * D.key_dim + s * D.head_v); W.ssm_conv1d = wF(convP);
    } else {
      W.attn_q = await loadQ(N + "attn_q.weight"); W.attn_k = await loadQ(N + "attn_k.weight"); W.attn_v = await loadQ(N + "attn_v.weight"); W.attn_output = await loadQ(N + "attn_output.weight");
      W.attn_q_norm = wF((await deqF32(N + "attn_q_norm.weight")).map((x) => x - 1)); W.attn_k_norm = wF((await deqF32(N + "attn_k_norm.weight")).map((x) => x - 1));
    }
    layers.push({ type, W });
    onProgress(`layer ${Lx + 1}/${D.n_layer}`, (Lx + 1) / D.n_layer);
  }

  // RoPE tables (partial, head_dim/2 split): cos/sin length rope_dim, per position.
  function ropeTables(T) { const rd = D.rope_dim, half = rd / 2, inv = new Float32Array(half); for (let i = 0; i < half; i++) inv[i] = 1 / Math.pow(D.rope_theta, (2 * i) / rd); const cos = [], sin = []; for (let t = 0; t < T; t++) { const c = new Float32Array(rd), s = new Float32Array(rd); for (let i = 0; i < half; i++) { const f = t * inv[i]; c[i] = c[i + half] = Math.cos(f); s[i] = s[i + half] = Math.sin(f); } cos.push(c); sin.push(s); } return { cos, sin }; }

  const modelTag = kByName.get("output.weight") || kByName.get("token_embd.weight") || "qwen35-9b";   // a body-κ fingerprint → scopes the answer/KV cache to THIS model
  const ctx = { device, rt, pipes, D, RAW, BPB, embed, lmHead, outNorm, layers, sched, ropeTables, tok, EOS, sb, wF, G, totalLen, onProgress, modelTag };
  const brainMod = await import("./holo-qwen35-gpu-real-forward.mjs");     // readback engine (oracle, == HF)
  const residentMod = await import("./holo-qwen35-resident.mjs");          // on-GPU resident decode (shares the SAME weights)
  const brain = brainMod.makeBrain(ctx);
  brain.resident = residentMod.makeResident(ctx);   // parity-testable side by side, no double VRAM
  const loadStats = () => { const t = loadBytes.origin + loadBytes.cache + loadBytes.peer; return { ...loadBytes, total: t, fromOriginPct: t ? Math.round((loadBytes.origin / t) * 100) : 0 }; };
  brain.loadStats = loadStats; brain.resident.loadStats = loadStats;
  return brain;
}
