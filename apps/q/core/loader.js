// core/loader.js — model LOADING (the 5 substrate paths) + the model catalog + the
// browser-cache manager. Lifted faithfully from the original index.html so a model still
// loads byte-identically; the only change is that DOM status writes become onStatus/onProgress
// callbacks, and each path RETURNS { gpu, info, manifest, imageKappa } instead of mutating
// globals. core/engine.js then wraps the returned gpu. (window.__gpu / window.__kd handles are
// still exposed for the probe + system-monitor panels.)

import init, { kappa, qvac_load_model, qvac_load_gpu, qvac_tokenize, qvac_continue, qvac_gpu_manifest, qvac_gpu_tensor, qvac_gpu_free, qvac_panic_hook } from "../pkg/holospaces_web.js";
import { createQvacGPU } from "../qvac-gpu.js?v=68";   // v68 = fmt q1 (Bonsai binary) kernels
import { modelAsSource } from "./semantic.js";   // C2: a loaded model carries a W3C @type (schema:SoftwareSourceCode)

// the model κ-object's W3C linked-data view — content-addressed identity (Law L1) + schema.org type.
const modelLinkedData = (m, root) => modelAsSource({
  name: m.name, family: m.fam, params: m.size, format: m.fmt,
  kappa: root ? (String(root).startsWith("did:") ? root : "did:holo:" + String(root)) : "did:holo:sha256:0",
});

