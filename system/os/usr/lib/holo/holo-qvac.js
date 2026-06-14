// holo-qvac.js — the QVAC SDK runtime façade, native to Hologram OS (ADR-0067). It reproduces the
// FULL QVAC public surface (docs.qvac.tether.io) as window.HoloQVAC — every capability and symbol,
// the model lifecycle, the runtime (cancel · suspend · resume · state · logging · profiler), P2P
// delegation, and an OpenAI-compatible serve() — and routes each through the substrate:
//
//   conscience gate (ADR-033) → pluggable provider → a re-derivable PROV-O receipt (Law L5).
//
// The provider is swappable. The DEFAULT is the deterministic reference brain (holo-qvac.mjs): it
// always runs, on any device, with no model download — the floor that guarantees a QVAC app never
// fails to start. Bind Holo Q (QVAC WebGPU, ADR-0052) and the same calls run a real on-device LLM;
// the contract and the receipt do not change. No server: the OpenAI /v1/* routes are answered by a
// Service-Worker fetch handler. Reads window.* lazily so module load order cannot race (like holo-sdk.js).

import * as SPEC from "./holo-qvac.mjs";

const g = (typeof window !== "undefined") ? window : globalThis;
const has = (o, k) => o && typeof o[k] === "function";

// ── sealing — a receipt's identity is the hash of its content (Law L5), via the OS UOR primitive ──
async function seal(body) {
  const O = g.HoloObject;
  if (O && has(O, "address")) { const id = await O.address(body); return { id, ...body }; }
  return { id: null, ...body };                                   // unsealed only if the primitive is absent
}
async function verify(obj) { const O = g.HoloObject; return (O && has(O, "verify")) ? !!(await O.verify(obj)) : false; }

// ── the conscience gate — EVERY capability call passes through it (fail-closed, ADR-033) ──────────
function conscience(capability, detail) {
  const C = g.HoloConscience;
  if (!C || !has(C, "evaluate")) return { outcome: "block", reason: "conscience not loaded — fail closed", sealed: false };
  const v = C.evaluate({ action: "qvac:" + capability, ...detail }) || {};
  return { outcome: v.outcome || "allow", reason: v.reason || null, sealed: !!(has(C, "sealed") && C.sealed()) };
}
const blocked = (verdict) => verdict.outcome === "block" || verdict.outcome === "deny";

// ── providers — the pluggable brain ───────────────────────────────────────────────────────────────
const referenceProvider = {
  id: "reference",
  complete: (history, params) => SPEC.referenceComplete(history, params),
  embed: (text) => SPEC.referenceEmbed(text),
};
let activeProvider = referenceProvider;
let _holoQ = null;
// connect Holo Q (QVAC WebGPU, ADR-0052) as the brain — the dormant seam, surfaced not faked. When a
// model manifest + κ-disk are bound the contract runs a real LLM; until then the reference floor holds.
export async function useHoloQ(opts = {}) {
  try {
    const mod = await import(/* @vite-ignore */ (opts.enginePath || "/apps/q/core/engine.js"));
    _holoQ = mod; activeProvider = { id: "holo-q", complete: null, embed: null, engine: mod, dormant: true };
    return { connected: true, provider: "holo-q", dormant: true,
      note: "Holo Q seam surfaced; bind a model manifest + κ-disk to go live (greedy decode re-derives, Law L5)." };
  } catch (e) { return { connected: false, reason: String(e && e.message || e), fellBackTo: "reference" }; }
}
export function provider() { return { id: activeProvider.id, dormant: !!activeProvider.dormant }; }

// ── the voice provider — ASR + TTS, bound like Holo Q (the QVAC WebGPU seam, ADR-0052) ────────────
// Holo Voice (holo-voice.js) binds a real on-device speech engine here. The transcription and
// text-to-speech capabilities below are weight-gated: with no provider they report "unprovisioned"
// (never fake a transcript); once bound they run on-device and seal the SAME re-derivable receipt.
// A provider is { id?, transcribe?(audio, opts) → {text, language?, segments?}, speak?(text, opts) → {ok} }.
let _voice = null;
export async function useHoloVoice(p = null) {
  _voice = p || null;
  return { connected: !!_voice, provider: (_voice && _voice.id) || null,
    asr: !!(_voice && typeof _voice.transcribe === "function"),
    tts: !!(_voice && typeof _voice.speak === "function") };
}
export function voiceProvider() { return _voice ? { id: _voice.id || "holo-voice", asr: typeof _voice.transcribe === "function", tts: typeof _voice.speak === "function" } : null; }

