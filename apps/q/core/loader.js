// core/loader.js — model LOADING (the 5 substrate paths) + the model catalog + the
// browser-cache manager. Lifted faithfully from the original index.html so a model still
// loads byte-identically; the only change is that DOM status writes become onStatus/onProgress
// callbacks, and each path RETURNS { gpu, info, manifest, imageKappa } instead of mutating
// globals. core/engine.js then wraps the returned gpu. (window.__gpu / window.__kd handles are
// still exposed for the probe + system-monitor panels.)

import init, { kappa, qvac_load_model, qvac_load_gpu, qvac_tokenize, qvac_continue, qvac_gpu_manifest, qvac_gpu_tensor, qvac_gpu_free, qvac_panic_hook } from "../pkg/holospaces_web.js";
import { createQvacGPU } from "../qvac-gpu.js?v=63";
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
  { fam: "BitNet", name: "BitNet-2B-4T · ternary", kappaUrl: "https://huggingface.co/HOLOGRAMTECH/q-bitnet-2b/resolve/main", manifestKappa: "did:holo:sha256:fcf835659d88d2fe6f683cf1ab8de6a6ba6214ea0deeee4b1bcf3da1a4c05412", size: "0.69 GB", fmt: "t2 1.58-bit κ", cap: 900, ctx: 3000, kv4: true, gpu: true, gpuOnly: true, chat: true, llama3: true, tools: false, bos: true, eosText: "<|eot_id|>", rep: 1.05, kappa: true },
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
  // Qwen κ-objects (q3f/q4) were pruned from disk for space — re-derive via compile2bit, then re-list.
];
const kvOf = (m) => Math.max(96, (m.ctx || m.cap) + 8);

const _sizeGb = (s) => { const n = parseFloat(s) || 0; return /mb/i.test(s) ? n / 1024 : n; };
// default to the SMALLEST usable model — lowest latency, fastest first answer.
export const defaultModelIndex = () => (MODELS.map((m, i) => i).filter((i) => !MODELS[i].disabled).sort((a, b) => _sizeGb(MODELS[a].size) - _sizeGb(MODELS[b].size))[0]) ?? 0;

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
  onStatus("Loading κ-object manifest…");
  const ld = await import("../holo-load2bit.mjs?v=2");
  // Law L5: pin the manifest κ when the catalog supplies one (m.manifestKappa, or a string m.kappa).
  // Until every model carries a pin, unpinned entries load explicitly (allowUnpinned) — the gap is then
  // a visible data task (populate manifestKappa), not a silent trust of an unauthenticated root.
  const pin = (typeof m.manifestKappa === "string" && m.manifestKappa) || (typeof m.kappa === "string" && m.kappa) || null;
  const __b3 = (typeof window !== "undefined" && window.__blake3Map) || undefined;   // inject canonical map (test BLAKE3 axis before the HF upload)
  const { manifest, fetchTensor, info } = await ld.loadKappaObject(hfProxy(m.kappaUrl).replace(/\/+$/, ""), { ...(pin ? { expectKappa: pin } : { allowUnpinned: true }), blake3Map: __b3 });
  const ing = await import("../qvac-ingest.mjs");
  onStatus("Building tokenizer (source header, no full download)…");
  const hdr = await ing.readHeader(hfProxy(info.source), ing.rangeReader());
  const lr = JSON.parse(qvac_load_gpu(hdr.headerBytes));
  if (lr.error) { onStatus("tokenizer error: " + lr.error); return null; }
  if (m.eosText) { try { const e = JSON.parse(qvac_tokenize(m.eosText)).ids; if (e && e.length === 1) lr.eos = e[0]; } catch {} }   // chat-stop override (e.g. LLaMA-3 <|eot_id|> ≠ header eos)
  qvac_gpu_free();
  manifest.kv4 = !!m.kv4;                                  // int4 KV cache (E6) — catalog opt-in
  // MoE forward reads the layer-packed attention (Wb[l]) + RAM-resident experts (readExpert via
  // fetchTensor) — i.e. stream="layer": attention JS-resident & paged per token, experts cached.
  const sm = manifest.moe ? "layer" : (m.stream || window.__kappaStream || false);
  onStatus(`Building engine from κ-object (${info.mode === "q4" ? "native Q4" : info.incoherent ? "incoherent 2-bit" : "LDLQ 2-bit"}, ${sm || "resident"}, no requant)…`);
  const prog = (done, total) => onProgress(done, total, "streaming");
  const gpu = await createQvacGPU(manifest, fetchTensor, kvOf(m), lr.eos ?? 2, sm, sm ? prog : null);
  window.__gpu = gpu;
  onStatus("");
  return { gpu, info: lr, manifest, imageKappa: info.root || null, ld: modelLinkedData(m, info.root) };
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
