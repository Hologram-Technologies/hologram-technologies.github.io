#!/usr/bin/env node
// holo-mind-evolve-witness.mjs — proves Holo Mind PHASE 2 (ADR-0081): the LEARNING κ-transform is
// governed and re-derivable. All checks hold against the real os/usr/lib/holo/holo-mind-evolve.mjs:
//   1. corpusAppendOnly  — a Trace chain re-derives (L5); rewriting a PAST trace breaks every successor
//   2. failuresQuery     — the optimizer's signal: only failure traces are surfaced
//   3. revisionReDerives — a sealed SkillRevision re-derives; a flipped field is refused (L5)
//   4. provenanceChain   — a revision links its parent (wasRevisionOf) + corpus + optimizer (wasDerivedFrom); verifyDeep ok
//   5. gateGoverned      — in force ONLY if every condition holds (fail-closed); a FORGED inForce is caught (L5)
//   6. rollbackParent    — sealing a revision NEVER mutates the parent — the prior κ is preserved (rollback)
//   7. sizeLimit         — an over-ceiling proposal fails sizeOk → never in force (no runaway growth)
//   8. optimizerProposes — proposeRevision yields the model's bytes; no sampler → null (the generation is stochastic, fenced from L5)
//   9. lettersChain      — letters-to-self chain via wasRevisionOf and re-derive (L5)
//
//   node tools/holo-mind-evolve-witness.mjs        (also run live by tools/gate.mjs)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { seal, verify, verifyDeep, resolve, makeObject, markReachable } from "../os/usr/lib/holo/holo-mind.mjs";
import { appendTrace, failures, proposeRevision, sealSkillRevision, isInForce, gatePass, sizeOk, sealLetter, projectSkill, SIZE_CEILING } from "../os/usr/lib/holo/holo-mind-evolve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ENC = new TextEncoder(), DEC = new TextDecoder();
const checks = {};
const HOLO = { holo: "https://hologram.os/ns/mind#" };
const K = (c) => "did:holo:sha256:" + String(c).repeat(64).slice(0, 64);
const GOOD = { testsPass: true, sizeOk: true, conscienceOutcome: "accept", ratifiedBy: "operator", coolingOffElapsed: true };

// ── 1. corpusAppendOnly — chain re-derives; tampering a past trace breaks every successor ──
{
  const store = new Map();
  let head = null;
  const t1 = appendTrace(store, head, { intentKappa: K("1"), outcome: "success" }); head = t1.id;
  const t2 = appendTrace(store, head, { intentKappa: K("2"), outcome: "failure", failureKind: "timeout" }); head = t2.id;
  const t3 = appendTrace(store, head, { intentKappa: K("3"), outcome: "success" }); head = t3.id;
  const cleanOk = verifyDeep(store, resolve(store, head)).ok === true;
  const hex2 = t2.id.split(":").pop();
  store.set(hex2, ENC.encode(JSON.stringify({ ...JSON.parse(DEC.decode(store.get(hex2))), "holo:failureKind": "tampered" })));
  const brokenOk = verifyDeep(store, resolve(store, head)).ok === false;
  checks.corpusAppendOnly = cleanOk && brokenOk;
}

// ── 2. failuresQuery — only failure traces are the optimizer's signal ──
{
  const store = new Map();
  let head = null;
  for (const o of ["success", "failure", "success", "failure", "refused"]) head = appendTrace(store, head, { intentKappa: K("9"), outcome: o }).id;
  const f = failures(store, head);
  checks.failuresQuery = f.length === 2 && f.every((t) => t["holo:outcome"] === "failure");
}

// ── 3. revisionReDerives — Law L5 over a sealed revision ──
{
  const store = new Map();
  const rev = sealSkillRevision(store, { proposalBytes: "improved skill text", gate: GOOD });
  const tampered = { ...rev, "holo:proposalBytes": "malware" };
  checks.revisionReDerives = verify(rev) === true && verify(tampered) === false;
}