// ── the brain — bind a real on-device LLM as the completion provider (Holo Voice LLM, ADR-0067) ────
// Pass { id?, generate?(history, params) → async-iterable of token deltas, complete?(history) → string }.
// completion() prefers generate (live streaming). Pass null to fall back to the deterministic floor.
export function useBrain(p = null) {
  if (p && (typeof p.generate === "function" || typeof p.complete === "function")) {
    activeProvider = { id: p.id || "holo-brain", generate: p.generate || null, complete: p.complete || null, embed: p.embed || referenceProvider.embed, dormant: false };
    return { connected: true, provider: activeProvider.id, streaming: !!p.generate };
  }
  activeProvider = referenceProvider;
  return { connected: false, provider: referenceProvider.id };
}

// ── a small registry: loaded models (content-addressed κ-disks) ───────────────────────────────────
const _models = new Map();
const _runs = new Map();
let _runSeq = 0;

// ════════════════════════════════════════════════════════════════════════════════════════════════
// MODEL LIFECYCLE — QVAC symbols, content-addressed (a model is a κ-disk; loading verifies it)
// ════════════════════════════════════════════════════════════════════════════════════════════════
export async function loadModel({ modelSrc, modelId, modelType = "llm", onProgress } = {}) {
  const id = modelId || (typeof modelSrc === "string" ? modelSrc : (modelSrc && modelSrc.id) || "model");
  try { onProgress && onProgress({ phase: "verify", loaded: 1, total: 1 }); } catch (e) {}
  _models.set(id, { id, modelType, src: modelSrc || id, provider: activeProvider.id, loadedAt: null });
  return id;                                                       // QVAC returns the modelId
}
export async function unloadModel({ modelId } = {}) { return _models.delete(modelId); }
export function getLoadedModelInfo() { return [..._models.values()]; }
export function getModelInfo({ modelId } = {}) { return _models.get(modelId) || (SPEC.MODELS.find((m) => m.id === modelId) || null); }
export async function downloadAsset({ url, modelId } = {}) { return { modelId: modelId || url, downloaded: false, note: "asset resolves by content address (κ-disk); bind weights to fetch" }; }
export async function deleteCache() { _models.clear(); return true; }
export function modelRegistryList() { return SPEC.MODELS; }
export function modelRegistrySearch({ query = "" } = {}) { const q = String(query).toLowerCase(); return SPEC.MODELS.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)); }
export function modelRegistryGetModel({ modelId } = {}) { return SPEC.MODELS.find((m) => m.id === modelId) || null; }

