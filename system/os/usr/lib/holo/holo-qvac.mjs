// holo-qvac.mjs — THE one source of the QVAC SDK, encoded native to Hologram OS (ADR-0067).
//
// QVAC (docs.qvac.tether.io) is Tether's local AI SDK — a single npm package, one unified JS/TS
// interface over 13 AI capabilities, that runs on a personal device with no cloud (Apache-2.0). Its
// runtimes are Node, Bare and Expo. Hologram OS does NOT import that package: a package is location,
// and the substrate addresses by content (Law L1). Instead this file ENCODES the QVAC contract — its
// every capability, its every public symbol, its OpenAI-compatible server, its runtime + model
// lifecycle — as data, and the substrate SATISFIES it: each call is conscience-gated, runs over the
// browser-native engine the substrate already has, and seals a re-derivable receipt (Law L5).
//
// So a builder writes QVAC code and it just runs — beautiful, fast, lean, serverless, on the one OS.
// This is the contract + the deterministic reference brain (the always-run floor) + the receipt shape
// + the OpenAI mapping + the dereferenceable ontology. Pure + isomorphic: the witness runs it in Node,
// the façade (holo-qvac.js) runs it in the browser. No crypto here — sealing is done by the caller
// (the façade's HoloObject, the witness's holo-object.mjs), so this stays dependency-free.

// ── the runtimes ─────────────────────────────────────────────────────────────────────────────────
// QVAC ships three (Node · Bare · Expo). The substrate ADDS the one QVAC lacks — the browser itself,
// WebAssembly + WebGPU, serverless and content-addressed — which is why a QVAC app becomes a holospace
// that opens from a link and runs on any device with nothing installed.
export const RUNTIMES = [
  { id: "node", label: "Node.js", upstream: true },
  { id: "bare", label: "Bare", upstream: true },
  { id: "expo", label: "Expo", upstream: true },
  { id: "browser-wasm", label: "Browser (WebAssembly + WebGPU)", upstream: false,
    note: "The substrate's native runtime — serverless, content-addressed, opens from a link." },
];

// ── the 13 AI capabilities ───────────────────────────────────────────────────────────────────────
// Each names the QVAC public symbols it is invoked by (verbatim, docs.qvac.tether.io/reference/api),
// the model class it needs, whether a substrate backend produces a real result NOW (`provisioned`),
// and the checkable obligation it holds. `provisioned:true` capabilities run on the deterministic
// reference brain or by composing one that does (so they re-derive today); the rest are surfaced
// honestly — a call returns a structured descriptor + a receipt, never a faked output (Law L5 voice).
export const CAPABILITIES = [
  { id: "text-generation", label: "Text Generation", api: ["completion"], modelType: "llm", provisioned: true,
    obligation: "completion() streams a CompletionRun (events · final · tokenStream) and seals a receipt that re-derives." },
  { id: "text-embeddings", label: "Text Embeddings", api: ["embed"], modelType: "embedding", provisioned: true,
    obligation: "embed() returns a fixed-width vector that is a pure function of the text — same text, same vector." },
  { id: "rag", label: "Retrieval-Augmented Generation",
    api: ["ragIngest", "ragChunk", "ragSaveEmbeddings", "ragSearch", "ragDeleteEmbeddings", "ragCloseWorkspace", "ragDeleteWorkspace", "ragListWorkspaces", "ragReindex"],
    modelType: "embedding", provisioned: true,
    obligation: "A workspace ingests, chunks, embeds and searches content addressed by κ; search ranks by the embedding above." },
  { id: "translation", label: "Translation", api: ["translate"], modelType: "llm", provisioned: true,
    obligation: "translate() routes through completion with a target language and seals the same re-derivable receipt." },
  { id: "classification", label: "Classification", api: ["classify"], modelType: "embedding", provisioned: true,
    obligation: "classify() scores labels by embedding nearness — a pure function of (text, labels), re-derivable." },
  { id: "multimodal", label: "Multimodal", api: ["completion"], modelType: "vlm", provisioned: false,
    obligation: "completion() accepts image inputs when a vision model is bound; otherwise the call reports the missing model." },
  { id: "image-generation", label: "Image Generation", api: ["diffusion", "upscale"], modelType: "diffusion", provisioned: false,
    obligation: "diffusion()/upscale() are present and conscience-gated; without a diffusion model bound the call reports it, never fakes pixels." },
  { id: "video-generation", label: "Video Generation", api: ["video"], modelType: "video", provisioned: false,
    obligation: "video() is present and gated; it reports the missing model rather than returning an empty stand-in." },
  { id: "transcription", label: "Transcription (ASR)", api: ["transcribe", "transcribeStream"], modelType: "asr", provisioned: false,
    obligation: "transcribe()/transcribeStream() are present and gated; they report the missing ASR model honestly." },
  { id: "text-to-speech", label: "Text to Speech", api: ["textToSpeech", "textToSpeechStream"], modelType: "tts", provisioned: false,
    obligation: "textToSpeech()/textToSpeechStream() are present and gated; they report the missing TTS model honestly." },
  { id: "voice-assistant", label: "Voice Assistant", api: ["transcribe", "completion", "textToSpeech"], modelType: "pipeline", provisioned: false,
    obligation: "The voice pipeline composes transcribe → completion → textToSpeech; it runs once those models are bound." },
  { id: "vla", label: "Vision-Language-Action", api: ["vla", "vlaHparams", "vlaPadState", "vlaPreprocessImage"], modelType: "vla", provisioned: false,
    obligation: "vla() and its helpers are present and gated; without a VLA model the call reports it." },
  { id: "ocr", label: "OCR", api: ["ocr"], modelType: "ocr", provisioned: false,
    obligation: "ocr() is present and gated; it reports the missing OCR model rather than inventing text." },
  { id: "fine-tuning", label: "Fine-tuning (LoRA)", api: ["finetune"], modelType: "llm", provisioned: false,
    obligation: "finetune() starts/stops/resumes a run and reports its state; the adapter is a content-addressed object." },
];