// ── 4. provenanceChain — wasRevisionOf parent ⊕ wasDerivedFrom corpus ⊕ optimizer, verifyDeep ──
{
  const store = new Map();
  const parent = makeObject(store, { type: ["holo:SkillRevision", "schema:HowTo"], context: [HOLO], "holo:proposalBytes": "v0 skill", "holo:gate": {}, "holo:inForce": false });
  const optimizer = makeObject(store, { type: ["schema:SoftwareApplication"], context: [HOLO], "schema:name": "gepa-dspy-optimizer" });
  const corpusHead = appendTrace(store, null, { intentKappa: K("a"), outcome: "failure", failureKind: "wrong-answer" });
  const rev = sealSkillRevision(store, { parentKappa: parent.id, corpusHeadKappa: corpusHead.id, optimizerKappa: optimizer.id, proposalBytes: "v1 skill", gate: GOOD });
  const rels = (rev.links || []).map((l) => l.rel + ":" + l.id);
  const hasParent = rels.includes("prov:wasRevisionOf:" + parent.id);
  const hasCorpus = rels.includes("prov:wasDerivedFrom:" + corpusHead.id);
  const hasOptimizer = rels.includes("prov:wasDerivedFrom:" + optimizer.id);
  checks.provenanceChain = hasParent && hasCorpus && hasOptimizer && verifyDeep(store, rev).ok === true;
}

// ── 5. gateGoverned — in force ONLY if every condition holds; a forged inForce is refused ──
{
  const store = new Map();
  const good = sealSkillRevision(store, { proposalBytes: "ok", gate: GOOD });
  const unratified = sealSkillRevision(store, { proposalBytes: "ok", gate: { ...GOOD, ratifiedBy: "" } });
  const cooling = sealSkillRevision(store, { proposalBytes: "ok", gate: { ...GOOD, coolingOffElapsed: false } });
  const blocked = sealSkillRevision(store, { proposalBytes: "ok", gate: { ...GOOD, conscienceOutcome: "block" } });
  // a FORGED revision claiming inForce:true over a failing gate — sealed, so it re-derives, but isInForce refuses it
  const forged = seal({ "@context": [], "@type": ["holo:SkillRevision"], "holo:proposalBytes": "evil", "holo:gate": { ...GOOD, ratifiedBy: "" }, "holo:inForce": true });
  checks.gateGoverned = isInForce(good) === true
    && isInForce(unratified) === false && isInForce(cooling) === false && isInForce(blocked) === false
    && verify(forged) === true && isInForce(forged) === false;
}

// ── 6. rollbackParent — sealing a revision never mutates the parent (prior κ preserved) ──
{
  const store = new Map();
  const parent = makeObject(store, { type: ["holo:SkillRevision", "schema:HowTo"], context: [HOLO], "holo:proposalBytes": "v0", "holo:gate": GOOD, "holo:inForce": true });
  const before = JSON.stringify(resolve(store, parent.id));
  sealSkillRevision(store, { parentKappa: parent.id, proposalBytes: "v1", gate: GOOD });
  const after = resolve(store, parent.id);
  checks.rollbackParent = before === JSON.stringify(after) && verify(after) === true;
}

// ── 7. sizeLimit — an over-ceiling proposal fails sizeOk → never in force ──
{
  const store = new Map();
  const huge = "x".repeat(SIZE_CEILING + 1);
  const rev = sealSkillRevision(store, { proposalBytes: huge, gate: { ...GOOD, sizeOk: undefined } });  // let it derive sizeOk
  checks.sizeLimit = sizeOk(huge) === false && rev["holo:gate"].sizeOk === false && isInForce(rev) === false;
}

// ── 8. optimizerProposes — the model's bytes become the proposal; no sampler → null (stochastic, fenced) ──
{
  const sampler = async ({ prompt }) => (typeof prompt === "string" && prompt.includes("improve")) ? "IMPROVED: handle the timeout, verify the result." : "";
  const proposal = await proposeRevision({ parentBytes: "old", failureTraces: [{ "holo:failureKind": "timeout", "holo:intentKappa": K("b") }], sampler });
  const noModel = await proposeRevision({ parentBytes: "old", failureTraces: [], sampler: null });
  checks.optimizerProposes = typeof proposal === "string" && proposal.startsWith("IMPROVED") && noModel === null;
}

// ── 9. lettersChain — letters-to-self chain via wasRevisionOf and re-derive ──
{
  const store = new Map();
  const l1 = sealLetter(store, { narrative: "First reflection.", improvementAreas: ["latency"] });
  const l2 = sealLetter(store, { narrative: "Second.", priorLetterKappa: l1.id, followThrough: "addressed latency" });
  const linked = (l2.links || []).some((l) => l.rel === "prov:wasRevisionOf" && l.id === l1.id);
  checks.lettersChain = linked && verifyDeep(store, l2).ok === true && verify(l1) === true;
}

