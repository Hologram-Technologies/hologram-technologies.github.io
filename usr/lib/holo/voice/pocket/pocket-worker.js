// pocket-worker.js — Q's live voice engine: kyutai pocket-tts (100M flow-LM + mimi) streaming-decoded
// on-device via onnxruntime-web. Runs fully in this module worker; audio Float32 chunks stream to the
// client as they decode (first chunk ≈ 3 frames = 240ms of audio). Weights stream from the HOLOGRAMTECH
// HF mirror and persist in the Cache API, so a returning user warms with ZERO network.
// Derived from KevinAHM/pocket-tts-web (MIT); model © Kyutai Labs (CC-BY-4.0).

let ort = null;
let cfg = {
  base: "https://huggingface.co/HOLOGRAMTECH/q-pocket-tts/resolve/main/",
  ortBase: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/",
  ep: "auto",            // auto → webgpu when available, else wasm
  threads: 0,            // 0 → auto (COI ? min(4,cores) : 1)
  cacheName: "holo-pocket-voice-v1",
};

const DEBUG = false;
const MAX_FRAMES = 500;
const LSD_STEPS = 1;
const CHUNK_GAP_SEC = 0.25;

let meta = null, tokenizer = null, voiceState = null;
let sessText = null, sessMain = null, sessFlow = null, sessDecode = null;
let sr = 24000, samplesPerFrame = 1920, latentDim = 32, condDim = 1024, maxTok = 50;
let stTensors = [];
let generating = false, ready = false, genSeq = 0;

const log = (...a) => { if (DEBUG) console.log("[pocket-worker]", ...a); };
const status = (s) => postMessage({ type: "status", status: s });

// ── cached streaming fetch: Cache API first, network once, progress events while downloading.
// A STALL WATCHDOG aborts any network read that goes quiet (default 25s without a byte) so one flaky
// CDN response fails the warm FAST into the caller's fail-soft ladder instead of hanging it. A cached
// warm touches the network ZERO times — returning users are immune to upstream weather (and offline-ok).
const STALL_MS = 25000;
async function fetchCached(url, label, onBytes) {
  let cache = null;
  try { cache = await caches.open(cfg.cacheName); } catch (e) {}
  if (cache) {
    try { const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch (e) {}
  }
  const ab = new AbortController();
  let watchdog = setTimeout(() => ab.abort(), STALL_MS);
  const feed = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ab.abort(), STALL_MS); };
  try {
    const res = await fetch(url, { credentials: "omit", signal: ab.signal });
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    const total = +res.headers.get("content-length") || 0;
    let buf;
    if (res.body) {
      const reader = res.body.getReader();
      const parts = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        feed();
        parts.push(value); got += value.length;
        if (onBytes) onBytes(label, got, total);
      }
      buf = new Uint8Array(got);
      let off = 0; for (const p of parts) { buf.set(p, off); off += p.length; }
    } else {
      buf = new Uint8Array(await res.arrayBuffer());
    }
    if (cache) { try { await cache.put(url, new Response(buf.slice(), { headers: { "content-type": "application/octet-stream" } })); } catch (e) {} }
    return buf;
  } finally { clearTimeout(watchdog); }
}

async function importBlobModule(url, label) {
  const bytes = await fetchCached(url, label || "module");
  const blob = new Blob([bytes], { type: "text/javascript" });
  const burl = URL.createObjectURL(blob);
  try { return await import(burl); } finally { URL.revokeObjectURL(burl); }
}

// ── tensor plumbing (mirrors the upstream export's runtime contract) ──
function makeFilled(shape, dtype, fill) {
  const size = shape.reduce((a, b) => a * b, 1);
  if (dtype === "int64") return new BigInt64Array(size);
  if (dtype === "bool") return new Uint8Array(size);
  const d = new Float32Array(size);
  if (fill === "nan") d.fill(NaN); else if (fill === "ones") d.fill(1);
  return d;
}
const T = (dtype, data, dims) => new ort.Tensor(dtype, data, dims);
function initState(manifest) {
  const s = {};
  for (const e of manifest) s[e.input_name] = T(e.dtype, makeFilled(e.shape, e.dtype, e.fill), e.shape);
  return s;
}
function updateState(state, result, manifest) {
  for (const e of manifest) state[e.input_name] = result[e.output_name];
}

