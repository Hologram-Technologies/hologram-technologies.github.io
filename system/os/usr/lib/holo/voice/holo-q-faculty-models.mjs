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
  "moonshine-tiny-int8": "moonshine-tiny-int8.holo",
  "moonshine-tiny-f16": "moonshine-tiny-f16.holo",
  "kokoro-82m": "kokoro-82m.holo",
};

// a {id, kappa} from the mux → a loadable spec (url path → release → κ-route; every block L5-verified).
export function specFor(tier) {
  if (!tier || !tier.id) return null;
  const file = FILE[tier.id];
  if (!file) return { id: tier.id, kappa: tier.kappa || "", url: tier.id, release: "" };   // a direct URL/unknown id — pass through
  return { id: tier.id, kappa: tier.kappa || "", url: FORGE + ".models/" + file, release: RELEASE_BASE + file, bytesMB: tier.bytesMB || 0 };
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
export default { resolveFacultyModel, instantSpec, upgradeSpec, specFor, specById, tiersFor };