// The compiled κ-objects present on disk (models/<name>, built by compile2bit.mjs). Each loads
// DIRECT off the substrate (verified by re-derivation, no re-quant) via its `kappaUrl`.
// cap = max NEW tokens per turn; ctx = KV-cache positions allocated on the GPU (the context
// window — sized so agentic turns with tool schemas + tool responses fit; KV VRAM scales with it).
export const MODELS = [
  // NATIVELY-TERNARY κ-objects (t2, 1.58 bpw trained-in — see the atlas-bridge witness receipts):
  // Falcon-E: its declared ChatML template STALLS empirically (instant <|end_of_text|>); the
  // measured working frame is word-style "User:/Falcon:" with a textual stop (q-falcon-templates sweep).
  { fam: "Falcon-E", name: "Falcon-E-3B · ternary", kappaUrl: "https://huggingface.co/HOLOGRAMTECH/q-falcon-e-3b/resolve/main", manifestKappa: "did:holo:sha256:6b753fe8186f2b4194424115c36014698580a2aab8427e9b40365893ac6b77ca", size: "0.63 GB", fmt: "t2 1.58-bit κ", cap: 200, ctx: 3000, kv4: true, gpu: true, gpuOnly: true, chat: true, userWord: true, stopText: "\nUser:", tools: false, rep: 1.18, kappa: true },
  // holoUrl (H1/T2): ONE Range-streamed `.holo` (embedded tokenizer + BLAKE3 blocks + OPFS warm) —
  // cold 336 reqs→3, warm 0 network/~10ms. Fail-soft: until the file is uploaded to HF the first tiny
  // range request 404s and load self-heals to the parts path below (no regression). Publish = H4.
  // spec:true (D1 Q-DERIVED-MIND): speculative decode via the gpu's internal n-gram drafter — greedy
  // batched verify = BYTE-IDENTICAL output, self-throttles on miss streaks. Arms only where the spec
  // head is supported (resident + int4 KV); high-tier f32-KV devices fall through untouched. ?spec=0/1 A/B.
  { fam: "BitNet", name: "BitNet-2B-4T · ternary", canonical: true, spec: true, kappaUrl: "https://huggingface.co/HOLOGRAMTECH/q-bitnet-2b/resolve/main", holoUrl: "https://huggingface.co/HOLOGRAMTECH/q-bitnet-2b/resolve/main/q-bitnet-2b.v2.holo", holoMirrors: ["https://github.com/HOLOGRAM-TECHNOLOGIES/hologram-os/releases/download/wafer-bitnet-2b-v2/q-bitnet-2b.v2.holo"], manifestKappa: "did:holo:sha256:fcf835659d88d2fe6f683cf1ab8de6a6ba6214ea0deeee4b1bcf3da1a4c05412", size: "0.69 GB", fmt: "t2 1.58-bit κ", cap: 900, ctx: 3000, kv4: true, gpu: true, gpuOnly: true, chat: true, llama3: true, tools: false, bos: true, eosText: "<|eot_id|>", rep: 1.05, kappa: true },
  // FLOOR TIER (HOLO-ANY-BROWSER-500): Falcon-E-1B-Instruct — natively-ternary, chat-tuned, ~475 MB
  // resident. On integrated GPUs (where a normal browser lands) it decodes ~140 tok/s vs BitNet-2B's
  // ~40. Its OWN template is ChatML (<|im_start|>) — NOT the word-frame the 3B uses — eos <|end_of_text|>.
  // Published κ-object (2026-07-13, compiled from tiiuae Q8 by compile2bit): the old tiiuae kappaUrl had NO
  // manifest (404 — the floor tier was dead as a catalog entry); now pinned + loadable like every other tier.
  { fam: "Falcon-E-1B", name: "Falcon-E-1B · fast", kappaUrl: "https://huggingface.co/HOLOGRAMTECH/q-falcon-e-1b/resolve/main", manifestKappa: "did:holo:sha256:7f90fdbf86802782de84b4d4b35e7048b1239e941da224a56db22335cdc7b8d9", size: "0.37 GB", fmt: "t2 ternary κ", cap: 90, ctx: 3000, kv4: true, gpu: true, gpuOnly: true, chat: true, userWord: true, asstLabel: "Assistant", stopText: "\nUser:", floor: true, eosText: "<|end_of_text|>", rep: 1.3, kappa: true },
  // TriLM: the LARGEST natively-ternary-trained model (Spectra 3.9B, ICLR'25); per-row/channel
  // scale structure → t2r (trit codes + per-256-block scales, exact). BASE model → QA frame + stop.
  { fam: "TriLM", name: "TriLM-3.9B · ternary", kappaUrl: "https://huggingface.co/HOLOGRAMTECH/q-trilm-3.9b/resolve/main", manifestKappa: "did:holo:sha256:499032ceb19c0476345a72cf5fea6caec83054c98486c91a5891dfad0d25ea30", size: "0.87 GB", fmt: "t2r 2.1-bit κ", cap: 200, ctx: 3000, kv4: true, gpu: true, gpuOnly: true, chat: true, stopText: "\nQuestion:", tools: false, rep: 1.18, kappa: true },
  // AGENTIC CODER: Qwen2.5-Coder-7B (q3f) — the Holo Code agent brain. Qwen2.5 arch ⇒ ChatML +
  // agentic tool framing work (capability floor for tool use is ~7B; the small ternary models opt out).
  // Self-contained κ-object: tokenizer bundled (source="tokenizer.gguf"), no external dependency.
  { fam: "Qwen2.5-Coder", name: "Qwen2.5-Coder-7B · agentic", kappaUrl: "https://huggingface.co/HOLOGRAMTECH/q-qwen-coder-7b/resolve/main", manifestKappa: "did:holo:sha256:539941cb060c7dd583e2e86697e53f2c5d511d597c65d09d9c780fbded2c3edf", size: "3.4 GB", fmt: "q3f κ", cap: 900, ctx: 3000, kv4: true, gpu: true, gpuOnly: true, chat: true, code: true, qwen: true, rep: 1.05, kappa: true },
  // MIXTURE-OF-EXPERTS (G5): OLMoE-1B-7B (Allen AI, Apache-2.0) — 64 experts, 8 active/token, ~1.3B
  // active of 7B. The first RESIDENT-MoE κ-object: experts RAM-resident + CPU top-k router (softmax
  // over all 64, no renorm = OLMoE norm_topk_prob:false). q4 (the engine's resident expert FFN path).
  { fam: "OLMoE", name: "OLMoE-1B-7B · MoE (64×8)", kappaUrl: "https://huggingface.co/HOLOGRAMTECH/q-olmoe-1b-7b/resolve/main", manifestKappa: "did:holo:sha256:9cf97ec1c761fd4ef51bc0cd4ac37a0cd8eaa11f1b19b3ae6a141486ad3fe5ad", size: "3.6 GB", fmt: "q4 MoE κ", cap: 400, ctx: 3000, kv4: false, gpu: true, gpuOnly: true, chat: true, olmo: true, bos: true, eosText: "<|endoftext|>", tools: false, rep: 1.1, kappa: true },
  // DIFFUSION (G6): Dream-7B (Dream-org/Dream-v0-Instruct-7B) — masked-diffusion LM on the Qwen2.5-7B
  // backbone (same dims ⇒ ChatML). NOT autoregressive: generation is iterative bidirectional unmasking
  // over `steps` denoising passes (engine.diffuse / gpu.diffuse), wall-clock fixed by steps not length.
  // maskId 151666 rides in the manifest (never tokenized from text). Greedy ⇒ deterministic ⇒ κ-re-derivable.
  { fam: "Dream", name: "Dream-7B · diffusion", kappaUrl: "https://huggingface.co/HOLOGRAMTECH/q-dream-7b/resolve/main", manifestKappa: "did:holo:sha256:7b862931ae088f348f1f7e9ea3adbd418924c2e07e6ddd134f926e5681ad760d", size: "2.9 GB", fmt: "q3f diffusion κ", cap: 192, ctx: 192, kv4: false, gpu: true, gpuOnly: true, chat: true, qwen: true, diffusion: true, steps: 12, rep: 1.0, kappa: true },
  // BONSAI κ-STREAM (the second brain): PrismML Bonsai-8B — the first BINARY rung. Qwen3-8B moved
  // end-to-end into {−1,+1} sign bits (1.125 bpw TRUE average — embed + lm_head included, no
  // mixed-precision escape hatches) by Bonsai's Caltech representation, and passed through
  // compile2bit q1 mode UNTOUCHED (no re-quant: the κ-object IS the published Apache-2.0 model,
  // re-laid for the GPU). Engine fmt q1 (mmQ1Kernel — sign-select GEMV, f32 scale per 128).
  // First light 2026-07-15: 15.5 tok/s resident, coherent thinking-mode output (bonsai-test.html).
  // kappaUrl 404s until the HF upload lands (H4-style publish); local dev serves the minted dir.
  { fam: "Bonsai", name: "Bonsai-8B · 1-bit", kappaUrl: "https://huggingface.co/HOLOGRAMTECH/q-bonsai-8b/resolve/main", holoUrl: "https://huggingface.co/HOLOGRAMTECH/q-bonsai-8b/resolve/main/q-bonsai-8b.v1.holo", manifestKappa: "did:holo:sha256:a0dc81f26ec5ce98b28ee9c1fab620e91c20720f777e1de6bc416317f54d27e2", size: "1.16 GB", fmt: "q1 1-bit κ", cap: 900, ctx: 3000, kv4: true, gpu: true, gpuOnly: true, chat: true, qwen: true, rep: 1.05, kappa: true },
  // Qwen κ-objects (q3f/q4) were pruned from disk for space — re-derive via compile2bit, then re-list.
];
const kvOf = (m) => Math.max(96, (m.ctx || m.cap) + 8);