function parseVoiceBin(buffer) {
  const view = new DataView(buffer);
  if (new TextDecoder().decode(new Uint8Array(buffer, 0, 5)) !== "PTVB1") throw new Error("bad voice bin");
  let off = 5;
  const count = view.getUint32(off, true); off += 4;
  const voices = {};
  for (let v = 0; v < count; v++) {
    const nameLen = view.getUint16(off, true); off += 2;
    const name = new TextDecoder().decode(new Uint8Array(buffer, off, nameLen)); off += nameLen;
    const tcount = view.getUint16(off, true); off += 2;
    const tensors = {};
    for (let t = 0; t < tcount; t++) {
      const keyLen = view.getUint16(off, true); off += 2;
      const key = new TextDecoder().decode(new Uint8Array(buffer, off, keyLen)); off += keyLen;
      const dt = view.getUint8(off); off += 1;
      const rank = view.getUint8(off); off += 1;
      const shape = [];
      for (let d = 0; d < rank; d++) { shape.push(view.getUint32(off, true)); off += 4; }
      const bytes = view.getUint32(off, true); off += 4;
      let data;
      if (dt === 0) data = new Float32Array(buffer.slice(off, off + bytes));
      else if (dt === 1) data = new BigInt64Array(buffer.slice(off, off + bytes));
      else data = new Uint8Array(buffer.slice(off, off + bytes));
      off += bytes;
      tensors[key] = { data, shape, dtype: dt === 0 ? "float32" : dt === 1 ? "int64" : "bool" };
    }
    voices[name] = tensors;
  }
  return voices;
}

function groupByModule(record) {
  const g = {};
  for (const [k, v] of Object.entries(record)) {
    const i = k.indexOf("/"); if (i === -1) continue;
    (g[k.slice(0, i)] = g[k.slice(0, i)] || {})[k.slice(i + 1)] = v;
  }
  return g;
}
function adapt(source, entry) {
  const target = makeFilled(entry.shape, entry.dtype, entry.fill);
  const size = entry.shape.reduce((a, b) => a * b, 1);
  const same = source.shape.length === entry.shape.length && source.shape.every((d, i) => d === entry.shape[i]);
  if (same || source.data.length === size) {
    if (entry.dtype === "int64") return new BigInt64Array(source.data);
    if (entry.dtype === "bool") return new Uint8Array(source.data);
    return new Float32Array(source.data);
  }
  if (source.shape.length !== entry.shape.length) return target;
  // partial copy (truncate/pad per-dim) — same walk as upstream
  const strides = []; let st = 1;
  for (let i = source.shape.length - 1; i >= 0; i--) { strides[i] = st; st *= source.shape[i]; }
  const idx = new Array(source.shape.length).fill(0);
  const lim = source.shape.map((d, i) => Math.min(d, entry.shape[i]));
  const tIndex = (c) => { let x = 0, s = 1; for (let i = entry.shape.length - 1; i >= 0; i--) { x += c[i] * s; s *= entry.shape[i]; } return x; };
  for (;;) {
    let si = 0; for (let i = 0; i < idx.length; i++) si += idx[i] * strides[i];
    target[tIndex(idx)] = source.data[si];
    let d = idx.length - 1;
    for (; d >= 0; d--) { if (++idx[d] < lim[d]) break; idx[d] = 0; }
    if (d < 0) break;
  }
  return target;
}
function deriveStep(m) {
  if (m.step) return { data: BigInt64Array.from([BigInt(m.step.data[0])]), shape: [1] };
  if (m.offset && !m.end_offset) return { data: BigInt64Array.from([BigInt(m.offset.data[0])]), shape: [1] };
  if (m.current_end) return { data: BigInt64Array.from([BigInt(m.current_end.shape[0])]), shape: [1] };
  return { data: BigInt64Array.from([0n]), shape: [1] };
}
function stateFromVoice(record) {
  const grouped = groupByModule(record);
  const state = initState(meta.flow_lm_state_manifest);
  for (const e of meta.flow_lm_state_manifest) {
    const mod = grouped[e.module] || {};
    let src = mod[e.key];
    if (!src && e.key === "step") src = deriveStep(mod);
    if (!src) continue;
    state[e.input_name] = T(e.dtype, adapt(src, e), e.shape);
  }
  return state;
}