// ── model lifecycle ───────────────────────────────────────────────────────────────────────────────
// QVAC's model management, plus the substrate's contribution: a model is a κ-disk (content-addressed,
// every sector re-derived before use), so loading is verifying and a tampered weight is refused.
export const MODEL_API = [
  "loadModel", "unloadModel", "getLoadedModelInfo", "getModelInfo",
  "downloadAsset", "deleteCache", "modelRegistryList", "modelRegistrySearch", "modelRegistryGetModel",
];
// predefined model descriptors (the QVAC symbol kept verbatim) — here a content-addressed κ-disk.
// `decode` names the token-production family (default "autoregressive"); a model whose backend is
// not yet bound carries `provisioned:false` and is surfaced honestly (never a faked output, L5 voice).
export const MODELS = [
  { id: "LLAMA_3_2_1B_INST_Q4_0", label: "Llama 3.2 1B Instruct (Q4_0)", modelType: "llm", decode: "autoregressive", format: "gguf" },
  { id: "QWEN_2_5_0_5B_INST_Q4_0", label: "Qwen 2.5 0.5B Instruct (Q4_0)", modelType: "llm", decode: "autoregressive", format: "gguf" },
  { id: "NOMIC_EMBED_TEXT_V1_5", label: "Nomic Embed Text v1.5", modelType: "embedding", format: "gguf" },
  // Dream v0 Instruct 7B — a masked-DIFFUSION LM on a Qwen2.5-7B backbone (Dream-org). Decode is
  // bidirectional denoising over a fixed step schedule, not left-to-right; validated deterministic
  // (temperature=0 → byte-identical output κ), so it satisfies the same re-derivable receipt model
  // as greedy AR (ADR-0083). The WebGPU masked-diffusion decode kernel is the pending work: until a
  // backend is bound, completion() reports it (provisioned:false) rather than faking tokens.
  { id: "DREAM_V0_INSTRUCT_7B", label: "Dream v0 Instruct 7B (diffusion)", modelType: "llm", decode: "diffusion", params: "7B", format: "holo-q4", provisioned: false },
];
// the decode families a κ-disk can declare — both are deterministic transforms over content-addressed
// inputs, so both re-derive (Law L5). Autoregression fixes one token per sequential pass; diffusion
// finalizes a whole block over a fixed denoising schedule (forward-pass count set by `steps`, not by
// output length). The receipt is decode-agnostic — it commits to params (incl. the schedule) either way.
export const DECODE = [
  { id: "autoregressive", label: "Autoregressive", note: "one token per sequential forward pass; greedy decode re-derives token-for-token (ADR-0052)." },
  { id: "diffusion", label: "Masked diffusion", note: "iterative bidirectional unmasking over a fixed step schedule; temperature=0 re-derives block-for-block (ADR-0083)." },
];