const _sizeGb = (s) => { const n = parseFloat(s) || 0; return /mb/i.test(s) ? n / 1024 : n; };
// default to the SMALLEST usable model — lowest latency, fastest first answer.
// CANONICAL Q BRAIN = BitNet-2B (operator decision 2026-07-09): the entry marked `canonical` wins;
// `floor:true` fast-tier entries never become the default (they're opt-in speed modes, honest small-1B
// quality). Fallback ordering (no canonical entry present): smallest usable non-floor.
export const defaultModelIndex = () => {
  const usable = MODELS.map((m, i) => i).filter((i) => !MODELS[i].disabled);
  const canon = usable.find((i) => MODELS[i].canonical);
  if (canon != null) return canon;
  const nonFloor = usable.filter((i) => !MODELS[i].floor);
  return ((nonFloor.length ? nonFloor : usable).sort((a, b) => _sizeGb(MODELS[a].size) - _sizeGb(MODELS[b].size))[0]) ?? 0;
};

// ── wasm init (once) + tokenizer re-export so the rest of the app shares this instance ──
let _initOnce = null;
export function ready() { if (!_initOnce) _initOnce = init().then(() => { try { qvac_panic_hook(); } catch {} }); return _initOnce; }
export { qvac_tokenize, qvac_continue, kappa };