// ── text prep (upstream contract) ──
function prepareText(text) {
  let p = String(text).trim();
  if (!p) return { text: "", framesAfterEos: 1 };
  p = p.replace(/\r/g, " ").replace(/\n/g, " ").replace(/\s+/g, " ");
  if (meta.remove_semicolons) p = p.replace(/;/g, ",");
  const words = p.split(/\s+/).filter(Boolean).length;
  let framesAfterEos = words <= 4 ? 3 : 1;
  if (meta.model_recommended_frames_after_eos != null) framesAfterEos = Number(meta.model_recommended_frames_after_eos);
  if (p && !/[A-ZÀ-Þ]/.test(p[0])) p = p[0].toUpperCase() + p.slice(1);
  if (p && /[0-9A-Za-zÀ-ÿ]/.test(p[p.length - 1])) p += ".";
  if (meta.pad_with_spaces_for_short_inputs && words < 5) p = "        " + p;
  return { text: p, framesAfterEos };
}
function chunksOf(text) {
  const prep = prepareText(text);
  if (!prep.text) return { chunks: [], framesAfterEos: prep.framesAfterEos };
  const sentences = (prep.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [prep.text]).map((s) => s.trim()).filter(Boolean);
  const chunks = []; let cur = "";
  for (const s of sentences) {
    const ids = tokenizer.encodeIds(s);
    if (ids.length > maxTok) {
      if (cur) { chunks.push(cur.trim()); cur = ""; }
      for (let i = 0; i < ids.length; i += maxTok) {
        const t = tokenizer.decodeIds(ids.slice(i, i + maxTok)).trim();
        if (t) chunks.push(t);
      }
      continue;
    }
    if (!cur) { cur = s; continue; }
    if (tokenizer.encodeIds(`${cur} ${s}`).length > maxTok) { chunks.push(cur.trim()); cur = s; }
    else cur = `${cur} ${s}`;
  }
  if (cur) chunks.push(cur.trim());
  return { chunks, framesAfterEos: prep.framesAfterEos };
}