// ── runtime: lifecycle · cancellation · logging · profiler ────────────────────────────────────────
export const RUNTIME_API = {
  lifecycle: ["cancel", "suspend", "resume", "state"],
  logging: ["loggingStream"],
  plugins: ["invokePlugin", "invokePluginStream"],
  profiler: ["enable", "disable", "clear", "isEnabled", "exportJSON", "exportTable", "exportSummary", "getAggregates", "getConfig", "onRecord"],
};

// ── P2P — delegated inference + blind relays ──────────────────────────────────────────────────────
// QVAC delegates inference across peers. On the substrate a delegated run is itself a receipt, so the
// asker verifies the answer by re-derivation instead of trusting the peer.
export const P2P_API = ["startQVACProvider", "stopQVACProvider", "heartbeat", "blindRelay"];

// ── the OpenAI-compatible server ──────────────────────────────────────────────────────────────────
// QVAC can expose an OpenAI-compatible HTTP server. On the substrate there is no server: these routes
// are answered by a Service-Worker fetch handler (the façade's serve()), so the same /v1/* API works
// with no process, no port, no cloud. Each route maps to a capability above.
export const SERVER_ROUTES = [
  { path: "/v1/chat/completions", method: "POST", capability: "text-generation", call: "completion" },
  { path: "/v1/embeddings", method: "POST", capability: "text-embeddings", call: "embed" },
  { path: "/v1/audio/transcriptions", method: "POST", capability: "transcription", call: "transcribe" },
  { path: "/v1/audio/speech", method: "POST", capability: "text-to-speech", call: "textToSpeech" },
  { path: "/v1/images/generations", method: "POST", capability: "image-generation", call: "diffusion" },
  { path: "/v1/models", method: "GET", capability: null, call: "modelRegistryList" },
];

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE FUNCTIONAL CORE — pure, deterministic, re-derivable. No crypto, no DOM, no network.
// ════════════════════════════════════════════════════════════════════════════════════════════════

// a tiny pure canonicalizer (RFC 8785 subset: sorted keys) so this file stays dependency-free; the
// caller hashes the bytes it returns. Matches holo-uor.mjs jcs for the object shapes used here.
export function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}

// FNV-1a — a pure, fast, deterministic hash (NOT cryptographic; only for the reference brain's
// reproducible token walk + embedding, which must re-derive identically in Node and the browser).
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// referenceEmbed(text, dim) — a deterministic, fixed-width embedding (a pure function of the text).
// The always-run floor for embeddings / RAG / classification: real vectors, no model download, and
// the SAME text always yields the SAME vector (so a receipt over it re-derives, Law L5). Bind a real
// embedding model (Holo Q seam) for semantic quality; this guarantees the loop always runs.
export const EMBED_DIM = 256;
export function referenceEmbed(text, dim = EMBED_DIM) {
  const v = new Array(dim).fill(0);
  const toks = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
  for (const t of toks) { const h = fnv1a(t); v[h % dim] += 1; v[(h >>> 8) % dim] += 0.5; }
  let n = Math.hypot(...v) || 1;
  return v.map((x) => +(x / n).toFixed(6));
}
// cosine similarity over two reference embeddings (pure).
export function cosine(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; }

// referenceComplete(history, params) — the deterministic reference brain. It is NOT a large language
// model: it is the always-run floor that proves the whole loop (request → tokens → sealed receipt)
// works on any device with no download, and re-derives byte-for-byte. Greedy + deterministic: the
// same (history, params) always yields the same tokens. Bind Holo Q (QVAC WebGPU, ADR-0052) for a
// real LLM — the façade swaps the provider, the contract and the receipt are unchanged.
const REF_VOCAB = ["the", "this", "holospace", "runs", "on", "your", "device", "private", "verified",
  "by", "content", "address", "serverless", "and", "fast", "answer", "is", "ready", "now"];
export function referenceComplete(history, params = {}) {
  const prompt = (history || []).map((m) => `${m.role}:${m.content}`).join("\n");
  const seedKey = canon({ prompt, params: { temperature: params.temperature ?? 0, maxTokens: params.maxTokens ?? 64 } });
  let h = fnv1a(seedKey);
  const max = Math.min(Math.max(8, params.maxTokens || 48), 128);
  const terms = String((history || []).filter((m) => m.role !== "system").map((m) => m.content).join(" "))
    .toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 6);
  const out = [];
  for (let i = 0; i < max; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x01000193) >>> 0;               // a deterministic xorshift-ish walk
    const word = (i % 5 === 2 && terms.length) ? terms[h % terms.length] : REF_VOCAB[h % REF_VOCAB.length];
    out.push(word);
    if (i > 10 && word === "now") break;                            // a deterministic stop
  }
  let text = out.join(" ");
  text = text.charAt(0).toUpperCase() + text.slice(1) + ".";
  return text;
}