// ── 10. reProjection — an IN-FORCE revision becomes a live skill descriptor; a not-in-force one does not (ADR-0035 writeback) ──
{
  const store = new Map();
  const SKILL = "---\nname: summarise-notes\ndescription: Summarise notes into 3 bullets, verifying each.\n---\nProcedure: read, cluster, verify.";
  const inForce = sealSkillRevision(store, { proposalBytes: SKILL, gate: GOOD });
  const notForce = sealSkillRevision(store, { proposalBytes: SKILL, gate: { ...GOOD, ratifiedBy: "" } });
  const badName = sealSkillRevision(store, { proposalBytes: "---\nname: Bad Name!\ndescription: x\n---", gate: GOOD });
  const p = projectSkill(inForce);
  checks.reProjection = !!p && p.name === "summarise-notes" && /Summarise/.test(p.description)
    && p.revisionKappa === inForce.id && projectSkill(notForce) === null && projectSkill(badName) === null;
}

// ── 11. corpusGC — mark-and-sweep keeps a recent WINDOW (skipping predecessor chains) + evicts the older prefix ──
{
  const store = new Map();
  let head = null; const rows = [];
  for (let i = 0; i < 5; i++) {
    const intent = makeObject(store, { type: ["holo:Intent"], context: [HOLO], "holo:utterance": "q" + i });
    const t = appendTrace(store, head, { intentKappa: intent.id, outcome: "success" }); head = t.id;
    rows.push({ trace: t.id, intent: intent.id });
  }
  // keep the last 2 traces; skip the prov:wasInformedBy chain so the older prefix is NOT reached
  const keep = markReachable(store, rows.slice(-2).map((r) => r.trace), { skipRels: ["prov:wasInformedBy"] });
  let evicted = 0; for (const hex of [...store.keys()]) if (!keep.has(hex)) { store.delete(hex); evicted++; }
  const hx = (k) => k.split(":").pop();
  const newestResolves = !!resolve(store, head);                         // the window head still re-derives
  const newestIntentKept = store.has(hx(rows[4].intent));               // a kept trace's referenced intent survives
  const oldestEvicted = !store.has(hx(rows[0].trace)) && !store.has(hx(rows[0].intent));   // the older prefix is gone
  checks.corpusGC = evicted >= 6 && newestResolves && newestIntentKept && oldestEvicted && verify(resolve(store, head));
}

// ── verdict + result file ──
const witnessed = Object.values(checks).every(Boolean);
const result = {
  spec: "Holo Mind Phase 2 (ADR-0081) — the LEARNING κ-transform: an append-only, content-addressed trace corpus (rewriting a past trace breaks every successor, L5); governed self-evolution where a skill revision is in force ONLY after tests + size limit + conscience + operator ratification + cooling-off (mirrors ADR-033 rule 4), the in-force fact itself re-derived from the sealed gate (a forged inForce is refused); the parent κ preserved forever (rollback). The writeback ADR-0035 deferred, built on the adaptive-immune-classifier pattern (ADR-033) generalized from defense to all competence. HONEST BOUNDARY: the optimizer's PROPOSAL is a stochastic LLM generation (not reproducible) — L5 holds over the audit trail, not the search.",
  authority: "W3C PROV-O (wasRevisionOf/wasDerivedFrom/wasInformedBy) · W3C DID Core · IETF RFC 8785 (JCS) · W3C Subresource Integrity · UOR-ADDR (κ = H(canonical form)) · the Holo Constitution governed succession + conscience gate (ADR-033) · the adaptive-immune-classifier pattern (ADR-033, a learned model as a pure function of a content-addressed corpus) · ADR-0035 (the skill writeback) · ADR-0039 (append-only hash-linked chain) · holospaces Laws L1/L2/L3/L4/L5 (identity is content · canonical forms only · the store is the memory · everything through the substrate · verify by re-derivation)",
  witnessed,
  covers: witnessed ? ["holo-mind-evolve", "trace-corpus", "append-only", "governed-succession", "self-evolution", "re-projection", "corpus-gc", "letters-to-self", "law-l3", "law-l4", "law-l5"] : [],
  checks,
};
writeFileSync(join(here, "holo-mind-evolve-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
