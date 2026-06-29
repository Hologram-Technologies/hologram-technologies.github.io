// holo-q-adapters.mjs — faculty/skill → LoRA-adapter-κ ROUTING (the personal-model-zoo on Q's main brain).
//
// A specialist is a TINY adapter (.holo, ~1.3 MB at rank 8 — 372× smaller than the 491 MB base, measured by
// tools/zoo-compression-witness.mjs) applied over the ONE warm base brain at runtime. The apply mechanism is
// witnessed (holo-brain-engine rides the attn_q delta, byte-exact greedy parity), and the loader is now WIRED to
// this selector: createHoloModelBrain({ skill }) auto-resolves the adapter κ here, and brain.setSkill(skill) /
// brain.setAdapter(ad) HOT-SWAP the specialist on the warm base with no reload + no re-stream. This module is the
// pure routing layer those paths read; filling ADAPTER_CATALOG (below) with one entry activates a skill — no code.
//
// resolveAdapter is PURE + frame-gated: it returns an adapter κ only when the catalog has one for the skill
// AND it matches the base the brain is loading (model key + frame fingerprint). ANY mismatch/absence → null
// ⇒ no adapter ⇒ EXACT current behavior (never apply an incompatible adapter; never blank). Deterministic.
//
// Catalog entries are filled from the model catalog (holo-ipfs-pins.json) once a skill's adapter is pinned.
// attn_q-only adapters = limited specialization; richer specialists need multi-target LoRA (A3, follow-on).

export const ADAPTER_CATALOG = {
  // skill → { adapter: did:holo:sha256:<κ>, base: <base-model-key>, frame: <base frame fingerprint>, target }
  // Example (fill κ/frame from the pinned catalog to activate; commented = inert ⇒ current behavior):
  // "code":    { adapter: "did:holo:sha256:<attn_q-adapter-κ>", base: "qwen2.5-0.5b", frame: "<fp>", target: "attn_q" },
  // "respond": { adapter: "did:holo:sha256:<persona-adapter-κ>", base: "qwen2.5-0.5b", frame: "<fp>", target: "attn_q" },
};

// PURE. skill + { baseModel, baseFrame } (what the brain is about to load) → adapter κ | null.
export function resolveAdapter(skill, base = {}, catalog = ADAPTER_CATALOG) {
  if (!skill || !catalog) return null;
  const e = catalog[skill];
  if (!e || !e.adapter) return null;                                  // no specialist for this skill
  if (e.base && base.baseModel && e.base !== base.baseModel) return null;   // wrong base model
  if (e.frame && base.baseFrame && e.frame !== base.baseFrame) return null; // frame/arch mismatch (dims won't align)
  return e.adapter;
}

export default { ADAPTER_CATALOG, resolveAdapter };

// ── Node self-test (pure; no GPU/shell) ──
if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("holo-q-adapters.mjs")) {
  const cat = { code: { adapter: "did:holo:sha256:aaa", base: "qwen2.5-0.5b", frame: "fp1", target: "attn_q" } };
  const eq = (got, want, name) => console.log(`  ${got === want ? "✓" : "✗"} ${name}  (got ${JSON.stringify(got)})`);
  let ok = true; const A = (g, w, n) => { if (g !== w) ok = false; eq(g, w, n); };
  console.log("resolveAdapter unit test:");
  A(resolveAdapter("code", { baseModel: "qwen2.5-0.5b", baseFrame: "fp1" }, cat), "did:holo:sha256:aaa", "hit (skill+base+frame match)");
  A(resolveAdapter("code", { baseModel: "qwen2.5-0.5b", baseFrame: "fpX" }, cat), null, "frame mismatch → null");
  A(resolveAdapter("code", { baseModel: "other", baseFrame: "fp1" }, cat), null, "base mismatch → null");
  A(resolveAdapter("nope", { baseModel: "qwen2.5-0.5b", baseFrame: "fp1" }, cat), null, "unknown skill → null");
  A(resolveAdapter("code", { baseModel: "qwen2.5-0.5b", baseFrame: "fp1" }, null), null, "missing catalog → null");
  A(resolveAdapter("code", {}, cat), "did:holo:sha256:aaa", "no base info → resolves (caller may not know frame yet)");
  A(resolveAdapter(undefined, {}, cat), null, "no skill → null");
  A(resolveAdapter("code", { baseModel: "qwen2.5-0.5b", baseFrame: "fp1" }, {}), null, "empty catalog → null (current behavior)");
  console.log(ok ? "\nALL PASS" : "\nFAIL");
  if (!ok) process.exit(1);
}