// ── load ──
async function load() {
  status("engine");
  const ortCandidates = [cfg.ortBase, "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/"];
  for (const base of ortCandidates) {
    try {
      const m = await importBlobModule(base + "ort.min.mjs", "ort").catch(() => import(/* @vite-ignore */ base + "ort.min.mjs"));
      ort = m.default || m;
      ort.env.wasm.wasmPaths = base;
      break;
    } catch (e) { log("ort base failed", base, e); }
  }
  if (!ort) throw new Error("onnxruntime-web unreachable");
  ort.env.wasm.simd = true;
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, cfg.threads || Math.min(4, cores)) : 1;

  const wantGpu = cfg.ep === "webgpu" || (cfg.ep === "auto" && typeof navigator !== "undefined" && !!navigator.gpu);
  const eps = wantGpu ? ["webgpu", "wasm"] : ["wasm"];

  status("bundle");
  meta = JSON.parse(new TextDecoder().decode(await fetchCached(cfg.base + "bundle.json", "bundle")));
  sr = +meta.sample_rate; samplesPerFrame = +meta.samples_per_frame;
  latentDim = +meta.latent_dim; condDim = +meta.conditioning_dim; maxTok = +(meta.max_token_per_chunk || 50);

  const onBytes = (label, got, total) => postMessage({ type: "progress", label, got, total });
  const [bText, bMain, bFlow, bDec, bTok, bVoice] = await Promise.all([
    fetchCached(cfg.base + "text_conditioner_int8.onnx", "text", onBytes),
    fetchCached(cfg.base + "flow_lm_main_int8.onnx", "main", onBytes),
    fetchCached(cfg.base + "flow_lm_flow_int8.onnx", "flow", onBytes),
    fetchCached(cfg.base + "mimi_decoder_int8.onnx", "decoder", onBytes),
    fetchCached(cfg.base + "tokenizer.model", "tokenizer", onBytes),
    fetchCached(cfg.base + "voice-alba.bin", "voice", onBytes),
  ]);

  status("sessions");
  const opts = { executionProviders: eps, graphOptimizationLevel: "all" };
  const mk = async (bytes) => {
    try { return await ort.InferenceSession.create(bytes, opts); }
    catch (e) { if (eps.length > 1) return ort.InferenceSession.create(bytes, { ...opts, executionProviders: ["wasm"] }); throw e; }
  };
  [sessText, sessMain, sessFlow, sessDecode] = await Promise.all([mk(bText), mk(bMain), mk(bFlow), mk(bDec)]);

  status("tokenizer");
  const sp = await importBlobModule(cfg.base + "sentencepiece.js", "sp");
  tokenizer = new sp.SentencePieceProcessor();
  let b64 = ""; const CH = 0x8000;
  for (let i = 0; i < bTok.length; i += CH) b64 += String.fromCharCode.apply(null, bTok.subarray(i, i + CH));
  await tokenizer.loadFromB64StringModel(btoa(b64));

  status("voice");
  const voices = parseVoiceBin(bVoice.buffer);
  const name = Object.keys(voices)[0];
  voiceState = stateFromVoice(voices[name]);

  stTensors = [];
  const dt = 1.0 / LSD_STEPS;
  for (let i = 0; i < LSD_STEPS; i++) {
    stTensors.push({ s: T("float32", new Float32Array([i / LSD_STEPS]), [1, 1]), t: T("float32", new Float32Array([i / LSD_STEPS + dt]), [1, 1]) });
  }

  ready = true;
  postMessage({ type: "ready", voice: name, sampleRate: sr, ep: eps[0], threads: ort.env.wasm.numThreads, coi: !!self.crossOriginIsolated });
}

