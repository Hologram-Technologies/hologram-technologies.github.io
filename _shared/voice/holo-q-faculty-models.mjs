// holo-q-faculty-models.mjs — the ONE bridge from a Q faculty decision to a LOADABLE .holo spec.
//
// holo-q-mux.js is the authority on WHICH model runs a faculty (override → pinned κ → main) but it is a
// pure registry — it carries the κ (identity, Law L1) and the faculty, NOT where the bytes live. This
// module adds the single hosting map (model id → filename) and turns a mux decision into the {url, release,
// kappa, upgrade} every loader (holo-brain-engine, holo-moonshine-ear, kokoro) already takes. The κ is read
// FROM the mux PINNED table, so the two can never drift — change a κ in one place (the mux, sourced from
// .models/holo-ipfs-pins.json) and every consumer follows. Resolution is pure + re-derivable (no load).
//
// Used by: holo-voice-holo-brain.mjs (respond/code chat brain), holo-voice.js (listen/ASR config), and any
// app that wants "the model the user chose for this faculty". Overrides flow through resolveModel() — so the
// settings picker (bindSpecialist) controls every faculty from one place.

import { resolveModel, PINNED } from "../q/holo-q-mux.js";

// where the κ bytes live. The forge dir is the dev/canonical mount; the Release is the prod host (>100MB
// Pages limit); the κ-route (/.holo/sha256/<κ>, SW heals from IPFS) is the universal fallback the loaders
// already try. Override the release base via window.HOLO_MODELS_RELEASE_BASE (e.g. a pinned tag).
const FORGE = "/apps/q/forge/";
const RELEASE_BASE = (typeof window !== "undefined" && window.HOLO_MODELS_RELEASE_BASE) || "https://github.com/Hologram-Technologies/hologram-apps/releases/download/models-v1/";
// model id (as named in the mux PINNED table) → its .holo filename. The ONLY hosting fact not in the mux.
const FILE = {
  "qwen2.5-0.5b": "qwen2.5-0.5b-instruct.holo",
  "qwen2.5-1.5b": "qwen2.5-1.5b-instruct.holo",
  "qwen-coder-3b": "qwen2.5-coder-3b-instruct.holo",
  // think faculty — the 9B reasoner ships as its OWN sharded .holo (not in the q-models pack; no PACK_ID),
  // delivered via its parts manifest + κ-route. specFor builds {url: FORGE/.models/…, release, kappa}.
  "qwen3.5-9b-thinking": "qwen3.5-9b-thinking.holo",
  "moonshine-tiny-int8": "moonshine-tiny-int8.holo",
  "moonshine-tiny-f16": "moonshine-tiny-f16.holo",
  // listen 0.6B upgrade (WebGPU) — the κ-native FastConformer-TDT ear. Encoder + joint are separate .holo;
  // the parakeet ear (holo-parakeet-ear.mjs) takes the encoder as holoUrl and the joint via jointUrl.
  "parakeet-tdt-0.6b-v2": "parakeet-tdt-0.6b-v2-stream.holo",
  "parakeet-tdt-0.6b-v2-joint": "parakeet-tdt-0.6b-v2-joint.holo",
  "kokoro-82m": "kokoro-82m.holo",
  // semantic turn-detector (SmolLM2-135M) — its own loader (createTurnDetectorWeb) but a first-class registry model
  // so it shares the pack delivery; standalone lives in its own dir.
  "turn-detector": "turn-detector/turn-detector.holo",
};

// THE UNIFIED PACK — one κ-addressable .holo holding every faculty model's bodies (deduped, instant-tier-first).
// ONE delivery, one warm OPFS cache, one address: a pack-aware loader opens it ONCE (holo-model-pack.mjs) and
// Range-fetches only the model it needs (proven by q-pack-stream-witness: a faculty reads ≈ its own bytes, never
// the 953MB whole). Standalone .holo stay as the per-model fallback when the pack isn't reachable. PACK_ID maps a
// mux/FILE model id → its id INSIDE the pack manifest (the encoder/joint are named without the version suffix there).
const PACK_FILE = "q-models.holo";
// EVERY Q model lives in the pack (bundle-everything). The pack is one κ-addressable file; because it exceeds GitHub's
// 2 GiB per-asset cap it's DELIVERED in <2 GiB shards (q-models.holo.partNN, manifest q-models.holo.parts.json) that a
// spanning reader (holo-pack-shards.mjs) stitches back — one address, sharding invisible above the rangeReader.
const PACK_ID = {
  "moonshine-tiny-int8": "moonshine-tiny-int8", "moonshine-tiny-f16": "moonshine-tiny-f16", "kokoro-82m": "kokoro-82m",
  "parakeet-tdt-0.6b-v2": "parakeet-encoder", "parakeet-tdt-0.6b-v2-joint": "parakeet-joint",
  "turn-detector": "turn-detector", "qwen2.5-0.5b": "qwen2.5-0.5b", "qwen2.5-1.5b": "qwen2.5-1.5b", "qwen-coder-3b": "qwen-coder-3b",
};
// the pack's own coordinates. `url` = monolithic file (dev/FORGE mount, served same-origin when present); `release`
// = label only. `partsManifest` = the shard manifest, shipped SAME-ORIGIN (tiny → in dist, no CORS); it carries an
// IPFS gateway + per-shard CIDs so the bytes stream from a CDN-backed CORS+Range gateway (serverless, any-device).
// GitHub release assets are NOT used for browser delivery (they send no CORS header). Override the gateway via
// window.HOLO_PACK_GATEWAY; override the whole base via window.HOLO_MODELS_RELEASE_BASE.
export const packSpec = { file: PACK_FILE, url: FORGE + ".models/" + PACK_FILE, release: RELEASE_BASE + PACK_FILE, partsManifest: FORGE + ".models/" + PACK_FILE + ".parts.json", sharded: true };

