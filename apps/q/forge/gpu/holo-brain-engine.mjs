// holo-brain-engine.mjs — Q's conversational brain over a PRECOMPILED .holo, on the QVAC WebGPU runtime.
//
// Loads a .holo through the UNIFIED κ-stream loader (openGgufHoloStream): per-κ Range fetch + per-block
// WebCrypto SHA-256 (L5), the persistent content store (OPFS "holo-kappa", cross-model dedup) and
// head-persist — so head + bodies are 0-wire on warm. Identical loader to run-native; runs the forge transformer
// forward on the GPU. Exposes a BRAIN PROVIDER identical in shape to holo-voice-gpu-brain.mjs, so
// holo-voice.js can bind it as Q's WebGPU brain tier:
//   load(onProgress) · generate(history, opts) → async-iterator of text DELTAS · chat(history) → string.
//
// The forward (WGSL kernels + dispatch order) is the PROVEN run-native/run-holo path, byte-for-byte; only
// the loading (async κ-stream instead of a fetch+forge) and the multi-turn generate loop are new. Weights
// are fetched + L5-verified once at load() and kept on the GPU; each turn reuses them (fresh KV per turn).

import { openGgufHoloStream } from "../gguf-forge-kstream.mjs";   // unified κ-stream loader (per-κ Range + L5 + head-persist)
import { makeKappaStore } from "./holo-kappa-store.mjs";          // persistent content store (OPFS "holo-kappa", cross-model dedup)
import { synthesizeGraph } from "../gguf-forge-graph.mjs";
import { makeTokenizer } from "../gguf-forge-tokenizer.mjs";
import { dequantizeExact, GGML } from "../gguf-forge-dequant.mjs";
import { unpackWeight } from "../gguf-forge-gpupack.mjs";
import { ggmlNBytes } from "../gguf-forge.mjs";
import { createGpuRuntime, G } from "./holo-gguf-gpu.mjs";        // ONE shared WGSL kernel runtime (run-native + Q's brain)

// WGSL kernels now live in the shared runtime module holo-gguf-gpu.mjs (imported above) — the
// brain forward consumes the EXACT same kernels as run-native (proven greedy-parity with llama.cpp).

const QWEN_EOS = new Set([151643, 151645, 151662, 151663, 151664]);   // <|endoftext|> / <|im_end|> / …
const MAX_CTX = 2048;                                                 // matches the ATTN sc[] array size

// ── OPFS κ-cache: a .holo is immutable (content-addressed footer), so the FIRST visit downloads it and
//    writes it to the Origin Private File System; EVERY later visit reads it from disk — instant, offline,
//    no network. Integrity is unaffected: openHoloStream re-derives each block's κ (WebCrypto L5) whether
//    the bytes came from the network or OPFS, so a corrupted cache is REFUSED, not trusted. Best-effort:
//    any OPFS error (unsupported / quota) silently falls back to a plain fetch. ──
export async function loadHoloBytes(url, kappa, prog, release) {
  const name = (url.split("/").pop() || "model.holo").split("?")[0];
  let dir = null;
  try { dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("holo-models", { create: true }); } catch (e) { dir = null; }
  if (dir) {
    try { const f = await (await dir.getFileHandle(name)).getFile(); if (f.size > 0) { prog && prog("loading .holo from cache (OPFS)"); return { bytes: new Uint8Array(await f.arrayBuffer()), src: "opfs" }; } } catch (e) {}
  }
  // FIRST visit: try the repo path (present in dev / if committed) → the GitHub Release asset (big weights
  // that exceed the 100MB Pages limit live here, 2GB/file) → the content-addressed κ-route (/.holo/sha256/<κ>,
  // SW heals from IPFS/mesh). Location is only a latency choice; every block is re-derived by openHoloStream
  // (L5), so no host is trusted (Law L1/L5). First source that returns bytes wins.
  let bytes = null, src = "net";
  prog && prog("downloading .holo (first visit)");
  try { const r = await fetch(url); if (r.ok) bytes = new Uint8Array(await r.arrayBuffer()); } catch (e) {}
  if (!bytes && release) { prog && prog("downloading .holo (release asset)"); try { const r = await fetch(release); if (r.ok) { bytes = new Uint8Array(await r.arrayBuffer()); src = "release"; } } catch (e) {} }
  if (!bytes && kappa) { prog && prog("resolving .holo by κ (serverless)"); try { const r = await fetch("/.holo/sha256/" + kappa); if (r.ok) { bytes = new Uint8Array(await r.arrayBuffer()); src = "kappa"; } } catch (e) {} }
  if (!bytes) throw new Error("holo: could not load from path, release, or κ-route");
  if (dir) { try { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(bytes); await w.close(); prog && prog("cached .holo to OPFS"); } catch (e) {} }
  return { bytes, src };
}