// ── streaming generation (upstream loop, single fixed voice) ──
async function generate(text, seq) {
  const { chunks, framesAfterEos } = chunksOf(text);
  if (!chunks.length) { postMessage({ type: "done", seq }); return; }

  let mimiState = initState(meta.mimi_state_manifest);
  const emptySeqT = T("float32", new Float32Array(0), [1, 0, latentDim]);
  const emptyText = T("float32", new Float32Array(0), [1, 0, condDim]);
  let flowState = { ...voiceState };

  const firstChunkFrames = 3, normalChunkFrames = 12;
  let isFirst = true, totalFrames = 0, genMs = 0;
  const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());

  for (let ci = 0; ci < chunks.length; ci++) {
    if (!generating || seq !== genSeq) return;
    if (ci > 0) { flowState = { ...voiceState }; mimiState = initState(meta.mimi_state_manifest); }

    const ids = tokenizer.encodeIds(chunks[ci]);
    const textIn = T("int64", BigInt64Array.from(ids.map((x) => BigInt(x))), [1, ids.length]);
    let emb = (await sessText.run({ token_ids: textIn }))[sessText.outputNames[0]];
    if (emb.dims.length === 2) emb = T("float32", new Float32Array(emb.data), [1, emb.dims[0], emb.dims[1]]);

    const cond = await sessMain.run({ sequence: emptySeqT, text_embeddings: emb, ...flowState });
    updateState(flowState, cond, meta.flow_lm_state_manifest);

    const latents = []; let decoded = 0;
    let curLatent = T("float32", new Float32Array(latentDim).fill(NaN), [1, 1, latentDim]);
    let eosStep = null, ended = false;

    for (let step = 0; step < MAX_FRAMES; step++) {
      if (!generating || seq !== genSeq) return;
      if (step > 0 && step % 4 === 0) await new Promise((r) => setTimeout(r, 0));

      const ts = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const ar = await sessMain.run({ sequence: curLatent, text_embeddings: emptyText, ...flowState });
      const eos = ar.eos_logit.data[0] > -4.0;
      if (eos && eosStep == null) eosStep = step;
      const stop = eosStep != null && step >= eosStep + framesAfterEos;

      const std = Math.sqrt(0.7);
      const lat = new Float32Array(latentDim);
      for (let i = 0; i < latentDim; i++) {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        lat[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * std;
      }
      const dt = 1.0 / LSD_STEPS;
      for (let l = 0; l < LSD_STEPS; l++) {
        const fr = await sessFlow.run({ c: ar.conditioning, s: stTensors[l].s, t: stTensors[l].t, x: T("float32", lat, [1, latentDim]) });
        const dir = fr.flow_dir.data;
        for (let i = 0; i < latentDim; i++) lat[i] += dir[i] * dt;
      }
      latents.push(new Float32Array(lat)); totalFrames++;
      curLatent = T("float32", lat, [1, 1, latentDim]);
      updateState(flowState, ar, meta.flow_lm_state_manifest);
      genMs += (typeof performance !== "undefined" ? performance.now() : Date.now()) - ts;

      const pending = latents.length - decoded;
      let n = 0;
      if (stop) n = pending;
      else if (isFirst && pending >= firstChunkFrames) n = firstChunkFrames;
      else if (pending >= normalChunkFrames) n = normalChunkFrames;

      if (n > 0) {
        const flat = new Float32Array(n * latentDim);
        for (let f = 0; f < n; f++) flat.set(latents[decoded + f], f * latentDim);
        const td = (typeof performance !== "undefined" ? performance.now() : Date.now());
        const dec = await sessDecode.run({ latent: T("float32", flat, [1, n, latentDim]), ...mimiState });
        genMs += (typeof performance !== "undefined" ? performance.now() : Date.now()) - td;
        for (const e of meta.mimi_state_manifest) mimiState[e.input_name] = dec[e.output_name];
        decoded += n;
        const audio = new Float32Array(dec[sessDecode.outputNames[0]].data);
        postMessage({ type: "chunk", seq, audio, sampleRate: sr, isFirst, isLast: stop && ci === chunks.length - 1 }, [audio.buffer]);
        isFirst = false;
      }
      if (stop) { ended = true; break; }
    }

    if (ended && ci < chunks.length - 1) {
      const gap = new Float32Array(Math.max(1, Math.floor(CHUNK_GAP_SEC * sr)));
      postMessage({ type: "chunk", seq, audio: gap, sampleRate: sr, isFirst: false, isLast: false, silence: true }, [gap.buffer]);
    }
  }

  const wall = ((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) / 1000;
  const audioSec = totalFrames * samplesPerFrame / sr;
  postMessage({ type: "done", seq, rtfx: genMs > 0 ? +(audioSec / (genMs / 1000)).toFixed(2) : 0, audioSec: +audioSec.toFixed(2), wall: +wall.toFixed(2) });
}

self.onmessage = async (e) => {
  const { type, data } = e.data || {};
  try {
    if (type === "load") {
      if (data) Object.assign(cfg, data);
      if (!ready) await load();
      else postMessage({ type: "ready", sampleRate: sr });
      return;
    }
    if (type === "stop") { generating = false; genSeq++; return; }
    if (type === "generate") {
      if (!ready) { postMessage({ type: "error", seq: data && data.seq, error: "not ready" }); return; }
      generating = true;
      const seq = (data && data.seq) || ++genSeq;
      genSeq = seq;
      await generate(data.text, seq);
      return;
    }
  } catch (err) {
    postMessage({ type: "error", seq: data && data.seq, error: String(err && err.stack || err) });
  }
};

postMessage({ type: "boot" });
