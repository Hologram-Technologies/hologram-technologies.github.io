// holo-q-diffusion-engine.mjs — the GPU-backed RUNTIME for the Dream diffusion seam.
//
// holo-q-diffusion.js holds the deterministic CONTROL PLANE (schedule + confidence unmask + greedy) as a
// pure, Node-re-derivable reference. THIS module is its hardware half: it binds the real WebGPU
// masked-diffusion engine — Dream-7B (Qwen2.5-7B backbone, q3f κ-object) running on the Q studio app's
// custom WebGPU engine, the same one that runs qwen-coder-7b where onnxruntime-web's WebGPU EP aborts.
//
// Cross-repo, exactly like holo-voice-gpu-brain.mjs: the engine + loader + κ-object live under /apps/q/*.
// Their MODELS use relative "./models/…" (correct only when served at /apps/q/), but we run from the OS
// shell at "/", so we OVERRIDE kappaUrl to an ABSOLUTE <appBase>models/<id>. The loader's own internal
// imports (../pkg, ../qvac-gpu) resolve relative to loader.js's URL, so they are unaffected.
//
// ON-HW VALIDATED (2026-06-15): determinism ✓ byte-identical across passes (Law L5); infill ✓ both-sided
// + correct; generation coherent when steps≈length. Infill is the proven, differentiated capability —
// short spans, enough steps, fast (~4.5s), deterministic — so it is the FIRST mode wired here.

const APP = "/apps/q/";
const DEFAULTS = { model: "dream-7b", maskId: 151666 };

export function createDiffusionEngine(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  const appBase = (cfg.appBase || APP).replace(/\/*$/, "/");           // overridable base (default /apps/q/; "/" when apps/q is served at root)
  let engine = null, loadingP = null, maskId = cfg.maskId;
  let info = { ready: false, model: cfg.model, device: null, maskId };

  async function load(onProgress) {
    if (engine) return info;
    if (loadingP) return loadingP;
    loadingP = (async () => {
      if (!(typeof navigator !== "undefined" && navigator.gpu)) throw new Error("no WebGPU on this device (diffusion engine is GPU-only)");
      const ldr = await import(/* @vite-ignore */ appBase + "core/loader.js");
      const eng = await import(/* @vite-ignore */ appBase + "core/engine.js");
      await ldr.ready();                                               // wasm tokenizer/engine init (once)
      const norm = (u) => (u || "").replace(/^\.\//, "").replace(/^models\//, "").replace(/\/+$/, "");
      const base = (ldr.MODELS || []).find((x) => norm(x.kappaUrl) === cfg.model)
        || (ldr.MODELS || []).find((x) => x.diffusion);               // any diffusion κ-object as fallback
      if (!base) throw new Error("diffusion model entry not found: " + cfg.model);
      // absolute κ-disk URL so it resolves from the OS shell, not /apps/q/
      const entry = Object.assign({}, base, { kappaUrl: appBase + String(base.kappaUrl || ("models/" + cfg.model)).replace(/^\.\//, "") });
      const loaded = await ldr.loadModel(entry, { onProgress: onProgress || (() => {}), onStatus: () => {} });
      if (!loaded || !loaded.gpu) throw new Error("GPU diffusion model load failed (WebGPU build/upload)");
      if (loaded.manifest && loaded.manifest.maskId !== undefined) maskId = loaded.manifest.maskId;
      if (loaded.manifest && !loaded.manifest.diffusion) throw new Error("loaded κ-object is not a diffusion model (manifest.diffusion not set)");
      engine = await eng.createEngine(entry, loaded);
      info = { ready: true, model: cfg.model, device: "webgpu", maskId };
      return info;
    })().catch((e) => { loadingP = null; throw e; });
    return loadingP;
  }

  // infill(prefix, suffix, { holes, steps }) → fill a hole conditioning on BOTH sides — diffusion's native
  // surgical edit (the liveEdit/agent-edit "rewrite this in place" story). Greedy ⇒ deterministic ⇒ κ.
  // Returns { text: full edited string, fill: just the filled span, ids }. steps≈holes for greedy coherence.
  async function infill(prefix, suffix = "", o = {}) {
    if (!engine) await load(o.onProgress);
    const holes = Math.max(1, o.holes ?? 8);
    const pre = engine.tokenize(String(prefix ?? "")), suf = suffix ? engine.tokenize(String(suffix)) : [];
    const ids = pre.concat(new Array(holes).fill(maskId)).concat(suf);
    const steps = o.steps ?? Math.max(8, holes);                       // enough steps for the span (the on-HW finding)
    const r = await engine.diffuse(ids, { fill: true, steps, signal: o.signal });
    const seq = r.ids || ids;
    const mid = seq.slice(pre.length, seq.length - suf.length);        // the bytes that replaced the hole
    return { text: r.text, fill: engine.detokenize(mid), ids: Array.from(seq), stats: r.stats };
  }

  // generate(history, { maxTokens, steps }) → diffusion generation (append masks). Resolves the block
  // together (NOT a token stream — diffusion has no left-to-right order). Coherence needs steps≈length;
  // at short lengths AR wins on wall-clock, so this is the long-form / κ-deterministic mode, not the floor.
  async function generate(history, o = {}) {
    if (!engine) await load(o.onProgress);
    const last = [...(history || [])].reverse().find((mm) => mm && mm.role === "user");
    const prompt = (last && last.content) || (typeof history === "string" ? history : "");
    const ids = engine.tokenize(engine.frameTurn(prompt, false));      // correct ChatML frame (Dream rides Qwen2.5)
    const genLen = o.maxTokens || 48;
    const steps = o.steps ?? genLen;                                   // steps≈length for greedy quality
    const r = await engine.diffuse(ids, { genLen, steps, signal: o.signal });
    return { text: r.text, ids: Array.from(r.outIds || []), stats: r.stats };
  }

  return {
    id: "holo-q-diffusion-gpu", decodeFamily: "diffusion", model: cfg.model,
    load, infill, generate, info: () => info,
    destroy: () => { try { engine && engine.destroy(); } catch (e) {} engine = null; loadingP = null; info = { ready: false, model: cfg.model, device: null, maskId }; },
  };
}

export default createDiffusionEngine;
