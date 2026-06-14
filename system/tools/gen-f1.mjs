#!/usr/bin/env node
// gen-f1.mjs — make afflom/F1 (the 𝔽₁-square toward RH, built on UOR-Framework v0.5.2) NATIVE to
// the Hologram UOR substrate, and combine it with ATLAS96 by ATTESTATION (never by re-writing its
// mathematics). This tool writes NO new mathematics. It encodes two self-verifying UOR objects:
//
//   1. f1.uor.json — the F1 formalization as a content-addressed object: its upstream identity, the
//      shared UOR-Framework Z/2^n Z root it stands on, and — faithfully transcribed from F1's own
//      README — its HONESTY LEDGER: each result tagged `universallyValid: true` (established + Lean-
//      verified, choice-free) or `null` (open / not asserted proven). The RH crux (Hodge index
//      negativity for Spec ℤ ×_𝔽₁ Spec ℤ) is `null` because F1 itself marks it `none`. The F1↔ATLAS96
//      bridge is recorded with the SAME discipline: shared substrate = real; E8↔modular-forms↔ζ =
//      a true pure-math kinship, NOT a computational lever; "improves Holo Q inference" = false.
//
//   2. atlas96-ledger.uor.json — an OVERLAY attestation over the EXISTING, already-sealed ATLAS96
//      objects (it points at their did:holo by identity; it does not mutate a single byte of them).
//      It applies F1's honesty convention to ATLAS96's claims: the deterministic byte→E₈ unfolding
//      and the E₈-quantizer match are `true` (witnessed / measured); the "96/12288 torus as an LLM
//      latent coordinate" thesis and "any LLM maps via snap()" are re-graded `null` (open, measured
//      WEAK) and the "8K via E8" claim `false` — each citing the in-repo falsification record.
//
// All content-addressing comes from the canonical substrate primitives (holo-object.mjs / holo-uor.mjs),
// imported, never re-derived here. Objects are sealed DUAL-AXIS: the did:holo:sha256 identity AND the
// blake3 substrate κ alias over identical canonical content — so they resolve natively on the substrate.
//
//   node system/tools/gen-f1.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE      = dirname(fileURLToPath(import.meta.url));
const HOLO_LIB  = join(HERE, "..", "os", "usr", "lib", "holo");
const APPS_REPO = "C:/Users/pavel/Desktop/Hologram Apps";
const F1_DIR    = join(APPS_REPO, "apps", "f1");
const Q_E8_DIR  = join(APPS_REPO, "apps", "q", "atlas-e8");

// the content-addressing substrate — imported, never re-derived (Law L2).
const { address, blakeDid, sealDual, contentLink } = await import(pathToFileURL(join(HOLO_LIB, "holo-object.mjs")));
const { sha256hex } = await import(pathToFileURL(join(HOLO_LIB, "holo-uor.mjs")));

// the sealed ATLAS96 objects this work attaches to. The ATLAS96 objects were sealed by an older
// (Q-specific, @id-keyed) canonicalization, so we bind the overlay to their EXACT FILE BYTES via the
// substrate leaf-link primitive (sha256 of the raw bytes) — verifiable by re-hashing — and keep each
// object's self-declared @id as a semantic label. Law-L5 continuity without reversing legacy sealing.
const fileLink = (name) => ({ ...contentLink("schema:hasPart", sha256hex(readFileSync(join(Q_E8_DIR, name))), "schema:Dataset"),
  "schema:name": name });

const CONTEXT = [
  "https://www.w3.org/ns/did/v1",
  {
    schema: "https://schema.org/",
    prov: "http://www.w3.org/ns/prov#",
    holo: "https://hologram.os/ns/q#",
    f1: "https://hologram.os/ns/f1#",
  },
];