// ── browser-cache model manager (Cache API) — "Get" downloads + keeps; loading uses the copy ──
export const MCACHE = "holo-q-models";
const absUrl = (u) => new URL(u, location.href).href;
// HOST-OVERRIDABLE model origin. A host adapter (e.g. the Discord Activity, where a direct huggingface.co
// fetch is connect-src-blocked) sets window.HOLO_HF_PROXY to a SAME-ORIGIN proxied prefix (e.g. "/hf",
// mapped host-side to huggingface.co). Unset on native/CEF/HF-space hosts → weights load direct (unchanged).
// The κ-cache is content-address (κ) keyed, not origin keyed, so swapping the origin keeps warm-0 reloads.
const hfProxy = (u) => { const b = (typeof window !== "undefined" && window.HOLO_HF_PROXY) || ""; return (b && typeof u === "string") ? u.replace("https://huggingface.co", b) : u; };
let _cachedUrls = new Set();
export async function refreshCached() { try { const c = await caches.open(MCACHE); _cachedUrls = new Set((await c.keys()).map((r) => r.url)); } catch { _cachedUrls = new Set(); } return _cachedUrls; }
export const isCached = (m) => !!m.url && _cachedUrls.has(absUrl(m.url));
export async function deleteCache(m) { try { const c = await caches.open(MCACHE); await c.delete(m.url); } catch {} await refreshCached(); }
async function modelBytes(m, onStatus) {
  try { const c = await caches.open(MCACHE); const hit = await c.match(m.url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch {}
  onStatus?.(`Downloading ${m.name} (${m.size})…`);
  const res = await fetch(m.url); if (!res.ok) { onStatus?.("download failed: HTTP " + res.status); return null; }
  return new Uint8Array(await res.arrayBuffer());
}

const noop = () => {};

// loadModel(entry, { onStatus, onProgress }) → { gpu, info, manifest, imageKappa } | null
// `imageKappa` is the VERIFIED content address of the weights when the path provides one
// (κ-object root, or κ-disk image_kappa); core/engine.js binds it as the receipt's model κ.
export async function loadModel(m, { onStatus = noop, onProgress = noop } = {}) {
  await ready();
  onStatus(`Loading ${m.name}…`);
  try {
    if (m.gpuOnly && !navigator.gpu) { onStatus("This model needs WebGPU (not available here)."); return null; }
    if (m.kappaUrl)   return await loadKappa(m, onStatus, onProgress);
    if (m.kdisk)      return await loadModelKDisk(m, onStatus, onProgress);
    if (m.remote)     return await loadModelRemote(m, onStatus, onProgress);
    if (m.diskIngest) return await loadModelDisk(m, onStatus, onProgress);
    let gguf = await modelBytes(m, onStatus); if (!gguf) { onStatus("could not load model"); return null; }
    const lr = JSON.parse(m.gpuOnly ? qvac_load_gpu(gguf) : qvac_load_model(gguf));
    gguf = null;
    if (lr.error) { onStatus("model error: " + lr.error); return null; }
    let gpu = null, manifest = null;
    if (navigator.gpu && m.gpu) {
      try {
        onStatus(`Uploading ${m.name} to the GPU…`);
        const bits = m.q4 ? 4 : 8;
        manifest = JSON.parse(qvac_gpu_manifest(bits)); manifest.twoBit = !!window.__twoBit;
        const __qp = new URLSearchParams(location.search).get("stream");
        const __qmode = __qp === null ? undefined : (__qp === "resident" || __qp === "false" ? false : __qp);
        const stream = __qmode ?? window.__stream ?? m.stream ?? false;
        const __ft = (name) => { const raw = qvac_gpu_tensor(name, bits); return window.__weightHook ? window.__weightHook(name, raw, bits, manifest) : raw; };
        gpu = await createQvacGPU(manifest, __ft, kvOf(m), lr.eos ?? 2, stream);
        window.__gpu = gpu; qvac_gpu_free();
      } catch (e) { gpu = null; if (m.gpuOnly) { onStatus("GPU upload failed: " + e); return null; } }
    }
    onStatus("");
    return { gpu, info: lr, manifest, imageKappa: null };
  } catch (e) { onStatus("could not load model: " + e); return null; }
}

// LOAD-DIRECT: a pre-compiled 2-bit/Q4 κ-object (compile2bit.mjs output). Weights arrive ALREADY
// quantized (no re-quant at load); the tokenizer comes from the source GGUF's header only.
async function loadKappa(m, onStatus, onProgress) {
  const _mk = (window.__loadMarks = { t0: performance.now() });   // W0: per-stage load marks
  onStatus("Loading κ-object manifest…");
  const ld = await import("../holo-load2bit.mjs?v=2");
  // Law L5: pin the manifest κ when the catalog supplies one (m.manifestKappa, or a string m.kappa).
  // Until every model carries a pin, unpinned entries load explicitly (allowUnpinned) — the gap is then
  // a visible data task (populate manifestKappa), not a silent trust of an unauthenticated root.
  const pin = (typeof m.manifestKappa === "string" && m.manifestKappa) || (typeof m.kappa === "string" && m.kappa) || null;
  const __b3 = (typeof window !== "undefined" && window.__blake3Map) || undefined;   // inject canonical map (test BLAKE3 axis before the HF upload)
  const ing = await import("../qvac-ingest.mjs");
  let manifest, fetchTensor, info, fetchCanon, headerBytes = null, usedHolo = false, sealed = null;
  // INSTANT SINGLE-FILE LOAD (H1/T2): a catalog `holoUrl` → ONE Range-streamed `.holo` (embedded
  // tokenizer, BLAKE3-verified blocks, OPFS-warm) instead of 330 loose block requests. Fail-soft:
  // any error (no holoUrl, host without Range, corrupt file) drops to the proven parts path below.
  if (m.holoUrl && (typeof window === "undefined" || window.__noholo !== true)) {
    try {
      const hs = await import("./holo-stream-load.mjs");
      // W3 (Q-WAFER): m.holoMirrors = alternate dumb static origins for the SAME bytes (κ makes
      // them interchangeable) — the reader races first-response and fails over per-block.
      const r = await hs.openHoloKappa(hfProxy(m.holoUrl), { mirrors: (m.holoMirrors || []).map((u) => hfProxy(u)), onProgress: (d, t) => onProgress(d, t, "streaming") });
      manifest = r.manifest; fetchTensor = r.fetchTensor; fetchCanon = r.fetchTensor; info = r.info;
      headerBytes = r.tokenizerBytes; usedHolo = true;
      sealed = r.sealed || null;                              // W2: wafer-sealed KV commons → engine restores instead of prefilling
      _mk.holoWarm = !!r.warm;
      // W1 (Q-WAFER) honest marks: % of the wire that had arrived when the reader returned — proof
      // the engine build pipelines BEHIND the download instead of waiting for the last byte.
      _mk.holoStream = r.progress || null;
      try { if (r.progress) _mk.holoReturnPct = r.progress().pct; } catch {}
    } catch (e) { try { console.warn("[loader] .holo path failed, falling back to parts:", e && e.message || e); } catch {} }
  }
  if (!usedHolo) {
    const r = await ld.loadKappaObject(hfProxy(m.kappaUrl).replace(/\/+$/, ""), { ...(pin ? { expectKappa: pin } : { allowUnpinned: true }), blake3Map: __b3 });
    manifest = r.manifest; fetchTensor = r.fetchTensor; fetchCanon = r.fetchTensor; info = r.info;
  }
  _mk.manifestMs = Math.round(performance.now() - _mk.t0);
  onStatus("Building tokenizer (source header, no full download)…");
  // WARM TOKENIZER (W1): the source GGUF header (tokenizer) is ~MBs fetched from HF on EVERY boot —
  // cache it κ-sealed in the same OPFS store as the KV commons; verified on read, purged on mismatch.
  // (The .holo path already carries the tokenizer bytes inline → headerBytes set, both fetches skipped.)
  let _kvc = null, _hdrKey = null;
  if (!headerBytes) {
    try { _kvc = await import("./kv-commons.mjs"); _hdrKey = _kvc.commonsKey(["hdr1", pin || info.source || m.kappaUrl]); } catch {}
    if (_hdrKey) { try { const got = await _kvc.load(_hdrKey); if (got) headerBytes = got.bytes; } catch {} }
    if (!headerBytes) {
      const hdr = await ing.readHeader(hfProxy(info.source), ing.rangeReader());
      headerBytes = hdr.headerBytes;
      if (_hdrKey) { try { _kvc.save(_hdrKey, headerBytes, { kind: "gguf-header", src: String(info.source || "") }); } catch {} }
    }
  }
  const lr = JSON.parse(qvac_load_gpu(headerBytes));
  if (lr.error) { onStatus("tokenizer error: " + lr.error); return null; }
  if (m.eosText) { try { const e = JSON.parse(qvac_tokenize(m.eosText)).ids; if (e && e.length === 1) lr.eos = e[0]; } catch {} }   // chat-stop override (e.g. LLaMA-3 <|eot_id|> ≠ header eos)
  qvac_gpu_free();
  _mk.tokenizerMs = Math.round(performance.now() - _mk.t0) - _mk.manifestMs;
  // Q1 (HOLO-Q-500): KV format is a DEVICE-TIER POLICY, not a hardcoded flag. int4 KV (E6) is
  // LOSSY and measured ~3× slower than f32 on high-tier GPUs — its only virtue is memory
  // (BitNet ctx3000: f32 KV ≈ 460 MB vs 72 MB). Policy: high tier (≥1 GiB storage binding) with
  // affordable KV → EXACT f32 (faster AND lossless); constrained devices → kv4 as before.
  // Catalog semantics: kv4:"force" pins int4; kv4:false stays f32; kv4:true = "int4 if needed".
  // ?kv4=0/1 overrides for A/B. KV-commons layouts are format-keyed → a tier flip re-prefills once.
  let _kv4 = m.kv4 === "force" ? true : !!m.kv4;
  try {
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("kv4") : null;
    if (q != null) _kv4 = q !== "0";
    else if (m.kv4 === true && navigator.gpu) {
      const ad = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      const maxBind = (ad && ad.limits && ad.limits.maxStorageBufferBindingSize) || 0;
      const kvBytes = 2 * (manifest.n_layers || 0) * kvOf(m) * ((manifest.n_kv_heads || 0) * (manifest.hd || 0)) * 4;
      if (maxBind >= (1 << 30) && kvBytes > 0 && kvBytes <= 700e6) _kv4 = false;
    }
  } catch {}
  manifest.kv4 = _kv4;
  // MoE forward reads the layer-packed attention (Wb[l]) + RAM-resident experts (readExpert via
  // fetchTensor) — i.e. stream="layer": attention JS-resident & paged per token, experts cached.
  const sm = manifest.moe ? "layer" : (m.stream || window.__kappaStream || false);
  // WARM WEIGHTS (W1): resident models keep their fetched+decompressed parts in OPFS, κ-sealed —
  // the second visit reads disk instead of network+gunzip (measured: partsMs was 4.4 s of the
  // 4.6 s warm resident phase). Verified on every read; any mismatch purges + refetches (L5).
  fetchTensor = fetchCanon;
  // The .holo path carries its OWN OPFS single-file warm store; only the loose-parts path needs the
  // per-block parts-cache. Skip it under usedHolo (avoids a redundant second OPFS copy).
  if (!usedHolo && !sm && !manifest.moe && !(typeof window !== "undefined" && window.__nopartscache)) {
    try {
      const pc = await (await import("./parts-cache.mjs")).openPartsCache(pin || m.kappaUrl);
      if (pc) { window.__partsCache = pc; fetchTensor = async (name) => { const hit = await pc.get(name); if (hit) return hit; const b = await fetchCanon(name); pc.put(name, b); return b; }; }
    } catch {}
  }
  onStatus(`Building engine from κ-object (${info.mode === "q4" ? "native Q4" : info.incoherent ? "incoherent 2-bit" : "LDLQ 2-bit"}, ${sm || "resident"}, no requant)…`);
  const prog = (done, total) => onProgress(done, total, "streaming");
  const gpu = await createQvacGPU(manifest, fetchTensor, kvOf(m), lr.eos ?? 2, sm, sm ? prog : null);
  _mk.engineMs = Math.round(performance.now() - _mk.t0) - _mk.manifestMs - _mk.tokenizerMs;
  // W1 marks at engine-ready: first tensor served at N% of the wire (pipelining proof), engine done at M%.
  try { if (_mk.holoStream) { const p = _mk.holoStream(); _mk.holoFirstTensorPct = p.marks.firstTensorPct; _mk.holoEnginePct = p.pct; } } catch {}
  window.__gpu = gpu;
  onStatus("");
  return { gpu, info: lr, manifest, imageKappa: info.root || null, ld: modelLinkedData(m, info.root), ...(sealed ? { sealed } : {}) };
}

// Very-large-model path: the GGUF never enters wasm; only the header does (tokenizer + manifest),
// then each tensor is streamed off disk (HTTP Range), converted in JS, paged to the GPU per layer.
async function loadModelDisk(m, onStatus, onProgress) {
  const bits = m.q4 ? 4 : 8;
  const ing = await import("../qvac-ingest.mjs");
  let read = ing.rangeReader();
  try { const cachedResp = await (await caches.open(MCACHE)).match(m.url); if (cachedResp) { const blob = await cachedResp.blob(); read = async (_u, start, len) => new Uint8Array(await blob.slice(start, start + len).arrayBuffer()); } } catch {}
  onStatus(`Reading ${m.name} header…`);
  const hdr = await ing.readHeader(m.url, read);
  const lr = JSON.parse(qvac_load_gpu(hdr.headerBytes));
  if (lr.error) { onStatus("model error: " + lr.error); return null; }
  const manifest = JSON.parse(qvac_gpu_manifest(bits));
  qvac_gpu_free();
  const fetchTensor = ing.makeDiskFetcher({ url: m.url, readRange: read, dataOffset: hdr.dataOffset, tensors: hdr.tensors, manifest, bits });
  const mode = m.stream || "layer";
  onStatus(`Preparing ${m.name} (one-time, streamed off disk)…`);
  const gpu = await createQvacGPU(manifest, fetchTensor, kvOf(m), lr.eos ?? 2, mode, (d, t) => onProgress(d, t, "layers"));
  window.__gpu = gpu; onStatus("");
  return { gpu, info: lr, manifest, imageKappa: null };
}

// Out-of-core: stream a PRE-BUILT .qvf frames file from the server, one layer per token via HTTP Range.
async function loadModelRemote(m, onStatus, onProgress) {
  onStatus(`Loading ${m.name} index…`);
  const index = await (await fetch(m.framesUrl + ".json")).json();
  const url = m.framesUrl;
  const rr = async (off, len) => { const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } }); if (!r.ok && r.status !== 206) throw new Error("HTTP " + r.status); return new Uint8Array(await r.arrayBuffer()); };
  const header = await rr(index.headerOff, index.headerLen);
  const lr = JSON.parse(qvac_load_gpu(header));
  if (lr.error) { onStatus("model error: " + lr.error); return null; }
  const manifest = index.manifest; qvac_gpu_free();
  const fetchTensor = async (name) => { const s = index.singles[name]; return s ? await rr(s.off, s.len) : new Uint8Array(0); };
  const frameStore = { ready: true, read: (off, len) => rr(index.layersOff + off, len), readExpert: (l, e, role) => { const ri = { gate: 0, up: 1, down: 2 }[role]; const off = index.expertsOff + ((l * index.nExperts + e) * 3 + ri) * index.expertBytes; return rr(off, index.expertBytes); } };
  const layersBytes = (index.packStride || 0) * (index.n_layers || 0) + (manifest.moe ? (index.nExperts * 3 * index.expertBytes * index.n_layers) : 0);
  const cacheBudget = window.__cacheGB != null ? window.__cacheGB * 1073741824 : Math.min(layersBytes, 12 * 1073741824);
  onStatus(`Preparing ${m.name} (served off disk)…`);
  const gpu = await createQvacGPU(manifest, fetchTensor, kvOf(m), lr.eos ?? 2, "remote", (d, t) => onProgress(d, t, "remote"), frameStore, cacheBudget);
  window.__gpu = gpu; onStatus("");
  return { gpu, info: lr, manifest, imageKappa: null };
}