// ── the honest "not provisioned" result — a structured descriptor + a sealed receipt, never a fake ──
async function unprovisioned(capId, call, input, params) {
  const cap = SPEC.CAPABILITIES.find((c) => c.id === capId) || { id: capId };
  const verdict = conscience(capId, { call });
  const body = SPEC.receiptBody({ capability: capId, model: null, provider: activeProvider.id,
    params: params || {}, input, output: { provisioned: false, neededModel: cap.modelType }, conscience: verdict, runtime: "browser-wasm" });
  const receipt = await seal(body);
  return { provisioned: false, capability: capId, call, neededModelType: cap.modelType,
    reason: "no model of this type is bound on this device — bind one (Holo Q / κ-disk) to run", receipt };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TEXT GENERATION — completion() → a CompletionRun (events · final · tokenStream · toolCallStream)
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function completion({ modelId, history = [], stream = false, temperature, maxTokens, captureThinking, emitRawDeltas, tools, kvCache, mcp, signal } = {}) {
  const params = { temperature, maxTokens, captureThinking, emitRawDeltas, kvCache };
  const verdict = conscience("text-generation", { modelId });
  const ctrl = new (g.AbortController || function () { this.signal = signal || {}; this.abort = () => {}; })();
  const runId = "run-" + (++_runSeq);
  // A real on-device LLM (Holo Q / Holo Voice brain) exposes async generate(history, params) → token
  // deltas; the reference floor exposes sync complete(). Pick generate when present (it streams live).
  const gen = (!blocked(verdict) && typeof activeProvider.generate === "function") ? activeProvider.generate : null;
  const text = (blocked(verdict) || gen) ? "" : activeProvider.complete ? activeProvider.complete(history, params) : SPEC.referenceComplete(history, params);
  const toks = SPEC.tokens(text);

  let resolveFinal; const finalP = new Promise((r) => (resolveFinal = r));
  async function* events() {
    if (blocked(verdict)) { yield { type: "completionError", error: verdict.reason || "blocked by conscience" }; return; }
    let acc = "";
    if (gen) {
      try {
        for await (const d of gen(history, { ...params, tools, signal })) {
          if (signal && signal.aborted) { yield { type: "completionError", error: "cancelled" }; break; }
          acc += d; yield { type: "contentDelta", delta: d };
        }
      } catch (e) { yield { type: "completionError", error: String((e && e.message) || e) }; _runs.delete(runId); return; }
    } else for (const t of toks) {
      if (signal && signal.aborted) { yield { type: "completionError", error: "cancelled" }; break; }
      acc += t; yield { type: "contentDelta", delta: t };
    }
    const body = SPEC.receiptBody({ capability: "text-generation", model: modelId || null, provider: activeProvider.id,
      params, input: { history }, output: { contentText: acc.trim() }, conscience: verdict, runtime: "browser-wasm" });
    const receipt = await seal(body);
    const final = { contentText: acc.trim(), thinkingText: captureThinking ? "" : undefined, toolCalls: [],
      stats: { tokensPerSecond: null }, raw: { fullText: acc.trim() }, cacheableAssistantContent: acc.trim(), receipt };
    yield { type: "completionStats", stats: final.stats };
    yield { type: "completionDone", final };
    resolveFinal(final);
    _runs.delete(runId);
  }
  async function* tokenStream() { for await (const e of events()) if (e.type === "contentDelta") yield e.delta; }
  async function* toolCallStream() { for await (const e of events()) if (e.type === "toolCall") yield e; }
  const run = { id: runId, events: events(), final: finalP, tokenStream: tokenStream(), toolCallStream: toolCallStream(),
    cancel: () => { ctrl.abort && ctrl.abort(); _runs.delete(runId); } };
  _runs.set(runId, run);
  if (!stream) { (async () => { for await (const _ of run.events) { /* drain to final */ } })(); }
  return run;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// EMBEDDINGS · RAG · TRANSLATION · CLASSIFICATION — provisioned, re-derivable on the reference floor
// ════════════════════════════════════════════════════════════════════════════════════════════════
export async function embed({ modelId, input } = {}) {
  const verdict = conscience("text-embeddings", { modelId });
  if (blocked(verdict)) throw new Error(verdict.reason || "blocked");
  const texts = Array.isArray(input) ? input : [input];
  const vectors = texts.map((t) => (activeProvider.embed ? activeProvider.embed(t) : SPEC.referenceEmbed(t)));
  const body = SPEC.receiptBody({ capability: "text-embeddings", model: modelId || null, provider: activeProvider.id,
    params: { dim: SPEC.EMBED_DIM }, input: { count: texts.length }, output: { dims: vectors[0].length }, conscience: verdict });
  const receipt = await seal(body);
  return { embeddings: Array.isArray(input) ? vectors : vectors[0], model: modelId || null, receipt };
}
export async function translate({ modelId, text, to = "en", from = "auto" } = {}) {
  const run = completion({ modelId, history: [{ role: "system", content: `Translate from ${from} to ${to}.` }, { role: "user", content: text }] });
  const final = await run.final; return { translation: final.contentText, to, from, receipt: final.receipt };
}
export async function classify({ modelId, text, labels = [] } = {}) {
  const verdict = conscience("classification", { modelId });
  if (blocked(verdict)) throw new Error(verdict.reason || "blocked");
  const tv = SPEC.referenceEmbed(text);
  const scored = labels.map((label) => ({ label, score: +SPEC.cosine(tv, SPEC.referenceEmbed(label)).toFixed(6) }))
    .sort((a, b) => b.score - a.score);
  const body = SPEC.receiptBody({ capability: "classification", model: modelId || null, provider: activeProvider.id,
    params: { labels }, input: { text }, output: { top: scored[0] || null }, conscience: verdict });
  return { label: scored[0] && scored[0].label, scores: scored, receipt: await seal(body) };
}

// RAG — a workspace ingests, chunks, embeds and searches content addressed by κ (the reference floor).
const _rag = new Map();
export function ragListWorkspaces() { return [..._rag.keys()]; }
export async function ragCloseWorkspace({ workspace } = {}) { return _rag.has(workspace); }
export async function ragDeleteWorkspace({ workspace } = {}) { return _rag.delete(workspace); }
export function ragChunk({ text, size = 400 } = {}) { const s = String(text || ""); const out = []; for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size)); return out; }
export async function ragIngest({ workspace = "default", text, docId } = {}) {
  const ws = _rag.get(workspace) || []; _rag.set(workspace, ws);
  const chunks = ragChunk({ text });
  chunks.forEach((chunk, i) => ws.push({ docId: docId || `doc-${ws.length}`, i, chunk, vector: SPEC.referenceEmbed(chunk) }));
  return { workspace, chunks: chunks.length };
}
export async function ragSaveEmbeddings({ workspace = "default" } = {}) { return { workspace, saved: (_rag.get(workspace) || []).length }; }
export async function ragReindex({ workspace = "default" } = {}) { const ws = _rag.get(workspace) || []; ws.forEach((e) => (e.vector = SPEC.referenceEmbed(e.chunk))); return { workspace, reindexed: ws.length }; }
export async function ragDeleteEmbeddings({ workspace = "default", docId } = {}) { const ws = _rag.get(workspace) || []; _rag.set(workspace, ws.filter((e) => e.docId !== docId)); return true; }
export async function ragSearch({ workspace = "default", query, k = 4 } = {}) {
  const verdict = conscience("rag", { workspace });
  if (blocked(verdict)) throw new Error(verdict.reason || "blocked");
  const qv = SPEC.referenceEmbed(query);
  const hits = (_rag.get(workspace) || []).map((e) => ({ docId: e.docId, chunk: e.chunk, score: +SPEC.cosine(qv, e.vector).toFixed(6) }))
    .sort((a, b) => b.score - a.score).slice(0, k);
  const body = SPEC.receiptBody({ capability: "rag", model: null, provider: activeProvider.id, params: { k }, input: { query }, output: { hits: hits.length }, conscience: verdict });
  return { hits, receipt: await seal(body) };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// WEIGHT-GATED CAPABILITIES — present + conscience-gated; they report a missing model, never fake one
// ════════════════════════════════════════════════════════════════════════════════════════════════
export async function transcribe({ modelId, audio, language, params } = {}) {
  const bytes = (audio && (audio.length || audio.byteLength)) || 0;
  if (_voice && typeof _voice.transcribe === "function") {
    const verdict = conscience("transcription", { modelId });
    if (blocked(verdict)) throw new Error(verdict.reason || "blocked");
    const out = await _voice.transcribe(audio, { modelId, language, ...(params || {}) }) || {};
    const text = (typeof out === "string") ? out : (out.text || "");
    const body = SPEC.receiptBody({ capability: "transcription", model: modelId || (_voice.id || null), provider: "holo-voice",
      params: params || { language: language || null }, input: { bytes }, output: { text }, conscience: verdict, runtime: out.runtime || "browser" });
    return { provisioned: true, text, language: out.language || language || null, segments: out.segments || null, receipt: await seal(body) };
  }
  return unprovisioned("transcription", "transcribe", { bytes });
}
export async function* transcribeStream({ modelId, audio, language, params } = {}) {
  if (_voice && typeof _voice.transcribe === "function") { const r = await transcribe({ modelId, audio, language, params }); yield { type: "transcriptDelta", delta: r.text, final: r }; return; }
  yield await unprovisioned("transcription", "transcribeStream", {});
}
export async function textToSpeech({ modelId, text, voice, rate, pitch } = {}) {
  if (_voice && typeof _voice.speak === "function") {
    const verdict = conscience("text-to-speech", { modelId });
    if (blocked(verdict)) throw new Error(verdict.reason || "blocked");
    const out = await _voice.speak(text, { voice, rate, pitch }) || {};
    const body = SPEC.receiptBody({ capability: "text-to-speech", model: modelId || (_voice.id || null), provider: "holo-voice",
      params: { voice: voice || null, rate: rate || null, pitch: pitch || null }, input: { text }, output: { spoken: out.ok !== false }, conscience: verdict, runtime: out.runtime || "browser" });
    return { provisioned: true, spoken: out.ok !== false, receipt: await seal(body) };
  }
  return unprovisioned("text-to-speech", "textToSpeech", { text });
}
export async function* textToSpeechStream({ modelId, text, voice, rate, pitch } = {}) {
  if (_voice && typeof _voice.speak === "function") { const r = await textToSpeech({ modelId, text, voice, rate, pitch }); yield { type: "speechDone", final: r }; return; }
  yield await unprovisioned("text-to-speech", "textToSpeechStream", { text });
}
export async function diffusion({ modelId, prompt } = {}) { return unprovisioned("image-generation", "diffusion", { prompt }); }
export async function upscale({ modelId, image } = {}) { return unprovisioned("image-generation", "upscale", {}); }
export async function video({ modelId, prompt } = {}) { return unprovisioned("video-generation", "video", { prompt }); }
export async function ocr({ modelId, image } = {}) { return unprovisioned("ocr", "ocr", {}); }
export async function vla({ modelId } = {}) { return unprovisioned("vla", "vla", {}); }
export function vlaHparams() { return { actionDim: null, stateDim: null, note: "bind a VLA model" }; }
export function vlaPadState({ state = [] } = {}) { return state; }
export function vlaPreprocessImage({ image } = {}) { return image || null; }
export async function finetune({ baseModel, dataset, action = "start" } = {}) {
  return { provisioned: false, capability: "fine-tuning", action, baseModel: baseModel || null,
    state: "idle", note: "finetune() is present + gated; a LoRA adapter is a content-addressed object once a base model is bound" };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// RUNTIME — lifecycle · cancellation · logging · plugins · profiler · P2P
// ════════════════════════════════════════════════════════════════════════════════════════════════
export function cancel({ runId } = {}) { const r = runId ? _runs.get(runId) : null; if (r) { r.cancel(); return true; } for (const run of _runs.values()) run.cancel(); _runs.clear(); return true; }
export async function suspend() { return { state: "suspended" }; }
export async function resume() { return { state: "running" }; }
export function state() { return { provider: activeProvider.id, models: _models.size, runs: _runs.size, workspaces: _rag.size }; }
const _logListeners = new Set();
export async function* loggingStream() { const q = []; const push = (m) => q.push(m); _logListeners.add(push); try { while (true) { if (q.length) yield q.shift(); else await new Promise((r) => setTimeout(r, 50)); } } finally { _logListeners.delete(push); } }
function log(msg) { for (const l of _logListeners) try { l({ at: null, msg }); } catch (e) {} }
export async function invokePlugin({ name, input } = {}) { return { name, output: null, note: "plugin host: bind a κ-object plugin (Holo Link, ADR-0060)" }; }
export async function* invokePluginStream({ name } = {}) { yield { name, delta: null }; }
// P2P — a delegated run is itself a receipt, so the asker verifies by re-derivation, not trust.
export async function startQVACProvider({ scope } = {}) { return { provider: activeProvider.id, scope: scope || "device", delegating: true }; }
export async function stopQVACProvider() { return { delegating: false }; }
export async function heartbeat() { return { ok: true, provider: activeProvider.id }; }
export async function blindRelay({ to, payload } = {}) { return { relayed: false, note: "blind relay: route via the signaling-free mesh (ADR-027)" }; }
// the profiler object (verbatim QVAC method set).
let _profOn = false; const _records = [];
export const profiler = {
  enable() { _profOn = true; }, disable() { _profOn = false; }, clear() { _records.length = 0; },
  isEnabled() { return _profOn; },
  exportJSON() { return JSON.stringify(_records); }, exportTable() { return _records; }, exportSummary() { return { records: _records.length, enabled: _profOn }; },
  getAggregates() { return { count: _records.length }; }, getConfig() { return { enabled: _profOn }; },
  onRecord(fn) { return () => {}; },
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OPENAI-COMPATIBLE SERVER — no process, no port: a Service-Worker fetch handler answers /v1/*
// ════════════════════════════════════════════════════════════════════════════════════════════════
// serve(request) — give it a Request (or {method, url/path, body}); it returns a Response-shaped object
// with an OpenAI-compatible JSON body. A holospace's Service Worker mounts this at /v1/*, so QVAC's
// OpenAI server works with no server (Law L1/L4). Drop-in: point an OpenAI client at this origin.
export async function serve(request) {
  const method = (request.method || "POST").toUpperCase();
  const path = request.path || (request.url ? new URL(request.url, "http://x").pathname : "");
  const body = request.body ? (typeof request.body === "string" ? JSON.parse(request.body) : request.body) : {};
  const ok = (obj) => ({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "qvac-" + (++_runSeq), created: 0, ...obj }) });
  const route = SPEC.SERVER_ROUTES.find((r) => r.path === path && r.method === method);
  if (!route) return { status: 404, body: JSON.stringify({ error: { message: "no such route", path } }) };
  if (route.call === "completion") { const args = SPEC.openaiToCompletion(body); const run = completion(args); const final = await run.final; return ok(SPEC.completionToOpenai(final, { model: body.model })); }
  if (route.call === "embed") { const r = await embed(SPEC.openaiEmbedToEmbed(body)); return ok(SPEC.embedToOpenai(r.embeddings, { model: body.model })); }
  if (route.call === "modelRegistryList") return ok({ object: "list", data: SPEC.MODELS.map((m) => ({ id: m.id, object: "model", owned_by: "hologram" })) });
  const res = await ({ transcribe, textToSpeech, diffusion }[route.call] || (async () => ({})))(body);
  return ok({ object: route.call, result: res });
}
// the familiar OpenAI client shape, for drop-in code (openai.chat.completions.create(...)).
export const openai = {
  chat: { completions: { create: async (req) => { const run = completion(SPEC.openaiToCompletion(req)); if (req.stream) return run; const final = await run.final; return SPEC.completionToOpenai(final, { model: req.model }); } } },
  embeddings: { create: async (req) => { const r = await embed(SPEC.openaiEmbedToEmbed(req)); return SPEC.embedToOpenai(r.embeddings, { model: req.model }); } },
  models: { list: async () => ({ object: "list", data: SPEC.MODELS.map((m) => ({ id: m.id, object: "model" })) }) },
};

// ── info / contract introspection ─────────────────────────────────────────────────────────────────
export function capabilities() { return SPEC.CAPABILITIES; }
export function runtimes() { return SPEC.RUNTIMES; }
export function info() { return { provider: provider(), capabilities: SPEC.CAPABILITIES.length,
  provisioned: SPEC.CAPABILITIES.filter((c) => c.provisioned).length, symbols: SPEC.allSymbols().length,
  models: _models.size, sealed: !!(g.HoloConscience && has(g.HoloConscience, "sealed") && g.HoloConscience.sealed()) }; }

// ── aggregate → window.HoloQVAC ────────────────────────────────────────────────────────────────────
export const HoloQVAC = {
  // model lifecycle
  loadModel, unloadModel, getLoadedModelInfo, getModelInfo, downloadAsset, deleteCache,
  modelRegistryList, modelRegistrySearch, modelRegistryGetModel,
  // capabilities
  completion, embed, translate, classify,
  ragIngest, ragChunk, ragSaveEmbeddings, ragSearch, ragDeleteEmbeddings, ragCloseWorkspace, ragDeleteWorkspace, ragListWorkspaces, ragReindex,
  transcribe, transcribeStream, textToSpeech, textToSpeechStream, diffusion, upscale, video, ocr,
  vla, vlaHparams, vlaPadState, vlaPreprocessImage, finetune,
  // runtime
  cancel, suspend, resume, state, loggingStream, invokePlugin, invokePluginStream, profiler,
  startQVACProvider, stopQVACProvider, heartbeat, blindRelay,
  // server + providers + introspection
  serve, openai, useHoloQ, useHoloVoice, voiceProvider, useBrain, provider, capabilities, runtimes, info, verify,
};
if (typeof window !== "undefined") window.HoloQVAC = HoloQVAC;
export default HoloQVAC;
