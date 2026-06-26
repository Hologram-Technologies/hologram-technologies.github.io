// holo-voice-holo-brain.mjs — Q's DEFAULT WebGPU brain: a PRECOMPILED .holo model run on the QVAC forge
// runtime (apps/q/forge/gpu/holo-brain-engine.mjs), loaded by κ with per-block WebCrypto L5 verification,
// 100% serverless in-browser. Same provider shape as holo-voice-gpu-brain.mjs (load · generate → text-delta
// async-iterator · chat · info), so holo-voice.js binds it as the WebGPU brain tier.
//
// Cross-repo: the engine + forge live in /apps/q/forge/* (served on the canonical mount; the OS's holo-uor
// resolves via the server's /holo-os/system/os/ alias). The .holo weights are content-addressed and pinnable
// (Law L5). 0.5B = the instant core (warmed at the welcome); 1.5B = the silent background upgrade.

// The brain weights (491MB / 1.1GB) exceed GitHub Pages' 100MB/file limit, so they ship as GitHub RELEASE
// assets (2GB/file). Resolution per model: repo path (dev / if committed) → release asset (prod) → κ-route
// (/.holo/sha256/<κ>, SW heals from IPFS). Location is a latency choice; every block is L5-verified, so no
// host is trusted (Law L1/L5). Override RELEASE_BASE via window.HOLO_MODELS_RELEASE_BASE (e.g. a pinned tag).
//
// CANONICAL WIRING (ADR-0084): the model CATALOG is now derived from holo-q-mux's PINNED faculty table via
// the holo-q-faculty-models bridge — the κ (identity) lives in ONE place (the mux, sourced from
// .models/holo-ipfs-pins.json) so this consumer can never drift from the registry. The {url,release,kappa}
// shape the engine takes is unchanged. respond = the main chat brain (0.5B instant → 1.5B silent upgrade);
// code = the agentic-coding tier (Coder-3B).
import { specFor } from "./holo-q-faculty-models.mjs";
import { PINNED, resolveModel } from "../q/holo-q-mux.js";
// the canonical served mount for the forge engine + .holo weights (same value faculty-models uses to build
// the specs). Used to import the GPU engine below. Declared here because ESM scopes are isolated — without
// it both ensure() and prefetchHoloBrain() throw a ReferenceError, silently dropping the .holo brain to the
// ONNX floor and no-op'ing every prefetch. Override the release host (not this path) via HOLO_MODELS_RELEASE_BASE.
const FORGE = "/apps/q/forge/";
const MODELS = {
  "qwen2.5-0.5b": specFor(PINNED.respond.instant),   // instant core — κ from the mux (Law L1, one source)
  "qwen2.5-1.5b": specFor(PINNED.respond.upgrade),   // silent upgrade tier
  "qwen-coder-3b": specFor(PINNED.code.instant),     // AGENTIC-CODING tier (strong-WebGPU only); request via createHoloModelBrain({model:"qwen-coder-3b"})
};
const DEFAULTS = { model: "qwen2.5-0.5b", maxTokens: 512, pack: true };   // pack: stream weights from the ONE q-models pack (fail-soft → per-model .holo)

// faculty → the model key this brain should load RIGHT NOW, honoring a settings-picker override on that
// faculty (resolveModel: override → pinned). Returns a known MODELS key, or null when the override is a
// provider this .holo engine can't run (the caller keeps its own path). Pure — no load.
export function modelKeyForFaculty(faculty) {
  const r = resolveModel(faculty);
  if (r.source === "pinned") return r.spec.instant.id;           // the pinned instant tier (e.g. respond → qwen2.5-0.5b)
  if (r.source === "override") return MODELS[r.id] ? r.id : null; // an override naming a known .holo model, else not ours
  return null;
}

