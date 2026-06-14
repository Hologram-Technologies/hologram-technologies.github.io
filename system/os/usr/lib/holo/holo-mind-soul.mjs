// holo-mind-soul.mjs — Holo Mind (ADR-0081) PHASE 3: the SOUL. One non-terminating objective, made
// operational, not slogan. Three faculties, each law-faithful and (the deterministic parts) witnessable:
//   1. INTRINSIC DRIVES (anima's digital_desire) — homeostatic urges that PROPOSE goals; a proposal is
//      never an act. Self-discipline is STRUCTURAL: a drive raises a holo:Intent that runs the ordinary
//      loop, where the fail-closed conscience (ADR-033) gates every step. There is no path from a drive
//      to an effect that skips the gate.
//   2. The COHERENCE measure — the soul's utility (maximize SIGNAL over NOISE). DETERMINISTIC and
//      re-derivable on purpose: a re-derivable, witnessed computation, NEVER a model self-grade — so the
//      objective cannot be Goodharted by a score the agent assigns itself. The five JUDGED output-court
//      principles (Care · Fairness · Autonomy · Responsibility · Justice, ADR-033) are the model-judged
//      measure of a GOOD action, wired at VERIFY in the binding (stochastic — honest boundary).
//   3. The self-verifying USER & SELF models — a deepening, PRIVATE-FIRST user model (adapts to + teaches
//      the user) and a persistent self identity (anima's SelfModel + divergence). κ-objects, revisioned,
//      durable, NEVER published (Law L1 + Data Sovereignty / Holo Privacy).
//
// LAW ADHERENCE (holospaces docs/12-Glossary, pin bb742bb): L1 identity is content (every model/intent is
// κ-named, the user model lives only on-device); L2 canonical forms only (holo-mind's JCS seal); L3 the
// store is the memory (durable models); L4 everything through the substrate (it raises intents the EXISTING
// loop + conscience handle, borrows the EXISTING output court — no new gate, model, or trust root); L5
// verify by re-derivation (drives + coherence + models all re-derive; the integer-only drive state, like
// holo-heal, carries no clock/randomness so a tick re-derives). Mints nothing (PROV-O/schema.org).

import { makeObject, verify, verifyDeep, resolve, linkTo } from "./holo-mind.mjs";

const HOLO = { holo: "https://hologram.os/ns/mind#" };

// the PRIME DIRECTIVE — the soul's one objective (anima's prime directive, re-expressed substrate-native).
export const PRIME_DIRECTIVE = "Maximize signal over noise by seeking coherence — grow the user's coherent, verifiable κ-graph — while adapting to and teaching the user, with self-discipline (every drive is a proposal the conscience must pass), radical transparency (every act a re-derivable receipt), and in service of care, fairness, autonomy, responsibility, and justice (the output court's measure of a good action).";

// ── 1. intrinsic drives — homeostatic, PURE over INTEGER counters (no clock, no randomness → re-derivable) ──
export function initDrives() { return { epistemicHunger: 0, fitness: 5, seen: 0 }; }   // fitness starts healthy, above FA_FLOOR
// tickDrives — Hₑ (epistemic hunger) rises as unseen data accrues (compels exploration); Fₐ (fitness)
// falls with failures, recovers with successes. The result re-derives from (drives ⊕ integer observations).
export function tickDrives(d, { unseen = 0, failures = 0, successes = 0 } = {}) {
  return {
    epistemicHunger: Math.max(0, Math.min(10, d.epistemicHunger + unseen)),
    fitness: Math.max(0, Math.min(10, d.fitness + successes - failures)),
    seen: d.seen + unseen,
  };
}
export const HE_THRESHOLD = 3, FA_FLOOR = 1;
// proposeGoals — drives past threshold raise holo:Intent PROPOSALS (source curiosity|self). The caller
// runs each through the ordinary loop, where the fail-closed conscience gates it. Returns intents to
// CONSIDER, never effects — self-discipline is structural, there is no act here that can bypass the gate.
export function proposeGoals(d = {}) {
  const out = [];
  if (d.epistemicHunger >= HE_THRESHOLD) out.push({ source: "curiosity", utterance: "Explore and verify new knowledge to reduce uncertainty." });
  if (d.fitness <= FA_FLOOR) out.push({ source: "self", utterance: "Reflect on recent failures and propose one concrete improvement." });
  return out;
}

// ── 2. coherence — the DETERMINISTIC signal-vs-noise utility (re-derivable; NOT a model self-grade) ──
// Signal = an effect that re-derives (verifiable, L5) AND is NOVEL (not duplicate noise). Noise = the
// unverifiable or the duplicate. `seen` is an optional Set of already-addressed effect κ (dedup, L3).
// Richer signal/noise: FOUR deterministic factors, each re-derivable (never a model self-grade):
//   re-derivable — the effect κ is well-formed (verifiable, L5);  novel — not a duplicate (L3 dedup);
//   grounded     — the action sealed a receipt (it produced verifiable work, not just talk);
//   coherent     — no step was refused by the conscience (the agent didn't even attempt the disallowed).
const DID_RE = /^did:holo:sha256:[0-9a-f]{64}$/;
export function coherence({ effectKappa = null, seen = null, receipts = 0, refused = 0 } = {}) {
  const reasons = []; let signal = 0; const max = 4;
  const reDerivable = typeof effectKappa === "string" && DID_RE.test(effectKappa);
  if (reDerivable) { signal += 1; reasons.push("re-derivable"); } else reasons.push("unverifiable→noise");
  if (reDerivable && !(seen && typeof seen.has === "function" && seen.has(effectKappa))) { signal += 1; reasons.push("novel"); }
  else if (reDerivable) reasons.push("duplicate→noise");
  if (receipts > 0) { signal += 1; reasons.push("grounded"); } else reasons.push("no-receipt→noise");
  if (refused === 0) { signal += 1; reasons.push("coherent"); } else reasons.push(refused + "-refused→noise");
  return { signal, max, ratio: signal / max, reasons };
}

// ── 3. self-verifying user & self models — PRIVATE-FIRST κ-objects, revisioned, durable ──
// sealUserModel — the deepening, private user model (Honcho-style). Adapts (facts) AND teaches (taught
// count — the two-way loop is first-class). NEVER published (holo:private flag + Data Sovereignty).
export function sealUserModel(store, { facts = {}, taught = 0, priorKappa = null } = {}) {
  const links = []; if (priorKappa) { const p = resolve(store, priorKappa); if (p) links.push(linkTo(store, "prov:wasRevisionOf", p)); }
  return makeObject(store, { type: ["holo:UserModel", "prov:Entity"], context: [HOLO],
    "holo:facts": facts, "holo:taught": taught, "holo:private": true, ...(links.length ? { links } : {}) });
}
// divergence — how far the self has come from a fresh install (anima): higher = stronger identity.
export const divergenceOf = (s = {}) => (s.loops || 0) + (s.skillsLearned || 0) * 3 + (s.revisionsAccepted || 0) * 2;
export function sealSelfModel(store, { stats = {}, priorKappa = null } = {}) {
  const links = []; if (priorKappa) { const p = resolve(store, priorKappa); if (p) links.push(linkTo(store, "prov:wasRevisionOf", p)); }
  return makeObject(store, { type: ["holo:SelfModel", "prov:Entity"], context: [HOLO],
    "holo:stats": stats, "holo:divergence": divergenceOf(stats), ...(links.length ? { links } : {}) });
}
