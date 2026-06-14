// holo-mind-evolve.mjs — Holo Mind (ADR-0081) PHASE 2: the LEARNING κ-transform.
//   κ(trace-corpus) ⊕ κ(optimizer) → κ(improved-skill)
// This is the writeback ADR-0035 deferred ("Hologram skills are a deterministic projection, not a mutable
// store") — now a GOVERNED, re-derivable mutation, built on the adaptive-immune-classifier pattern
// (ADR-0033: a learned model as a PURE FUNCTION of a content-addressed, append-only corpus, re-derivable)
// generalized from defense to ALL competence. Isomorphic (Node · browser): sealing rides holo-mind.mjs's
// JCS sealer (byte-identical to the canonical holo-object envelope, witnessed).
//
// STRICT LAW ADHERENCE (holospaces docs/12-Glossary §The Five Laws, pin bb742bb):
//   L1 "identity is content not location" — every Trace · SkillRevision · Letter is named by its κ alone.
//   L2 "canonical forms only" — one canonical form per object via holo-mind's JCS seal; no drift, no second shape.
//   L3 "the store is the memory" — the corpus is content-keyed + append-only; identical content dedups (free).
//   L4 "everything through the substrate" — NO new store, transport, model, or trust root: the corpus is
//      κ-objects in the existing store; the optimizer borrows the EXISTING ask_model sampler; governance is
//      the EXISTING conscience gate (ADR-033); succession mirrors the constitution's own (ADR-033 rule 4).
//   L5 "verify by re-derivation" — the corpus chain AND a revision's provenance + in-force fact all
//      re-derive; a rewritten past Trace changes its κ and breaks every successor (append-only by arithmetic).
//      HONEST BOUNDARY (the one place L5 cannot cover generation): the optimizer's PROPOSAL is produced by a
//      stochastic LLM and is therefore NOT reproducible — exactly ADR-0052's "creative sampling is a
//      non-verifiable mode". L5 holds over the AUDIT TRAIL (which corpus, which optimizer, which gate
//      verdicts, ratified by whom), not over the search. You can prove HOW a skill lawfully descended and
//      was ratified — not reproduce the mutation that suggested it. Mints nothing (PROV-O/schema.org).

import { makeObject, verify, verifyDeep, resolve, linkTo } from "./holo-mind.mjs";

const HOLO = { holo: "https://hologram.os/ns/mind#" };
export const SIZE_CEILING = 8192;        // a skill's byte ceiling — no runaway prompt growth (a governed condition)

// ── the trace corpus: an append-only, content-addressed CHAIN (the AgentTrust idiom, ADR-0039) ──
// Each Trace commits to its predecessor's κ via a verifyDeep link; rewriting any past Trace changes its κ
// and breaks every successor (L5). The returned Trace IS the new head. intent/plan/receipt are recorded as
// κ references (re-derivable on their own); the CHAIN edge is what the corpus's integrity rests on.
export function appendTrace(store, priorHeadKappa, { intentKappa = null, planKappa = null, receiptKappa = null, outcome = "success", failureKind = null } = {}) {
  const links = [];
  if (priorHeadKappa) { const prior = resolve(store, priorHeadKappa); if (prior) links.push(linkTo(store, "prov:wasInformedBy", prior)); }
  return makeObject(store, {
    type: ["holo:Trace", "prov:Entity"], context: [HOLO],
    "holo:intentKappa": intentKappa, "holo:planKappa": planKappa, "holo:receiptKappa": receiptKappa,
    "holo:outcome": outcome, "holo:failureKind": failureKind,
    ...(links.length ? { links } : {}),
  });
}

// walkCorpus — the chain newest → oldest (a read over the store, L3). failures() is the optimizer's signal.
export function walkCorpus(store, headKappa) {
  const out = []; const seen = new Set(); let k = headKappa;
  while (k && !seen.has(k)) { seen.add(k); const t = resolve(store, k); if (!t) break; out.push(t);
    const link = (t.links || []).find((l) => l.rel === "prov:wasInformedBy"); k = link ? link.id : null; }
  return out;
}
export const failures = (store, headKappa) => walkCorpus(store, headKappa).filter((t) => t["holo:outcome"] === "failure");

// ── the optimizer (GEPA/DSPy-style reflective search) — the STOCHASTIC step, fenced from the L5 claim ──
// evolvePrompt is pure; proposeRevision calls the injected model sampler (the same one that plans). Its
// output is the proposed skill bytes — a NON-reproducible generation. Sealing it (below) is what makes the
// RESULT re-derivable, not the search.
export function evolvePrompt(parentBytes, failureTraces) {
  const fails = (failureTraces || []).map((t) => `- ${t["holo:failureKind"] || "failure"} (intent ${String(t["holo:intentKappa"] || "").slice(0, 24)})`).join("\n");
  return `You improve a skill by learning from its failures. Current skill:\n---\n${parentBytes}\n---\n`
    + `Recent failures:\n${fails || "(none recorded)"}\n\n`
    + `Write an improved skill that captures the procedure, the pitfalls these failures reveal, and explicit verification steps. Reply with the full revised skill text only.`;
}
export async function proposeRevision({ parentBytes = "", failureTraces = [], sampler, maxTokens = 512 } = {}) {
  if (typeof sampler !== "function") return null;                 // no model in context → no proposal (fall back)
  const out = await sampler({ prompt: evolvePrompt(parentBytes, failureTraces), maxTokens });
  const bytes = out == null ? "" : String(out).trim();
  return bytes || null;                                           // the proposed bytes (stochastic — not re-derivable)
}