// A LAZY multi-source Range reader for openGgufHoloStream: resolves the first working source
// (dev path → GitHub Release asset → content-addressed κ-route /.holo/sha256/<κ>) on first byte,
// then serves per-κ Range reads (only what's needed). A no-Range source falls back to one full GET
// + in-memory slices. On a fully-warm load (head + bodies in OPFS) this is NEVER called → 0 network.
// Location is only a latency choice; every block is re-derived by κ (L5), so no host is trusted.
function makeBrainRange(url, release, kappa, prog, rstats) {
  const candidates = [url, release, kappa ? "/.holo/sha256/" + kappa : null].filter(Boolean);
  let activeUrl = null, ranged = false, whole = null;
  const ensure = async () => {
    if (activeUrl) return;
    for (const u of candidates) {
      try {
        const probe = await fetch(u, { headers: { Range: "bytes=0-1" } });
        if (probe.status === 206) { activeUrl = u; ranged = true; rstats.served += 2; prog && prog("streaming .holo by κ"); return; }
        if (probe.ok) { activeUrl = u; whole = new Uint8Array(await (await fetch(u)).arrayBuffer()); rstats.served += whole.length; prog && prog("downloading .holo (no-range source)"); return; }
      } catch (e) {}
    }
    throw new Error("holo: could not load from path, release, or κ-route");
  };
  return async (off, len) => {
    await ensure();
    if (ranged) { const r = await fetch(activeUrl, { headers: { Range: `bytes=${off}-${off + len - 1}` } }); const b = new Uint8Array(await r.arrayBuffer()); rstats.served += b.length; return b; }
    return whole.subarray(off, off + len);
  };
}