// tokens(text) — the streaming unit (whitespace tokens), so the façade can stream a CompletionRun.
export function tokens(text) { return String(text).match(/\S+\s*/g) || []; }

// ── the inference receipt (PROV-O) ────────────────────────────────────────────────────────────────
// receiptBody({...}) returns the CANONICAL receipt body (no id) — the caller seals it (computes the
// did:holo over canon(body)). It commits to model κ ⊕ history κ ⊕ params κ ⊕ engine κ → output, plus
// the conscience verdict. Identical inputs yield an identical body → an identical κ (the O(1) memo);
// a tampered output changes the κ → refused. This is QVAC's "local inference" made PROVABLE.
export function receiptBody({ capability, model, provider, params, input, output, conscience, runtime = "browser-wasm" }) {
  return {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      { schema: "https://schema.org/", prov: "http://www.w3.org/ns/prov#",
        hosqvac: "https://hologram.os/ns/qvac#" },
    ],
    "@type": ["prov:Activity", "hosqvac:InferenceReceipt"],
    "hosqvac:capability": capability,
    "hosqvac:provider": provider || "reference",
    "hosqvac:runtime": runtime,
    "prov:used": {
      "hosqvac:model": model || null,
      "hosqvac:input": input,
      "hosqvac:params": params || {},
    },
    "prov:generated": { "hosqvac:output": output },
    "hosqvac:conscience": conscience || { outcome: "allow", sealed: false },
  };
}