export function createHoloModelBrain(opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  let brain = null, loadingP = null, info = { ready: false, model: cfg.model, device: null };

  async function ensure() {
    if (brain) return brain;
    if (loadingP) return loadingP;
    loadingP = (async () => {
      if (!(typeof navigator !== "undefined" && navigator.gpu)) throw new Error("no WebGPU on this device");
      const mod = await import(/* @vite-ignore */ FORGE + "gpu/holo-brain-engine.mjs");
      const spec = MODELS[cfg.model] || { url: cfg.model, kappa: cfg.kappa || "" };   // a known key, or a direct .holo URL
      // optional LoRA adapter BY κ: fetch the adapter .holo via the κ-route, L5-open it (footer-verified bodies),
      // and hand the engine the decoded {target,scale,r,layers} — it rides the witnessed attn_q delta in run().
      let adapter = null;
      if (cfg.adapterBytes) {
        // YOUR private per-user adapter (decrypted from the local encrypted store, holo-user-adapter) — opened
        // directly, NEVER fetched/egressed. This is "the model becomes you": Q runs with the adapter trained on
        // your own usage. L5-opened (footer-verified bodies); same witnessed attn_q delta in run().
        const lora = await import(/* @vite-ignore */ FORGE + "gpu/holo-lora.mjs");
        adapter = lora.openAdapterHolo(cfg.adapterBytes instanceof Uint8Array ? cfg.adapterBytes : new Uint8Array(cfg.adapterBytes));
      } else if (cfg.adapter) {
        const lora = await import(/* @vite-ignore */ FORGE + "gpu/holo-lora.mjs");
        const ab = await fetch("/.holo/sha256/" + cfg.adapter).then((r) => { if (!r.ok) throw new Error("adapter κ " + cfg.adapter + " → " + r.status); return r.arrayBuffer(); });
        adapter = lora.openAdapterHolo(new Uint8Array(ab));
      }
      // UNIFIED PACK (opt-in via cfg.pack): stream this model's weights from the ONE q-models pack when it lives there;
      // fail-soft (makePackGgufStream → null → the engine uses spec.url/release). The brain runs byte-identically.
      let openGgufStream = null;
      if (cfg.pack) { try { const pp = await import(/* @vite-ignore */ FORGE + "gpu/holo-q-pack-provider.mjs"); const fm = await import(/* @vite-ignore */ new URL("./holo-q-faculty-models.mjs", import.meta.url).href); const e = pp.packEntryForUrl(spec.url); if (e && e.kind === "gguf") openGgufStream = pp.makePackGgufStream(e.model, { packSpec: fm.packSpec }); } catch (_) {} }
      brain = (mod.createHoloBrain || mod.default)({ holoUrl: spec.url, releaseUrl: spec.release, kappa: spec.kappa, maxTokens: cfg.maxTokens, adapter, openGgufStream });
      return brain;
    })().catch((e) => { loadingP = null; throw e; });
    return loadingP;
  }

  async function load(onProgress) { const b = await ensure(); info = await b.load(onProgress); return info; }
  async function* generate(history, o = {}) { const b = await ensure(); if (!info.ready) await load(o.onProgress); yield* b.generate(history, o); }
  async function chat(history, o = {}) { const b = await ensure(); if (!info.ready) await load(o.onProgress); return b.chat(history, o); }

  return { id: "holo-q-brain-" + cfg.model, load, generate, chat, info: () => info };
}

// Prefetch a model's .holo into the OPFS κ-cache WITHOUT building the GPU engine — warms the bytes so the
// real load is instant + 0-network. Overlaps login/boot latency so the brain feels "always there". Resolves
// the same {url, κ} the engine uses (path → κ-route IPFS heal), L5-verified on real load. Fire-and-forget.
export async function prefetchHoloBrain(model, onProgress) {
  const spec = MODELS[model || DEFAULTS.model]; if (!spec) return null;
  const mod = await import(/* @vite-ignore */ FORGE + "gpu/holo-brain-engine.mjs");
  if (!mod.loadHoloBytes) return null;
  const r = await mod.loadHoloBytes(spec.url, spec.kappa, onProgress, spec.release);
  return r && r.src;   // "opfs" (already warm) | "net" | "release" | "kappa"
}

export default createHoloModelBrain;
