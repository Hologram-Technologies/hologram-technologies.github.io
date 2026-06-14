// holo-q-ai.js — the hologram-ai seam: the general model COMPILER + a CPU inference FLOOR.
//
// Holo Q's primary brain is the hand-built WebGPU ternary engine (apps/q/core/engine.js +
// qvac-gpu.js): native 1.58-bit Falcon-E / BitNet / TriLM, OLMoE MoE, the Qwen2.5-Coder agent.
// That engine is faster and more verifiable than anything here — this module does NOT replace it.
//
// What hologram-ai (ADR-0017, the Rust ONNX→.holo compiler built to wasm) UNIQUELY adds:
//
//   1. A GENERAL compiler — any ONNX model → a `.holo` archive, in the browser, with no server.
//      The archive is bytes, so it is a content-addressed κ-object: compiling is a κ-transform
//      (κ(onnx) ⊕ κ(compiler) → κ(holo)), re-derivable like every other object on the substrate.
//      This broadens the catalog beyond the ternary κ-objects compile2bit.mjs produces.
//
//   2. A CPU inference FLOOR — the same archive runs (forward pass / autoregressive generate) on
//      pure WebAssembly, no WebGPU. Every current Holo Q model is gpuOnly; this is the tier that
//      answers on a device with no WebGPU, above the deterministic reference brain (holo-qvac.mjs)
//      and below the WebGPU engine. It binds through the EXISTING HoloQVAC.useBrain() seam — no
//      change to the façade, the contract, or the receipt.
//
// DOM-free and dependency-free (no crypto here): content-addressing is the caller's job, via the
// OS UOR primitive (HoloObject.address / kappaBytes), exactly as holo-qvac.mjs leaves sealing to
// its caller. Pure wrapper over the vendored wasm-bindgen module.

const WASM_DIR = "./vendor/hologram-ai-wasm/hologram_ai_wasm.js";

let _mod = null;            // the initialized wasm-bindgen module namespace
let _initOnce = null;       // init promise (idempotent)
let _engineBytes = null;    // the wasm bytes (for engineKappa)

// ── init (once) ─────────────────────────────────────────────────────────────────────────────────
// Resolve + initialize the vendored wasm — dual-mode so the SAME module runs in the browser (the
// Holo Q app, a Service Worker) AND in Node (the MCP server + the conformance witness). We read the
// wasm bytes ourselves so the same bytes can be content-addressed (engineBytes → compiler κ) without
// a second load: in Node via fs + initSync (fetch can't read file://); in the browser via fetch +
// the wasm-pack default init.
const _isNode = typeof process !== "undefined" && !!(process.versions && process.versions.node) && typeof window === "undefined";
export function ready(opts = {}) {
  if (_initOnce) return _initOnce;
  const jsUrl = new URL(opts.enginePath || WASM_DIR, import.meta.url);
  const wasmUrl = new URL("./hologram_ai_wasm_bg.wasm", jsUrl);
  _initOnce = (async () => {
    const mod = await import(/* @vite-ignore */ jsUrl.href);
    if (_isNode) {
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      _engineBytes = new Uint8Array(readFileSync(fileURLToPath(wasmUrl)));
      mod.initSync({ module: _engineBytes });
    } else {
      try { _engineBytes = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer()); } catch (e) { _engineBytes = null; }
      await mod.default(_engineBytes ? { module_or_path: _engineBytes } : undefined);
    }
    try { mod.start(); } catch (e) {}
    _mod = mod;
    return mod;
  })();
  return _initOnce;
}

// the engine is itself a κ-object — the wasm bytes' content address (the caller hashes; we expose
// the bytes). Returns null until ready() has fetched them.
export function engineBytes() { return _engineBytes; }

// ── the compiler as a κ-transform ─────────────────────────────────────────────────────────────────
// compile(onnx) → a `.holo` archive (Uint8Array). The real ModelCompiler pipeline (import →
// optimize → lower → compile) runs in the browser. The caller content-addresses the result.
export async function compile({ onnx } = {}) {
  const mod = await ready();
  const bytes = onnx instanceof Uint8Array ? onnx : new Uint8Array(onnx);
  if (!bytes.length) throw new Error("compile: empty onnx input");
  return mod.compile(bytes);                                       // Uint8Array (.holo bytes)
}