// ── the OpenAI-compatible request/response mapping (pure, round-trippable) ─────────────────────────
// openaiToCompletion(req) — an OpenAI /v1/chat/completions body → completion() arguments.
export function openaiToCompletion(req = {}) {
  return {
    modelId: req.model,
    history: req.messages || [],
    stream: !!req.stream,
    temperature: req.temperature,
    maxTokens: req.max_tokens,
    tools: req.tools,
  };
}
// completionToOpenai(final, {model}) — a completion final → an OpenAI chat.completion response.
export function completionToOpenai(final = {}, { model } = {}) {
  const content = final.contentText != null ? final.contentText : final.text || "";
  return {
    object: "chat.completion",
    model: model || final.model || null,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: null, completion_tokens: (tokens(content) || []).length, total_tokens: null },
  };
}
// openaiEmbedToEmbed / embedToOpenai — the embeddings route mapping.
export function openaiEmbedToEmbed(req = {}) { return { modelId: req.model, input: req.input }; }
export function embedToOpenai(vectors, { model } = {}) {
  const arr = Array.isArray(vectors[0]) ? vectors : [vectors];
  return { object: "list", model: model || null,
    data: arr.map((embedding, index) => ({ object: "embedding", index, embedding })) };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE DEREFERENCEABLE ONTOLOGY (hosqvac:) — the QVAC contract as W3C linked data.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const NS = "https://hologram.os/ns/qvac";
export function toOntology() {
  const term = (id, type, label, comment, extra = {}) => ({ "@id": `hosqvac:${id}`, "@type": type, label, comment, isDefinedBy: NS, ...extra });
  return {
    "@context": {
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      owl: "http://www.w3.org/2002/07/owl#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      skos: "http://www.w3.org/2004/02/skos/core#",
      dcterms: "http://purl.org/dc/terms/",
      schema: "https://schema.org/",
      prov: "http://www.w3.org/ns/prov#",
      hosqvac: "https://hologram.os/ns/qvac#",
      label: "rdfs:label",
      comment: "rdfs:comment",
      subClassOf: { "@id": "rdfs:subClassOf", "@type": "@id" },
      isDefinedBy: { "@id": "rdfs:isDefinedBy", "@type": "@id" },
      inScheme: { "@id": "skos:inScheme", "@type": "@id" },
      prefLabel: "skos:prefLabel",
      api: "hosqvac:api",
      modelType: "hosqvac:modelType",
      provisioned: "hosqvac:provisioned",
      obligation: "hosqvac:obligation",
    },
    "@id": NS,
    "@type": "owl:Ontology",
    label: "Hologram OS — QVAC SDK, encoded native (hosqvac:)",
    comment: "The QVAC SDK (docs.qvac.tether.io) encoded as a self-verifying contract on the substrate (ADR-0067): its 13 AI capabilities, runtime + model lifecycle, P2P delegation and OpenAI-compatible server, each a checkable obligation. Mints only the genuinely-new QVAC terms (Capability · InferenceReceipt · Provider · Runtime · api · provisioned); provenance and activity reuse PROV-O, schema.org and DID Core unchanged. Re-derived from holo-qvac.mjs (no drift).",
    "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/",
    "dcterms:source": "https://docs.qvac.tether.io/",
    "@graph": [
      term("SDK", "rdfs:Class", "QVAC SDK", "The encoded QVAC contract: one local AI interface satisfied by the substrate, serverless and content-addressed.", { subClassOf: "skos:ConceptScheme" }),
      term("Capability", "rdfs:Class", "AI Capability", "One QVAC AI capability (text generation, embeddings, RAG, …), invoked by named public symbols and holding a checkable obligation.", { subClassOf: "skos:Concept" }),
      term("InferenceReceipt", "rdfs:Class", "Inference Receipt", "A PROV-O activity that proves one inference: it commits to model ⊕ input ⊕ params ⊕ engine → output and a conscience verdict, and re-derives to its content address (Law L5).", { subClassOf: "prov:Activity" }),
      term("Provider", "rdfs:Class", "Inference Provider", "A pluggable brain behind the contract: the deterministic reference provider (the always-run floor) or an on-device model engine (Holo Q / QVAC WebGPU).", { subClassOf: "prov:SoftwareAgent" }),
      term("Runtime", "rdfs:Class", "Runtime", "A host the SDK runs on: QVAC's Node · Bare · Expo, plus the substrate's browser (WebAssembly + WebGPU).", { subClassOf: "skos:Concept" }),
      term("api", "rdf:Property", "api symbol", "A public QVAC symbol a capability is invoked by (kept verbatim for familiarity).", { range: "xsd:string" }),
      term("modelType", "rdf:Property", "model type", "The model class a capability needs (llm · embedding · diffusion · asr · tts · vlm · vla · ocr).", { range: "xsd:string" }),
      term("provisioned", "rdf:Property", "provisioned", "Whether a substrate backend produces a real, re-derivable result now (true) or the call honestly reports a missing model (false).", { range: "xsd:boolean" }),
      term("obligation", "rdf:Property", "obligation", "The checkable rule a capability holds. OS-specific QVAC term.", { range: "xsd:string" }),
      { "@id": `${NS}#capabilities`, "@type": ["skos:ConceptScheme", "hosqvac:SDK"],
        prefLabel: "QVAC AI capabilities — 13, encoded native (ADR-0067)",
        comment: "The QVAC capability surface, each a substrate obligation.", "dcterms:license": "https://creativecommons.org/publicdomain/zero/1.0/" },
      ...CAPABILITIES.map((c) => ({
        "@id": `hosqvac:${c.id}`, "@type": ["skos:Concept", "hosqvac:Capability"],
        prefLabel: c.label, api: c.api, modelType: c.modelType, provisioned: c.provisioned, obligation: c.obligation,
        inScheme: `${NS}#capabilities`,
      })),
      ...RUNTIMES.map((r) => ({ "@id": `hosqvac:runtime-${r.id}`, "@type": ["skos:Concept", "hosqvac:Runtime"], prefLabel: r.label })),
    ],
  };
}

// the union of every public symbol the contract surfaces — the witness checks the façade carries each.
export function allSymbols() {
  const caps = CAPABILITIES.flatMap((c) => c.api);
  const prof = RUNTIME_API.profiler.map((m) => `profiler.${m}`);
  return [...new Set([...caps, ...MODEL_API, ...RUNTIME_API.lifecycle, ...RUNTIME_API.logging, ...RUNTIME_API.plugins, ...P2P_API, ...prof])];
}

export const PROVENANCE = "QVAC SDK © Tether (Apache-2.0, docs.qvac.tether.io). Encoded native — not vendored — under holospaces Laws L1/L2/L4/L5 (github.com/Hologram-Technologies/holospaces).";

if (typeof globalThis !== "undefined") globalThis.HoloQVACSpec = {
  RUNTIMES, CAPABILITIES, MODEL_API, MODELS, DECODE, RUNTIME_API, P2P_API, SERVER_ROUTES,
  canon, referenceEmbed, cosine, referenceComplete, tokens, EMBED_DIM,
  receiptBody, openaiToCompletion, completionToOpenai, openaiEmbedToEmbed, embedToOpenai,
  toOntology, allSymbols, PROVENANCE,
};