// THE SEED FIRST-RESPONDER — a tiny (~7MB int8) context-aligned .holo that speaks an instant qwen-aligned opener
// ("Sure! …") the moment it loads, so a cold user hears audio in <2s while the 485MB brain streams in (speak-while-
// streaming, holo-voice-seed-handoff.mjs). ONE small same-origin asset (no sharding); release is the prod fallback.
// κ is the q-seed.holo archive root (file-bundle: seed.onnx int8 + seed.json cfg, L5-verified). Loaded fail-soft:
// any open/run error → the loop falls back to brain-only, never breaking listen/respond.
export const seedSpec = { file: "q-seed.holo", url: FORGE + ".models/q-seed.holo", release: RELEASE_BASE + "q-seed.holo", kappa: "did:holo:sha256:32edd21a7f80a0645cf5659be51a4002ef2271aa6637fba08314929f57bae4a0", bytesMB: 7 };

// a {id, kappa} from the mux → a loadable spec (url path → release → κ-route; every block L5-verified). When the
// model also lives in the unified pack, the spec carries {pack:{url,release,model}} so a pack-aware loader prefers
// the single delivery; loaders that ignore it fall back to the standalone url/release unchanged.
export function specFor(tier) {
  if (!tier || !tier.id) return null;
  const file = FILE[tier.id];
  if (!file) return { id: tier.id, kappa: tier.kappa || "", url: tier.id, release: "" };   // a direct URL/unknown id — pass through
  const spec = { id: tier.id, kappa: tier.kappa || "", url: FORGE + ".models/" + file, release: RELEASE_BASE + file, bytesMB: tier.bytesMB || 0 };
  if (PACK_ID[tier.id]) spec.pack = { url: packSpec.url, release: packSpec.release, model: PACK_ID[tier.id] };
  return spec;
}

// every pinned TIER the OS ships, indexed by model id (instant + upgrade across all faculties). This is the
// closed set a user override may name — so a steer ("use the 1.5B") resolves to real, κ-verified bytes, not
// an arbitrary string. specById(id) → a loadable spec, or null when the id isn't an OS-pinned model.
const ALL_TIERS = (() => {
  const m = {};
  for (const fac of Object.values(PINNED)) { if (fac.instant) m[fac.instant.id] = fac.instant; if (fac.upgrade) m[fac.upgrade.id] = fac.upgrade; }
  return m;
})();
export function specById(id) { return ALL_TIERS[id] ? specFor(ALL_TIERS[id]) : null; }
// the tiers a given faculty is ALLOWED to use (instant + its own upgrade) — the closed choice set a picker
// or a steer offers for that faculty. Returns [{id,kappa,bytesMB,tier:"instant"|"upgrade"}], or [] for helpers.
export function tiersFor(faculty) {
  const p = PINNED[faculty]; if (!p) return [];
  const out = [{ ...p.instant, tier: "instant" }];
  if (p.upgrade) out.push({ ...p.upgrade, tier: "upgrade" });
  return out;
}

// resolveFacultyModel(faculty) — THE call a consumer makes. Returns the loadable spec for the active model
// of a faculty, honoring the user/admin override, then the OS-pinned κ. Shape:
//   { faculty, source:"override"|"pinned"|"main", instant:{url,release,kappa,...}|null, upgrade:{...}|null, provider?, main? }
// - source "override": the settings picker bound a specific provider — returned verbatim (the caller uses it).
// - source "pinned":   the OS's own precompiled κ .holo — instant tier (+ optional silent upgrade tier).
// - source "main":     a helper faculty with no binding — defer to the main brain (the caller's main path).
export function resolveFacultyModel(faculty) {
  const r = resolveModel(faculty);
  if (r.source === "override") return { faculty, source: "override", provider: r.provider, id: r.id, instant: specById(r.id), upgrade: null };
  if (r.source === "pinned") {
    const p = r.spec;   // { faculty, instant:{id,kappa,bytesMB}, upgrade?:{...} }
    return { faculty, source: "pinned", instant: specFor(p.instant), upgrade: p.upgrade ? specFor(p.upgrade) : null };
  }
  return { faculty, source: r.source, main: true, id: r.id };   // "main" | "deterministic"
}

// convenience: the bare {url,release,kappa} for a pinned faculty's instant tier (the common case a loader wants).
export function instantSpec(faculty) { const r = resolveFacultyModel(faculty); return r.source === "pinned" ? r.instant : null; }
export function upgradeSpec(faculty) { const r = resolveFacultyModel(faculty); return r.source === "pinned" ? r.upgrade : null; }

export { PINNED, resolveModel };
export default { resolveFacultyModel, instantSpec, upgradeSpec, specFor, specById, tiersFor, packSpec, seedSpec };
