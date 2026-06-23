// holo-voice-llm.mjs — the on-device language model (the agent brain) for Holo Voice, Phase 2.
//
// It binds into the QVAC completion seam (HoloQVAC.useBrain) so HoloQVAC.completion() runs a REAL LLM
// instead of the deterministic reference floor — entirely in the browser, no inference server, no audio
// or text leaving the device. Same vendoring pattern as holo-voice-asr.mjs: transformers.js + ORT wasm
// + a quantized instruct model resolve same-origin (tools/vendor-voice-model.mjs), verified by sha256
// (Law L5), cached offline. WASM by default (any-browser floor); WebGPU is opt-in for speed.

const DEFAULTS = {
  lib: "vendor/transformers/transformers.js",
  ortPath: "vendor/transformers/",
  localPath: "vendor/models/",
  // ONE any-browser brain that covers general conversation AND agentic coding (ADR-0096): the verified
  // best compact coder, Qwen2.5-Coder-1.5B-Instruct at q8, on transformers.js — WASM is the any-browser
  // default, WebGPU where it works. The light 0.5B is the responsive FALLBACK (also if the coder isn't
  // vendored yet). q8 (not fp16) per the research. WebGPU on this stack can abort on some HW → WASM floor.
  webgpu: { model: "onnx-community/Qwen2.5-Coder-1.5B-Instruct", dtype: "q8" },   // same model, GPU when available
  wasm: { model: "onnx-community/Qwen2.5-Coder-1.5B-Instruct", dtype: "q8" },     // any-browser brain + coder
  wasmFallback: { model: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q8" },   // responsive floor / not-yet-vendored fallback
  maxTokens: 256,
  preferWebGPU: false,    // WASM floor is the default; opt into WebGPU after verifying it on real HW.
  proxy: true,            // run onnxruntime-web in a Web Worker so load/generation never freezes the UI.
  // κ-served brain (opt-in): serve the brain's ONNX files from its .holo (HTTP-Range + per-block L5 + OPFS +
  // serverless) into the SAME transformers.js engine — so the any-browser WASM floor is content-addressed/warm,
  // not a flat download. Activates only for the spec whose model === knativeServe.modelId; ANY failure restores
  // fetch + falls back to the vendored ONNX. null = off. (Pending: forge + pin the brain ONNX file-bundle .holo.)
  knativeServe: null,     // e.g. { module: "/apps/q/forge/gpu/holo-onnx-kserve.mjs", holoUrl: "…/qwen2.5-0.5b-onnx.holo", modelId: "onnx-community/Qwen2.5-0.5B-Instruct" }
};

function moduleBase() {
  try { return new URL("./", import.meta.url).href; }
  catch (e) { return new URL("./", location.href).href; }
}
async function hasWebGPU() {
  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch (e) { return false; }
}

export function createLLM(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  let pipe = null, TextStreamer = null, info = { ready: false, model: null, device: null }, loading = null;

  async function load(onProgress) {
    if (pipe) return info;
    if (loading) return loading;
    loading = (async () => {
      const base = moduleBase();
      const tf = await import(/* @vite-ignore */ new URL(cfg.lib, base).href);
      const { pipeline, env } = tf; TextStreamer = tf.TextStreamer;
      if (env) {
        env.allowRemoteModels = false; env.allowLocalModels = true;
        env.localModelPath = new URL(cfg.localPath, base).href;
        if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
          env.backends.onnx.wasm.wasmPaths = new URL(cfg.ortPath, base).href;
          // Under the native κ-host (holo:// custom scheme), ORT's threaded-wasm pthread/proxy WORKERS
          // fail to initialize ("no available backend / [wasm] [object Event]") — worker creation under
          // the custom standard scheme + COEP is unsupported. Force single-thread + no-proxy there so the
          // brain runs on the main thread (proven: real generation on the κ-host). On http(s) keep the
          // faster threaded/proxy path. (Removing this once holo:// worker init is fixed restores threads.)
          const holoHost = (typeof location !== "undefined" && location.protocol === "holo:");
          env.backends.onnx.wasm.proxy = holoHost ? false : !!cfg.proxy;   // ORT in a Web Worker → UI never freezes (http only)
          if (holoHost) env.backends.onnx.wasm.numThreads = 1;             // no pthread workers under holo://
        }
      }
      const prog = (p) => { try { onProgress && onProgress({ phase: p.status || "load", file: p.file, loaded: p.loaded, total: p.total }); } catch (e) {} };
      // κ-served brain: install the .holo fetch shim for the spec whose model matches knativeServe.modelId,
      // BEFORE that spec loads, so its ONNX files are served by content address. Restores + falls back on failure.
      let kserve = null;
      const installServe = async (modelId) => {
        if (kserve || !cfg.knativeServe || !cfg.knativeServe.module || !cfg.knativeServe.holoUrl || cfg.knativeServe.modelId !== modelId) return;
        try { const km = await import(/* @vite-ignore */ new URL(cfg.knativeServe.module, base).href);
          kserve = await (km.serveModelFromHolo || km.default)({ holoUrl: new URL(cfg.knativeServe.holoUrl, base).href, modelId, release: cfg.knativeServe.release || "" });
        } catch (e) { try { console.warn("[HoloVoice LLM] κ-served brain unavailable, using vendored ONNX:", e && e.message || e); } catch (_) {} kserve = null; }
      };
      const build = async (device, spec) => { await installServe(spec.model); try { return await pipeline("text-generation", spec.model, { device, dtype: spec.dtype, progress_callback: prog }); } catch (e) { if (kserve) { try { kserve.restore(); } catch (_) {} kserve = null; } throw e; } };
      const eng = () => kserve ? "transformers-κserved" : "transformers";
      const wantGPU = cfg.preferWebGPU && (await hasWebGPU());
      try {
        if (wantGPU) { pipe = await build("webgpu", cfg.webgpu); info = { ready: true, engine: eng(), model: cfg.webgpu.model, device: "webgpu", dtype: cfg.webgpu.dtype }; return info; }
      } catch (e) { /* WebGPU path failed → fall through to the WASM floor (any browser) */ }
      try {
        pipe = await build("wasm", cfg.wasm);
        info = { ready: true, engine: eng(), model: cfg.wasm.model, device: "wasm", dtype: cfg.wasm.dtype };
        return info;
      } catch (e) {                                                    // coder not vendored / failed → the lighter 0.5B floor
        if (!cfg.wasmFallback || cfg.wasmFallback.model === cfg.wasm.model) throw e;
        pipe = await build("wasm", cfg.wasmFallback);
        info = { ready: true, engine: eng(), model: cfg.wasmFallback.model, device: "wasm", dtype: cfg.wasmFallback.dtype };
        return info;
      }
    })().catch((e) => { loading = null; throw e; });
    return loading;
  }

  // generate(history, opts) → async iterator of token-text deltas (live streaming). history is a list of
  // {role, content}; the model's chat template is applied automatically.
  async function* generate(history, o = {}) {
    if (!pipe) await load(o.onProgress);
    const messages = (history || []).map((m) => ({ role: m.role, content: m.content }));
    const queue = []; let done = false, err = null, wake = null;
    const streamer = new TextStreamer(pipe.tokenizer, {
      skip_prompt: true, skip_special_tokens: true,
      callback_function: (t) => { if (t) queue.push(t); if (wake) { wake(); wake = null; } },
    });
    const run = pipe(messages, { max_new_tokens: o.maxTokens || cfg.maxTokens, do_sample: !!o.temperature, temperature: o.temperature || undefined, streamer })
      .catch((e) => { err = e; }).finally(() => { done = true; if (wake) { wake(); wake = null; } });
    while (true) {
      if (queue.length) { yield queue.shift(); continue; }
      if (done) break;
      if (o.signal && o.signal.aborted) break;
      await new Promise((r) => { wake = r; });
    }
    await run; if (err) throw err;
  }

  async function chat(history, o = {}) { let s = ""; for await (const d of generate(history, o)) s += d; return s.trim(); }

  return { id: "holo-voice-llm", load, generate, chat, info: () => info };
}

export default createLLM;