export function createHoloBrain(opts = {}) {
  const cfg = Object.assign({ holoUrl: "", kappa: "", releaseUrl: "", maxTokens: 512, system: "You are Q, a concise, helpful on-device assistant." }, opts);
  let loadingP = null, info = { ready: false, device: null, model: cfg.holoUrl.split("/").pop() };
  let dev, tok, S, Wt = {}, lmChunks = [], embedRow, SB = {}, Kc = [], Vc = [], logits, aS, aQ;
  let adEnabled = false, adA = [], adB = [], adR = 0, adScale = 0;   // optional LoRA adapter (attn_q): y += scale·B·(A·xn)
  let D, NH, NHKV, HD, EPS, FREQ, KV, QD, scale, grp, FF, lmK, vocab;
  // the shared GPU runtime (kernels + dispatch/uniform/buffer helpers), bound from createGpuRuntime(dev) at load()
  let P, disp, u4, f4, sbuf, wF, rawU32, resetUniforms;

  // ── apply a LoRA adapter to the ALREADY-LOADED base (build/refresh the per-layer A,B GPU buffers). Used
  //    both at load() (cfg.adapter) and at runtime by setAdapter() — a per-task SWAP reuses the warm base
  //    weights untouched and only re-uploads the tiny delta, so switching specialists costs an adapter upload,
  //    never a base re-stream. Validated against the model frame (target/dims/depth) — a mismatch is REFUSED. ──
  function applyAdapter(ad, prog) {
    if (ad.target !== "attn_q") throw new Error("adapter target unsupported (only attn_q is GPU-proven): " + ad.target);
    if (ad.nLayer < S.n_layer) throw new Error("adapter has " + ad.nLayer + " layers < model " + S.n_layer);
    if (ad.inn != null && ad.inn !== D) throw new Error("adapter inn " + ad.inn + " != model n_embd " + D);
    if (ad.out != null && ad.out !== QD) throw new Error("adapter out " + ad.out + " != model QD " + QD);
    for (const b of adA) { try { b.destroy && b.destroy(); } catch (e) {} }   // free the previous delta's GPU buffers
    for (const b of adB) { try { b.destroy && b.destroy(); } catch (e) {} }
    adA = []; adB = [];
    adR = ad.r; adScale = ad.scale;
    if (SB.hA) { try { SB.hA.destroy && SB.hA.destroy(); } catch (e) {} }
    SB.hA = sbuf(adR); if (!SB.hB) SB.hB = sbuf(QD);
    for (let L = 0; L < S.n_layer; L++) { adA.push(wF(ad.layers[L].A)); adB.push(wF(ad.layers[L].B)); }
    adEnabled = true;
    prog && prog("adapter bound (attn_q, r=" + adR + ", scale=" + adScale + ")");
  }

  async function load(onProgress) {
    if (info.ready) return info;
    if (loadingP) return loadingP;
    loadingP = (async () => {
      const _t0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      if (!(typeof navigator !== "undefined" && navigator.gpu)) throw new Error("no WebGPU on this device");
      const prog = (m) => { try { onProgress && onProgress(m); } catch (e) {} };
      // ── UNIFIED κ-STREAM LOAD: the same loader run-native rides — per-κ Range streaming, the shared
      //    content-addressed OPFS store (cross-model dedup), and head-persist (head+bodies 0-wire on warm). ──
      prog("opening .holo (stream by κ)");
      const rstats = { served: 0 };
      const persist = makeKappaStore();   // OPFS "holo-kappa": per-κ body cache + head-persist, shared with every model
      // UNIFIED PACK (opt-in via cfg.openGgufStream): the same {plan,store,headerBytes} from the ONE q-models pack
      // (ggufStreamFromPackModel) instead of this model's own .holo. Fail-soft: null → the per-model κ-stream below.
      let streamed = null;
      if (cfg.openGgufStream) { try { prog("opening unified pack"); streamed = await cfg.openGgufStream({ persist }); } catch (e) { streamed = null; } }
      if (!streamed) {
        const rangeReader = makeBrainRange(cfg.holoUrl, cfg.releaseUrl, cfg.kappa, prog, rstats);
        streamed = await openGgufHoloStream(rangeReader, { persist, urlHint: cfg.holoUrl || cfg.kappa, rootKappa: cfg.kappa ? "did:holo:sha256:" + cfg.kappa : null });
      }
      const { plan, store, headerBytes, headWarm } = streamed;
      const arch = plan.arch || "unknown";
      const tensors = plan.tensors;       // {name,dims,type,typeName,kappa} — same shape the forge forward consumes
      const graph = synthesizeGraph({ format: "gguf-forge/1", arch, meta: plan.meta, tensors }); S = graph.stats;
      tok = makeTokenizer(headerBytes);

      // fetch + L5-verify every weight body ONCE through the persistent store (per-κ, content-addressed); a
      // body seen before is served from OPFS (0 net), else Range-fetched + verified + persisted. Sync forward.
      // PARALLEL κ-STREAM: the weights are ~290 content-addressed bodies, each a Range fetch + WebCrypto L5 verify.
      // Loading them SEQUENTIALLY (await one at a time) made cold-load bound on round-trips (measured ~150s over 314
      // blocks on software-WebGPU). Fetch+verify with a bounded concurrency window instead: order is irrelevant
      // (blocks is keyed by κ), every unique κ is still fetched EXACTLY once (deduped up front) → same bytes, same
      // per-block L5, ~10x faster wall-clock. A rejection (L5 refuse) still propagates and fails the load as before.
      prog("verifying + loading weights (L5)");
      const blocks = new Map();
      const uniqHexes = [...new Set(tensors.map((t) => t.kappa.split(":").pop()))];
      const STREAM_CONCURRENCY = Math.max(1, Math.min(16, cfg.streamConcurrency || 12));
      let _wi = 0, _done = 0;
      const _streamWorker = async () => {
        while (_wi < uniqHexes.length) {
          const hex = uniqHexes[_wi++];                       // read+increment is atomic (no await between) → no double-fetch
          blocks.set(hex, await store.get(hex));              // Range + L5; throws (refuses) propagate and fail the load
          if ((++_done & 31) === 0) prog(`streaming weights (L5) ${_done}/${uniqHexes.length}`);
        }
      };
      await Promise.all(Array.from({ length: Math.min(STREAM_CONCURRENCY, uniqHexes.length) }, _streamWorker));
      const cacheSrc = headWarm && persist.stats.misses === 0 ? "warm" : "cold";
      const tdir = {}; for (const t of tensors) tdir[t.name] = t;
      const blk = (name) => blocks.get(tdir[name].kappa.split(":").pop());
      const dimsNK = (name) => { const d = tdir[name].dims; return [d.length > 1 ? d[1] : 1, d[0]]; };

      // ── GPU device + pipelines ──
      const gpuAdapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!gpuAdapter) throw new Error("WebGPU adapter unavailable on this device");
      // WebGPU's DEFAULT device limits are conservative (128MB bindings / 256MB buffers) — that caps desktop
      // headroom AND under-uses what a phone can actually give. Ask for the adapter's full limits, clamped to it,
      // so the SAME engine fits the device it's on (mobile-aware, no per-platform fork).
      const aLim = gpuAdapter.limits || {}, requiredLimits = {};
      for (const k of ["maxStorageBufferBindingSize", "maxBufferSize", "maxComputeWorkgroupStorageSize", "maxComputeInvocationsPerWorkgroup"]) if (aLim[k] != null) requiredLimits[k] = aLim[k];
      dev = await gpuAdapter.requestDevice({ requiredLimits });
      const lim = dev.limits, maxBind = lim.maxStorageBufferBindingSize || 134217728;   // the real per-binding ceiling on THIS device
      ({ P, disp, u4, f4, sbuf, wF, rawU32, resetUniforms } = createGpuRuntime(dev));   // shared kernel runtime

      D = S.n_embd; NH = S.n_head; NHKV = S.n_head_kv; HD = S.head_dim; EPS = S.eps; FREQ = S.freq_base;
      KV = NHKV * HD; QD = NH * HD; scale = 1 / Math.sqrt(HD); grp = NH / NHKV;

      // weights: Q5_0/Q8_0 uploaded as PACKED κ-block bytes (in-shader unpack); others → f32.
      const loadW = (name) => {
        const t = tdir[name], [N, K] = dimsNK(name);
        if (t.type === GGML.Q5_0) return { kind: "q5raw", buf: rawU32(blk(name)), N, K };
        if (t.type === GGML.Q8_0) return { kind: "q8raw", buf: rawU32(blk(name)), N, K };
        return { kind: "f32", fBuf: wF(unpackWeight(blk(name), t.type, N, K).data), N, K };
      };
      for (let i = 0; i < S.n_layer; i++) { const p = `blk.${i}.`; for (const [k, g] of [["attn_norm", "attn_norm.weight"], ["wq", "attn_q.weight"], ["bq", "attn_q.bias"], ["wk", "attn_k.weight"], ["bk", "attn_k.bias"], ["wv", "attn_v.weight"], ["bv", "attn_v.bias"], ["wo", "attn_output.weight"], ["ffn_norm", "ffn_norm.weight"], ["gate", "ffn_gate.weight"], ["up", "ffn_up.weight"], ["down", "ffn_down.weight"]]) Wt[`l${i}.${k}`] = loadW(p + g); }
      Wt["final_norm"] = loadW("output_norm.weight");
      FF = tdir["blk.0.ffn_gate.weight"].dims[1];

      // lm_head (chunked: a single quants buffer would exceed the per-binding limit). Chunk count is LIMIT-AWARE:
      // each chunk's bytes must fit THIS device's maxStorageBufferBindingSize (so a phone with a smaller ceiling
      // simply gets more, smaller chunks — same code, no OOM); desktop keeps the proven ~100k-row chunking.
      const lmName = tdir["output.weight"] ? "output.weight" : "token_embd.weight", lmT = tdir[lmName], [lmN, lmKv] = dimsNK(lmName);
      lmK = lmKv; vocab = lmN; const nbL = lmK / 32;
      const raw = blk(lmName), bpr = nbL * (lmT.type === GGML.Q5_0 ? 22 : 34), kind = lmT.type === GGML.Q5_0 ? "q5raw" : "q8raw";
      const fitRows = Math.max(1, Math.floor((maxBind * 0.9) / bpr));   // rows whose packed bytes stay under the binding ceiling
      const CH = Math.ceil(lmN / Math.min(100000, fitRows)), chunkRows = Math.ceil(lmN / CH);
      for (let c = 0; c < CH; c++) { const r0 = c * chunkRows, r1 = Math.min(lmN, r0 + chunkRows); lmChunks.push({ kind, r0, n: r1 - r0, buf: rawU32(raw.subarray(r0 * bpr, r1 * bpr)) }); }

      // embeddings: dequant token_embd rows ON DEMAND (avoid materializing the whole table)
      const teT = tdir["token_embd.weight"], teRaw = blk("token_embd.weight"), teBpr = ggmlNBytes(teT.type, D);
      embedRow = (t) => dequantizeExact(teT.type, teRaw.subarray(t * teBpr, (t + 1) * teBpr), D);

      // persistent scratch + KV (reused across turns)
      for (const [n, sz] of [["h", D], ["hh", D], ["xn", D], ["q", QD], ["qb", QD], ["qr", QD], ["k", KV], ["kb", KV], ["kr", KV], ["v", KV], ["vb", KV], ["ctx", QD], ["ao", D], ["fi", D], ["xn2", D], ["hn", D], ["g", FF], ["u", FF], ["sw", FF], ["fo", D]]) SB[n] = sbuf(sz);
      for (let L = 0; L < S.n_layer; L++) { Kc.push(sbuf(MAX_CTX * KV)); Vc.push(sbuf(MAX_CTX * KV)); }
      logits = sbuf(vocab);
      aS = sbuf(FF / 32); aQ = dev.createBuffer({ size: (FF / 4) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });

      // ── LoRA adapter (optional): the SAME delta the run-native path + the CPU witness prove —
      //    per layer y_attn_q += scale·B·(A·xn), A:[r×D] B:[QD×r] dense f32, uploaded once, applied in run().
      //    Always allocate hB so a later runtime setAdapter() can swap specialists without re-streaming the base. ──
      SB.hB = sbuf(QD);
      if (cfg.adapter && cfg.adapter.layers) applyAdapter(cfg.adapter, prog);

      // coarse device tier from the real per-binding ceiling: a phone/integrated GPU reports a much smaller
      // maxStorageBufferBindingSize than a discrete desktop GPU. The upgrade policy reads this to decide whether
      // the heavier 1.5B tier is safe (don't silently OOM a phone) — see holo-voice upgradeBrain gating.
      const gpuTier = maxBind >= (1 << 30) ? "high" : maxBind >= (256 * 1024 * 1024) ? "mid" : "low";
      // MEASURED load time (not a stated figure): wall-clock from load() entry to ready, tagged warm/cold by the
      // κ-store hit pattern. warm = head + every body served from OPFS (0 wire) → sub-second; cold = first visit
      // (network + convert + OPFS write). The UI reads info.timing so the claim is whatever was measured here.
      const _t1 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
      info = { ready: true, device: "webgpu", model: cfg.holoUrl.split("/").pop(), arch, vocab, nLayer: S.n_layer, cache: cacheSrc,
        timing: { loadMs: Math.round(_t1 - _t0), cache: cacheSrc, wireBytes: rstats.served, ttftMs: null },
        gpu: { tier: gpuTier, maxBind, maxBuffer: lim.maxBufferSize || 0, adapter: adEnabled },
        stream: { headWarm, wireBytes: rstats.served, bodyHits: persist.stats.opfsHits, headHits: persist.stats.headHits, misses: persist.stats.misses, writes: persist.stats.opfsWrites + persist.stats.headWrites } };
      return info;
    })().catch((e) => { loadingP = null; throw e; });
    return loadingP;
  }

  // Qwen ChatML, encoded with parseSpecial so <|im_start|>/<|im_end|> map to their token ids.
  function frameChat(history) {
    let s = "";
    const sys = (history.find((m) => m && m.role === "system") || {}).content || cfg.system;
    s += `<|im_start|>system\n${sys}<|im_end|>\n`;
    for (const m of history) { if (!m || m.role === "system") continue; s += `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`; }
    s += `<|im_start|>assistant\n`;
    return s;
  }

  // one autoregressive forward over `seq`, generating up to maxNew tokens; onToken(cumulativeText) per step.
  async function* run(seq, maxNew, signal) {
    const mv = (enc, w, xB, yB, ob, N, K) => {
      if (w.kind === "q5raw") disp(enc, P.q5raw, [w.buf, xB, yB, u4([N, K, ob])], G(N));
      else if (w.kind === "q8raw") disp(enc, P.q8raw, [w.buf, xB, yB, u4([N, K, ob])], G(N));
      else disp(enc, P.f, [w.fBuf, xB, yB, u4([N, K, ob])], G(N));
    };
    const tokens = seq.slice(), gen = []; let pos = 0, prevText = "";
    while (pos < seq.length) {
      if (signal && signal.aborted) return;
      resetUniforms();
      dev.queue.writeBuffer(SB.h, 0, embedRow(seq[pos]));
      const enc = dev.createCommandEncoder();
      for (let L = 0; L < S.n_layer; L++) {
        const w = (s) => Wt[`l${L}.${s}`];
        disp(enc, P.rms, [SB.h, w("attn_norm").fBuf, SB.xn, f4([D, EPS])], 1);
        mv(enc, w("wq"), SB.xn, SB.q, 0, QD, D);
        if (adEnabled) { disp(enc, P.f, [adA[L], SB.xn, SB.hA, u4([adR, D, 0])], G(adR)); disp(enc, P.f, [adB[L], SB.hA, SB.hB, u4([QD, adR, 0])], G(QD)); disp(enc, P.saxpy, [SB.hB, SB.q, f4([adScale, QD])], G(QD)); }
        disp(enc, P.add, [SB.q, w("bq").fBuf, SB.qb, u4([QD])], G(QD));
        mv(enc, w("wk"), SB.xn, SB.k, 0, KV, D); disp(enc, P.add, [SB.k, w("bk").fBuf, SB.kb, u4([KV])], G(KV));
        mv(enc, w("wv"), SB.xn, SB.v, 0, KV, D); disp(enc, P.add, [SB.v, w("bv").fBuf, SB.vb, u4([KV])], G(KV));
        disp(enc, P.rope, [SB.qb, SB.qr, f4([HD, HD, NH, pos]), f4([FREQ])], G(NH * HD / 2));
        disp(enc, P.rope, [SB.kb, SB.kr, f4([HD, HD, NHKV, pos]), f4([FREQ])], G(NHKV * HD / 2));
        enc.copyBufferToBuffer(SB.kr, 0, Kc[L], pos * KV * 4, KV * 4);
        enc.copyBufferToBuffer(SB.vb, 0, Vc[L], pos * KV * 4, KV * 4);
        disp(enc, P.attn, [SB.qr, Kc[L], Vc[L], SB.ctx, u4([NH, HD, pos, KV]), f4([scale, grp])], G(NH));
        mv(enc, w("wo"), SB.ctx, SB.ao, 0, D, QD);
        disp(enc, P.add, [SB.h, SB.ao, SB.fi, u4([D])], G(D));
        disp(enc, P.rms, [SB.fi, w("ffn_norm").fBuf, SB.xn2, f4([D, EPS])], 1);
        mv(enc, w("gate"), SB.xn2, SB.g, 0, FF, D); mv(enc, w("up"), SB.xn2, SB.u, 0, FF, D);
        disp(enc, P.swiglu, [SB.g, SB.u, SB.sw, u4([FF])], G(FF));
        mv(enc, w("down"), SB.sw, SB.fo, 0, D, FF);
        disp(enc, P.add, [SB.fi, SB.fo, SB.hh, u4([D])], G(D));
        enc.copyBufferToBuffer(SB.hh, 0, SB.h, 0, D * 4);
      }
      const doGen = pos >= tokens.length - 1;
      let rb = null;
      if (doGen) {
        disp(enc, P.rms, [SB.h, Wt["final_norm"].fBuf, SB.hn, f4([D, EPS])], 1);
        for (const ch of lmChunks) disp(enc, P[ch.kind], [ch.buf, SB.hn, logits, u4([ch.n, lmK, ch.r0])], G(ch.n));
        rb = dev.createBuffer({ size: vocab * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        enc.copyBufferToBuffer(logits, 0, rb, 0, vocab * 4);
      }
      dev.queue.submit([enc.finish()]);
      if (doGen) {
        await rb.mapAsync(GPUMapMode.READ); const lg = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy();
        let am = 0; for (let i = 1; i < vocab; i++) if (lg[i] > lg[am]) am = i;
        if (QWEN_EOS.has(am) || gen.length >= maxNew) return;
        gen.push(am);
        const text = tok.decode(gen), delta = text.slice(prevText.length); prevText = text;
        if (delta) yield delta;
        seq.push(am);
      } else {
        await dev.queue.onSubmittedWorkDone();
      }
      pos++;
      if (pos >= MAX_CTX) return;
    }
  }

  async function* generate(history, o = {}) {
    if (!info.ready) await load(o.onProgress);
    const ids = tok.encode(frameChat(history || []), { addSpecial: false, parseSpecial: true });
    const _g0 = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    let first = true;
    for await (const d of run(ids, o.maxTokens || cfg.maxTokens, o.signal)) {
      if (first) { first = false; const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); if (info.timing) info.timing.ttftMs = Math.round(now - _g0); }
      yield d;
    }
  }
  async function chat(history, o = {}) { let s = ""; for await (const d of generate(history, o)) s += d; return s.trim(); }

  // ── runtime specialist swap: bind a decoded adapter ({target,scale,r,inn,out,nLayer,layers}) onto the warm
  //    base, or null to revert to base-only. Reuses the loaded base weights untouched (no re-stream) — this is
  //    the per-task hot-swap the mux drives. Returns the new adapter state; a frame/dim mismatch throws (REFUSE). ──
  function setAdapter(ad) {
    if (!info.ready) throw new Error("brain not loaded — call load() before setAdapter()");
    if (!ad) {
      for (const b of adA) { try { b.destroy && b.destroy(); } catch (e) {} }
      for (const b of adB) { try { b.destroy && b.destroy(); } catch (e) {} }
      adA = []; adB = []; adEnabled = false; adR = 0; adScale = 0;
      if (info.gpu) info.gpu.adapter = false;
      return { adapter: false };
    }
    applyAdapter(ad, null);
    if (info.gpu) info.gpu.adapter = true;
    return { adapter: true, r: adR, scale: adScale, target: ad.target };
  }

  return { id: "holo-q-brain-holo", load, generate, chat, setAdapter, info: () => info };
}

export default createHoloBrain;