// describe(holo) → { inputs:[{name,dtype,dtype_name,element_count,shape,bytes}], outputs:[…] }.
export async function describe({ archive } = {}) {
  const mod = await ready();
  return mod.describe(archive instanceof Uint8Array ? archive : new Uint8Array(archive));
}

// run(holo, inputs?, fill?) → [{ dtype, dtype_name, element_count, values:number[] }] — one
// arbitrary forward pass (mirrors the CLI `run --fill`). `inputs` is an array of Uint8Array by
// graph-input index; omitted/empty entries are synthesized from `fill` (default zeros).
export async function run({ archive, inputs = null, fill = null } = {}) {
  const mod = await ready();
  return mod.run(archive instanceof Uint8Array ? archive : new Uint8Array(archive), inputs, fill);
}

// generate(holo, prompt, opts) → the full generated string. Real autoregressive loop on CPU wasm.
// opts: { prompt_template?, max_tokens?, temperature?, top_k?, stop?:string[], eos?, seed? }.
export async function generateText({ archive, tokenizerJson = null, prompt, opts = {} } = {}) {
  const mod = await ready();
  const holo = archive instanceof Uint8Array ? archive : new Uint8Array(archive);
  const tok = tokenizerJson ? (tokenizerJson instanceof Uint8Array ? tokenizerJson : new Uint8Array(tokenizerJson)) : undefined;
  return mod.generate(holo, tok, String(prompt || ""), opts);     // string
}

// ── the CPU inference floor — a provider bindable via HoloQVAC.useBrain() ──────────────────────────
// createCpuProvider(cfg) → { id, generate(history, params) → async-iterable token deltas, embed? }.
// `generate` builds a prompt from the chat history (a simple, overridable template), runs the CPU
// loop once, then yields the result in whitespace-token deltas so the OS completion() stream
// contract holds. CPU wasm generation is blocking — for long outputs, host this in a Web Worker
// (the provider shape is unchanged); kept on-thread here so the floor is dependency-free.
const DEFAULT_TEMPLATE = (history) => history
  .map((m) => (m.role === "system" ? m.content : `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`))
  .join("\n") + "\nAssistant:";

export function createCpuProvider(cfg = {}) {
  const { archive, tokenizerJson = null, modelId = "hologram-ai-cpu", template = DEFAULT_TEMPLATE,
    maxTokens = 64, temperature = 0, topK, stop = [] } = cfg;
  if (!archive) throw new Error("createCpuProvider: a compiled `.holo` archive is required");
  const buildPrompt = typeof template === "function" ? template : DEFAULT_TEMPLATE;

  async function* generate(history = [], params = {}) {
    const prompt = buildPrompt(history);
    const opts = {
      max_tokens: params.maxTokens ?? maxTokens,
      temperature: params.temperature ?? temperature,
      top_k: params.topK ?? topK,
      stop: params.stop ?? stop,
    };
    let text = "";
    try { text = await generateText({ archive, tokenizerJson, prompt, opts }); }
    catch (e) { throw new Error("holo-q-ai CPU floor: " + String((e && e.message) || e)); }
    // yield in whitespace-token deltas (the same streaming unit the reference floor uses).
    const toks = String(text).match(/\S+\s*/g) || [text];
    for (const t of toks) {
      if (params.signal && params.signal.aborted) break;
      yield t;
    }
  }

  return { id: modelId, generate };
}

// bind the CPU floor as the active completion provider in one call (needs HoloQVAC loaded).
// Returns the useBrain() result, or a structured reason if the OS façade isn't present.
export async function bindCpuFloor(cfg = {}) {
  const g = (typeof window !== "undefined") ? window : globalThis;
  const Q = g.HoloQVAC;
  if (!Q || typeof Q.useBrain !== "function") return { connected: false, reason: "HoloQVAC.useBrain not loaded" };
  await ready();
  return Q.useBrain(createCpuProvider(cfg));
}

export default { ready, engineBytes, compile, describe, run, generateText, createCpuProvider, bindCpuFloor };
