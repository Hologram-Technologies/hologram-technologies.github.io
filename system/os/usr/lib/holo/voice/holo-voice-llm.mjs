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
  // Two tiers, picked by device. WebGPU gets the stronger 1.5B (q4f16, fast on a real GPU); WASM gets the
  // light 0.5B (int8) so any browser stays responsive. int8-on-WebGPU is broken, so the tiers differ by
  // BOTH model and dtype, not dtype alone.
  webgpu: { model: "onnx-community/Qwen2.5-1.5B-Instruct", dtype: "q4f16" },   // quality tier
  wasm: { model: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q8" },        // any-browser floor
  maxTokens: 256,
  preferWebGPU: false,    // WASM floor is the default; opt into WebGPU after verifying it on real HW.
  proxy: true,            // run onnxruntime-web in a Web Worker so load/generation never freezes the UI.
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
          env.backends.onnx.wasm.proxy = !!cfg.proxy;                 // ORT in a Web Worker → UI never freezes
        }
      }
      const prog = (p) => { try { onProgress && onProgress({ phase: p.status || "load", file: p.file, loaded: p.loaded, total: p.total }); } catch (e) {} };
      const build = (device, spec) => pipeline("text-generation", spec.model, { device, dtype: spec.dtype, progress_callback: prog });
      const wantGPU = cfg.preferWebGPU && (await hasWebGPU());
      try {
        if (wantGPU) { pipe = await build("webgpu", cfg.webgpu); info = { ready: true, model: cfg.webgpu.model, device: "webgpu", dtype: cfg.webgpu.dtype }; return info; }
      } catch (e) { /* WebGPU path failed → fall through to the WASM floor (any browser) */ }
      pipe = await build("wasm", cfg.wasm);
      info = { ready: true, model: cfg.wasm.model, device: "wasm", dtype: cfg.wasm.dtype };
      return info;
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