// HOLOGRAM: load through a content-addressed κ-DISK — every sector VERIFIED by re-derivation (Law L3/L5).
async function loadModelKDisk(m, onStatus, onProgress) {
  onStatus(`Resolving ${m.name} κ-disk…`);
  const index = await (await fetch(m.kdiskUrl)).json();
  const { makeKDisk } = await import("../qvac-kdisk.mjs");
  const bases = window.__kdiskSources || m.kdiskSources || [location.origin];
  const sources = bases.map((b) => b.replace(/\/$/, "") + "/" + (index.dataFile || (m.dataUrl || "").replace(/^\.\//, "")));
  const kd = makeKDisk({ index, sources });
  window.__kd = kd;
  const iv = await kd.verifyImage();
  if (!iv.ok) { onStatus("κ-disk image_kappa mismatch — refusing to load"); return null; }
  const rr = kd.rr, qvf = index.qvf;
  const header = await rr(qvf.headerOff, qvf.headerLen);
  const lr = JSON.parse(qvac_load_gpu(header));
  if (lr.error) { onStatus("model error: " + lr.error); return null; }
  const manifest = qvf.manifest; qvac_gpu_free();
  const fetchTensor = async (name) => { const s = qvf.singles[name]; return s ? await rr(s.off, s.len) : new Uint8Array(0); };
  const frameStore = { ready: true, read: (off, len) => rr(qvf.layersOff + off, len),
    readExpert: async (l, e, role) => { const ri = { gate: 0, up: 1, down: 2 }[role]; const blkOff = qvf.expertsOff + (l * qvf.nExperts + e) * 3 * qvf.expertBytes; const blk = await rr(blkOff, 3 * qvf.expertBytes); return blk.slice(ri * qvf.expertBytes, (ri + 1) * qvf.expertBytes); } };
  const layersBytes = (qvf.packStride || 0) * (qvf.n_layers || 0) + (manifest.moe ? (qvf.nExperts * 3 * qvf.expertBytes * qvf.n_layers) : 0);
  const cacheBudget = window.__cacheGB != null ? window.__cacheGB * 1073741824 : Math.min(layersBytes, 1024 * 1048576);
  onStatus(`Realizing ${m.name} (verified off κ-disk)…`);
  const gpu = await createQvacGPU(manifest, fetchTensor, kvOf(m), lr.eos ?? 2, "remote", (d, t) => onProgress(d, t, "κ-disk"), frameStore, cacheBudget);
  window.__gpu = gpu;
  const st = kd.stats(); onStatus(`${index.imageKappa.slice(0, 22)}…  · ${st.verified} sectors verified`);
  return { gpu, info: lr, manifest, imageKappa: kd.imageKappa || index.imageKappa || null };
}

// loadFromQ(qk) — load a model from a Q@κ resident handle (content-addressed store). The canonical build does not
// ship the substrate path, so this gracefully returns null and the caller falls back to loadModel (HF streaming).
// (Kept as an export so the standalone chat's optional `?q=<κ>` path resolves without the substrate dependency.)
export async function loadFromQ() { return null; }