// ── governed succession (mirrors ADR-0033 rule 4): a revision is IN FORCE only if EVERY condition holds ──
// Pure + deterministic over the gate evidence → the "in force" fact is itself re-derivable (L5). Fail-closed:
// a missing condition keeps it out of force. NEVER mutate the parent — the prior κ is preserved forever
// (rollback = re-pin the parent).
export const sizeOk = (bytes) => typeof bytes === "string" && bytes.length > 0 && bytes.length <= SIZE_CEILING;
export function gatePass(gate = {}) {
  return gate.testsPass === true
    && gate.sizeOk === true
    && gate.conscienceOutcome === "accept"
    && typeof gate.ratifiedBy === "string" && gate.ratifiedBy.length > 0
    && gate.coolingOffElapsed === true;
}

// sealSkillRevision — a NEW κ linking its parent (prov:wasRevisionOf) and what it derived from
// (prov:wasDerivedFrom the corpus head ⊕ the optimizer). The proposal bytes are sealed VERBATIM (provenance,
// not reproduced). inForce is DERIVED from the sealed gate, so the κ commits to (gate ⇔ inForce) — a verifier
// re-derives that the revision is lawfully in force, and a forged "inForce:true" with a failing gate is caught.
export function sealSkillRevision(store, { parentKappa = null, corpusHeadKappa = null, optimizerKappa = null, proposalBytes = "", gate = {} } = {}) {
  const links = [];
  for (const [rel, k] of [["prov:wasRevisionOf", parentKappa], ["prov:wasDerivedFrom", corpusHeadKappa], ["prov:wasDerivedFrom", optimizerKappa]]) {
    if (!k) continue; const o = resolve(store, k); if (o) links.push(linkTo(store, rel, o));
  }
  const g = { ...gate, sizeOk: gate.sizeOk ?? sizeOk(proposalBytes) };
  return makeObject(store, {
    type: ["holo:SkillRevision", "prov:Entity", "schema:HowTo"], context: [HOLO],
    "holo:proposalBytes": String(proposalBytes ?? ""), "holo:gate": g, "holo:inForce": gatePass(g),
    ...(links.length ? { links } : {}),
  });
}
// isInForce — true ONLY if the revision re-derives AND it claims to be in force AND the gate actually
// passes when re-evaluated from the sealed evidence (L5: the in-force fact is re-derived, never trusted).
// So an honest not-in-force revision (inForce:false) is not in force, AND a FORGED inForce:true over a
// failing gate is refused (gatePass re-checks the evidence and disagrees).
export const isInForce = (rev) => verify(rev) && rev["holo:inForce"] === true && gatePass(rev["holo:gate"] || {});

// ── re-projection (ADR-0035): an IN-FORCE revision becomes a live skill that changes behavior ──
// ADR-0035 made skills a deterministic projection (SKILL.md ⊕ a self-verifying UOR object). The writeback
// is the inverse, kept faithful: an in-force SkillRevision's proposal bytes ARE a SKILL.md; projectSkill
// reads its agentskills.io frontmatter and returns the live skill descriptor {name, description} the loop's
// roster carries — so the next plan sees the IMPROVED skill. Governance gates behavior change: a revision
// that is NOT in force projects to null. The revision κ is the skill's content-addressed identity (L1).
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;     // agentskills.io: lowercase + digits + single hyphens, ≤64
export function parseFrontmatter(text) {
  const m = String(text).match(/^---\s*\n([\s\S]*?)\n---/);
  const out = {};
  if (m) for (const line of m[1].split("\n")) {
    const i = line.indexOf(":"); if (i <= 0) continue;
    const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k) out[k] = v;
  }
  return out;
}
export function projectSkill(rev) {
  if (!isInForce(rev)) return null;                    // not in force → no behavior change (governed)
  const fm = parseFrontmatter(rev["holo:proposalBytes"] || "");
  if (!fm.name || fm.name.length > 64 || !SKILL_NAME_RE.test(fm.name)) return null;
  const description = (fm.description || "").slice(0, 1024);
  if (!description) return null;                        // agentskills.io requires a non-empty description
  return { name: fm.name, description, source: "learned", revisionKappa: rev.id };
}

// ── letters to self (anima's self_reflection): a hash-linked chain of self-assessment, re-derivable ──
export function sealLetter(store, { narrative = "", improvementAreas = [], priorLetterKappa = null, followThrough = null } = {}) {
  const links = [];
  if (priorLetterKappa) { const p = resolve(store, priorLetterKappa); if (p) links.push(linkTo(store, "prov:wasRevisionOf", p)); }
  return makeObject(store, {
    type: ["holo:Letter", "prov:Entity"], context: [HOLO],
    "holo:narrative": String(narrative), "holo:improvementAreas": improvementAreas, "holo:followThrough": followThrough,
    ...(links.length ? { links } : {}),
  });
}

// evolve — the whole Phase 2 transform end to end: read failures → propose (stochastic) → seal under the
// governing gate. Returns the sealed revision (inForce per the gate). Pure given the sampler + gate.
export async function evolve(store, { parentKappa, parentBytes, corpusHeadKappa, optimizerKappa, sampler, gate = {} } = {}) {
  const fails = corpusHeadKappa ? failures(store, corpusHeadKappa) : [];
  const proposalBytes = await proposeRevision({ parentBytes, failureTraces: fails, sampler });
  if (!proposalBytes) return null;                                // no model / empty proposal → nothing to govern
  return sealSkillRevision(store, { parentKappa, corpusHeadKappa, optimizerKappa, proposalBytes, gate });
}