// ── the sealed ATLAS96 objects this work attaches to (their current self-verifying identities) ──
const ATLAS96_OBJ = "did:holo:sha256:f82435dab0215aa6695797d5e9ef4809f1905c015c419f085b2d42346441aad0"; // the 11-step unfolding
const E8_LATTICE  = "did:holo:sha256:652dcc6490dabf4fdb4a713a2773079a858b2aa1490582e777e38a5c3499a6cd"; // the E8 ball it terminates at
const E8_INSIGHTS = "did:holo:sha256:1184b3be28849cc27e933479e14e06c58a257fcff1566c2ce133b8dcc609d13c"; // the 5 measured experiments

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE F1 OBJECT — afflom/F1 made native, with its honesty ledger transcribed verbatim from its README.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// `universallyValid` mirrors F1's own convention: true = established & Lean-verified; null = open / not
// asserted proven. Every `true` carries the evidence F1 states. The crux stays null. (No new maths.)
const f1Content = {
  "@context": CONTEXT,
  "@type": ["f1:Formalization", "prov:Entity"],
  "schema:name": "F1 — the 𝔽₁ square toward the Riemann Hypothesis, made native to the UOR substrate",
  "f1:upstream": {
    "@id": "https://github.com/afflom/F1",
    "schema:name": "afflom/F1 — the 𝔽₁ square with an intersection theory",
    "schema:version": "v0.15.3",
    "schema:license": "MIT",
    "schema:author": "Alex Flom",
    "f1:language": "Lean 4 (toolchain v4.16.0)",
  },
  // the shared root: F1 is PINNED to the same UOR-Framework that ATLAS96's byte base stands on.
  "f1:dependsOn": {
    "@id": "https://github.com/UOR-Foundation/UOR-Framework",
    "schema:name": "UOR-Framework — content-addressed object spaces over Z/(2^n)Z",
    "schema:version": "v0.5.2",
    "f1:sharedRootWith": ATLAS96_OBJ,
    "f1:note": "Both F1 and ATLAS96 are UOR-Framework objects on the same Z/(2^n)Z algebraic root. This is a structural kinship, not a proof link.",
  },
  "f1:thesis":
    "Over a function field, RH follows from the Hodge index theorem's intersection-positivity on the surface C×C (Frobenius eigenvalue bound). The 𝔽₁ program seeks the analogue over ℚ: make Spec ℤ a curve over a 'field with one element', so Spec ℤ ×_𝔽₁ Spec ℤ is an arithmetic surface whose Hodge-index negativity would BE the Riemann Hypothesis. F1 names, shapes, and partially builds that square — it does not construct it.",
  "f1:honesty": {
    "convention": "universallyValid: true = established and Lean-verified; null = not asserted proven (open or conditional).",
    "choiceFree": "Proof layer permits only `propext` and `Quot.sound`; forbids Classical.choice, `sorry`, and `native_decide`.",
    "enforcedBy": "scripts/honesty_audit.sh — CI fails if any unaudited theorem exists.",
  },
  // the ledger — faithful to F1's README "What Is Actually Proven" + "engineering details".
  "f1:ledger": [
    { name: "function-field-hodge", universallyValid: true,
      statement: "The function-field Hodge mechanism — the proven template over 𝔽_q where intersection-positivity gives the eigenvalue bound.", evidence: "F1Square/ (no sorry)" },
    { name: "characteristic-1-machinery", universallyValid: true,
      statement: "Characteristic-1 base: the tropical κ/spectrum stack construction.", evidence: "F1Square/ (no sorry)" },
    { name: "intersection-pairing-template", universallyValid: true,
      statement: "The intersection-pairing template with ample class structure and parallel-pencil geometry.", evidence: "F1Square/ (no sorry)" },
    { name: "bowen-lanford-counts", universallyValid: true,
      statement: "Bowen–Lanford cycle counts (the prime-orbit side).", evidence: "F1Square/ (no sorry)" },
    { name: "constructive-analysis", universallyValid: true,
      statement: "A complete constructive analysis substrate: ℝ as Bishop regular sequences (Cauchy complete), ℂ = ℝ×ℝ, and exp/log/sin/cos built from first principles as axiom-clean diagonal limits (Machin π, accelerated Euler–Mascheroni γ).", evidence: "Analysis/ (no sorry, choice-free)" },
    { name: "zeta-re-gt-1", universallyValid: true,
      statement: "The complex ζ(s) for Re(s) > 1 as exact-bounded objects, with the von Mangoldt function and the prime-side explicit formula.", evidence: "F1Square/ (no sorry)" },
    { name: "li-lambda1-positive", universallyValid: true,
      statement: "The first Li coefficient λ₁ ≈ 0.0231 certified positive — the n=1 slice of Li's criterion.", evidence: "F1Square/ (no sorry)" },
    { name: "full-li-positivity", universallyValid: null,
      statement: "Full Li positivity: λ_n > 0 for all n. This is EQUIVALENT to the Riemann Hypothesis.", status: "open" },
    { name: "hodge-index-negativity", universallyValid: null,
      statement: "The Hodge index (negative-definiteness) theorem for the square. THIS negativity is the Riemann Hypothesis. F1 encodes it as `none`.", status: "open — the crux" },
    { name: "spec-z-square", universallyValid: null,
      statement: "The 2-dimensional self-product Spec ℤ ×_𝔽₁ Spec ℤ itself — named, shaped, and partially built, NOT constructed.", status: "open" },
  ],
  // what F1 unlocks, graded honestly — primes/RH domain, but near-zero engineering leverage even if proven.
  "f1:unlocks": {
    ifProven: "Sharpest possible bounds on prime distribution (smallest π(x) error term); firms up GRH-conditioned parameter choices. Breaks no cryptography; yields no new algorithm. RH is a statement THAT primes are maximally regular, not a method that exploits them.",
    forHologram: "No new compute primitive. κ = sha256/blake3 does not depend on RH; R96 is mod-2^n structure, not prime structure. F1's real gift to Hologram is METHODOLOGICAL: a choice-free, self-auditing, explicit-truth-status formalization — the template this very object applies to ATLAS96.",
  },
  // the F1↔ATLAS96 bridge — each link graded with F1's own discipline.
  "f1:bridge": {
    appliesTo: ATLAS96_OBJ,
    terminatesAt: E8_LATTICE,
    links: [
      { name: "shared-substrate", universallyValid: true,
        statement: "F1 and ATLAS96 are both UOR-Framework objects over Z/(2^n)Z; ATLAS96's base is the octet + κ. Real structural kinship — they belong in one object graph." },
      { name: "modular-forms-kinship", universallyValid: null,
        statement: "The E₈ theta function is a weight-4 modular form, and modular forms ↔ L-functions ↔ ζ/RH. A TRUE pure-math kinship between ATLAS96's E₈ terminus and F1's ζ — but a kinship, not a mechanism. You cannot derive one from the other in code.",
        status: "kinship, not a lever" },
      { name: "improves-inference", universallyValid: false,
        statement: "'F1/RH improves Holo Q inference' has no mechanism. RH is orthogonal to inference quality. Asserting it would be numerology." },
    ],
  },
  "f1:laws": ["L1 content-address", "L5 re-derivation"],
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2. THE ATLAS96 CLAIM LEDGER — an overlay attestation; re-grades ATLAS96's claims with F1's honesty.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const ledgerContent = {
  "@context": CONTEXT,
  "@type": ["f1:ClaimLedger", "prov:Entity"],
  "schema:name": "ATLAS96 claim ledger — honesty re-grading (F1 convention applied), an overlay that mutates nothing",
  "prov:wasInfluencedBy": "did:holo:sha256:0", // replaced post-seal with the F1 object id
  // semantic labels (the objects' self-declared identities) …
  "f1:subject": { object: ATLAS96_OBJ, lattice: E8_LATTICE, insights: E8_INSIGHTS },
  // … and the verifiable binding: leaf links to the EXACT file bytes (re-hash to confirm, Law L5).
  "links": [fileLink("atlas96.uor.json"), fileLink("lattice.uor.json"), fileLink("insights.uor.json")],
  "f1:method": "Applies F1's universallyValid convention (true = established/witnessed; null = open; false = falsified) to ATLAS96's claims. Points at the sealed objects by identity — it does NOT alter them. The witness re-derives the subject from the live atlas96.uor.json to prove this overlay points at the genuine object.",
  "f1:claims": [
    { name: "deterministic-unfolding-rederives", universallyValid: true,
      statement: "The 11-step unfolding from the UOR octet base to the E₈ lattice re-derives byte-for-byte; each step carries an `ok` witness and the lattice shell counts (1,240,2160,6720,17520) ARE the E₈ shells.",
      evidence: "atlas96.uor.json per-step witnesses (all ok) + lattice.uor.json holo:shellCounts" },
    { name: "is-the-e8-quantizer", universallyValid: true,
      statement: "The object IS the E₈ quantizer: measured normalized second moment G = 0.0717 vs the known E₈ value 0.07168 (scalar baseline 1/12 = 0.0833).",
      evidence: "insights.uor.json E4 (G_measured vs G_known)" },
    { name: "entropy-storage-headroom", universallyValid: true,
      statement: "Real but modest: H(codeword) = 14.38 of 16 bits → ~10.1% storage headroom at entropy on measured model data.",
      evidence: "insights.uor.json E2" },
    { name: "llm-latent-topology-coordinate", universallyValid: null,
      statement: "The thesis that the 96-vertex / 12,288 torus is a coordinate for LLM latent topology — and that 'any LLM maps into this space via snap()' — is OPEN and measured WEAK: E8-snap miss rate 0.941; best rate-constrained NMSE 0.121. As a STRONG/universal claim it is FALSIFIED: real LLM embeddings are high-dim random-like (toroidality ≈ 0.3) vs the atlas torus 0.735; R96 over embeddings is histogram-only.",
      status: "open — measured weak; strong form falsified",
      falsifiedBy: ["memory:atlas-12288-llm-thesis-test", "memory:e8-lattice-atlas-object (insights E1/E3)"] },
    { name: "e8-upscaling-to-8k", universallyValid: false,
      statement: "'8K via E₈' (E₈ as a detail-synthesizer for super-resolution) is FALSIFIED: E₈ never beats Lanczos and loses to a learned k-means partition of the same 8-D space by 0.65–0.85 dB across ×2/×3/×4. E₈ is an optimal QUANTIZER, not a detail synthesizer.",
      status: "falsified",
      falsifiedBy: ["memory:e8-lattice-sr-falsified"] },
  ],
  "f1:note": "The atlas96 holospace.json still advertises the LLM-latent thesis as a 'Working thesis' and atlas96.uor.json carries holo:llmMapping. Per this ledger those are `null`/`false`, not proven. Prose softening of that descriptor is recommended but deferred (it would relock the atlas96 app).",
  "f1:laws": ["L1 content-address", "L5 re-derivation"],
};

// ── seal (dual-axis) + write ────────────────────────────────────────────────────────────────────
const f1Sealed = sealDual(f1Content);
// wire the ledger's provenance to the now-known F1 object identity, then seal it.
ledgerContent["prov:wasInfluencedBy"] = f1Sealed.id;
const ledgerSealed = sealDual(ledgerContent);

const writeJson = (dir, name, obj) => {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(obj, null, 1) + "\n");
  return p;
};

for (const dir of [F1_DIR, Q_E8_DIR]) {
  writeJson(dir, "f1.uor.json", f1Sealed);
  writeJson(dir, "atlas96-ledger.uor.json", ledgerSealed);
}

console.log("F1 object        :", f1Sealed.id);
console.log("  substrate κ     :", (f1Sealed.alsoKnownAs || []).find((x) => x.includes("blake3")) || "(none)");
console.log("ATLAS96 ledger   :", ledgerSealed.id);
console.log("  influenced by   :", ledgerSealed["prov:wasInfluencedBy"]);
console.log("written to       :", F1_DIR);
console.log("           and to :", Q_E8_DIR);
