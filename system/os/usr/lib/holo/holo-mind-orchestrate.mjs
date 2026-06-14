// holo-mind-orchestrate.mjs — Holo Mind (ADR-0081) PHASE 4: orchestration at scale. Two pieces, both
// substrate-native and law-faithful:
//   1. PARALLEL SUB-AGENTS → ONE work receipt. A sub-agent is just a Holo Mind loop run; orchestrating is
//      running several concurrently and sealing ONE self-verifying PROV-O work DAG over their receipts —
//      the Holo Orchestrate idiom (ADR-0045): the root κ is proof of the WHOLE collaboration, re-derivable
//      with no orchestrator to trust (verifyDeep re-runs every sub-receipt). Each sub-agent's every step
//      still passes the fail-closed conscience (ADR-033) — orchestration adds reach, never a gate bypass.
//   2. SCHEDULED TASKS. A holo:ScheduledTask is a κ-object {utterance, everyMs, source}; the DEFINITION
//      re-derives (L5). The FIRING is a runtime event — clocks are not re-derivation-safe, so the clock is
//      an INPUT at the edge (dueTasks takes `now`), keeping this core PURE/witnessable, exactly as the loop
//      borrows the model at the edge. (Honest scope, like Claude Desktop / cron: in-tab tasks fire only
//      while the tab is open — no background server; the substrate is serverless by construction, L1/L4.)
//
// LAW ADHERENCE: L1 every receipt/task is κ-named; L2 canonical forms; L3 the store is the memory; L4 NO new
// orchestrator, gate, or transport — sub-agents are ordinary gated loops, the work receipt is the existing
// PROV-O shape (ADR-0045), delegation rides the existing UCAN seam (ADR-0042) when scoped; L5 the work DAG
// + the task definitions re-derive (a tampered sub-receipt breaks the root). Mints nothing (PROV-O/schema.org).

import { makeObject, verify, verifyDeep, resolve, linkTo } from "./holo-mind.mjs";

const HOLO = { holo: "https://hologram.os/ns/mind#" };

// sealWorkReceipt — compose N sub-agent receipts into ONE self-verifying work DAG (ADR-0045). The root κ
// commits to every sub-receipt; verifyDeep re-derives the whole collaboration. `subKappas` are the κ of the
// sub-runs' root receipts (already in the store). A tampered sub-receipt breaks the root (L5).
export function sealWorkReceipt(store, { intentKappa = null, subKappas = [], actor = "agent", outcome = "success" } = {}) {
  const links = [];
  for (const k of subKappas) { const o = k ? resolve(store, k) : null; if (o) links.push(linkTo(store, "prov:wasInformedBy", o)); }
  return makeObject(store, {
    type: ["holo:WorkReceipt", "prov:Activity"], context: [HOLO],
    "holo:actor": actor, "holo:outcome": outcome, "holo:subAgents": subKappas.length,
    ...(intentKappa ? { "holo:intentKappa": intentKappa } : {}),
    ...(links.length ? { links } : {}),
  });
}

// sealScheduledTask — a re-derivable task DEFINITION. The schedule is data; firing is a runtime act.
export function sealScheduledTask(store, { utterance, everyMs = null, source = "self" } = {}) {
  return makeObject(store, {
    type: ["holo:ScheduledTask", "prov:Plan"], context: [HOLO],
    "holo:utterance": String(utterance), "holo:everyMs": everyMs, "holo:source": source,
  });
}

// dueTasks — PURE: given the tasks and a `now` timestamp (supplied at the edge), which are due (everyMs
// elapsed since lastFired). Deterministic over (tasks ⊕ now) → the core is re-derivation-safe; the clock
// lives in the binding's ticker, never read here.
export function dueTasks(tasks, now) {
  return (tasks || []).filter((t) => t && t.everyMs && (now - (t.lastFired || 0)) >= t.everyMs);
}

// ── UCAN-scoped sub-agent delegation (ADR-0042, re-expressed substrate-native) ──────────────────────
// A holo:Delegation grants a sub-agent a NARROWED, revocable capability: a scoped set of verbs it may
// invoke, derived from (and ⊆) its granter's. The proof chain is content-addressed (prov:wasDerivedFrom),
// so ESCALATION is caught by re-derivation (attenuation) and revoking a delegation invalidates its whole
// SUBTREE. Honest scope: this is ADR-0042's UCAN⊕UOR capability + attenuation + revocation model applied to
// orchestration; the full UCAN signature / principal-alignment proof engine is the agent stack's
// (own.verifyChain / the verify_delegation MCP tool, ADR-0049), against which a work receipt's delegation κ
// can be checked. Mints nothing (PROV-O/schema.org).
export function mintDelegation(store, { granter = "self", capabilities = [], parentKappa = null } = {}) {
  const links = []; if (parentKappa) { const p = resolve(store, parentKappa); if (p) links.push(linkTo(store, "prov:wasDerivedFrom", p)); }
  return makeObject(store, {
    type: ["holo:Delegation", "prov:Entity"], context: [HOLO],
    "holo:granter": granter, "holo:capabilities": [...new Set(capabilities)].sort(),
    ...(links.length ? { links } : {}),
  });
}
// attenuates — a child grant is valid ONLY if its capabilities are a SUBSET of the parent's (no escalation, L5).
export function attenuates(parentCaps = [], childCaps = []) {
  const p = new Set(parentCaps); return (childCaps || []).every((c) => p.has(c));
}
// isRevoked — revoked if the delegation's κ, or ANY ancestor's κ (walking the prov:wasDerivedFrom chain via
// `store`), is in the `revoked` set — so revoking a delegation invalidates its whole subtree.
export function isRevoked(delegation, revoked, store = null) {
  if (!delegation || !revoked || typeof revoked.has !== "function") return false;
  let d = delegation; const seen = new Set();
  while (d && !seen.has(d.id)) {
    seen.add(d.id); if (revoked.has(d.id)) return true;
    const par = (d.links || []).find((l) => l.rel === "prov:wasDerivedFrom");
    d = (par && store) ? resolve(store, par.id) : null;
  }
  return false;
}
// scopeRoster — NARROW a roster to what a delegation permits; a revoked delegation → empty scope (refuse all).
// No delegation → the parent's full roster. This is the attenuation that bounds a sub-agent's authority.
export function scopeRoster(roster = [], delegation = null, { revoked = null, store = null } = {}) {
  if (!delegation) return roster;
  if (isRevoked(delegation, revoked, store)) return [];
  const caps = new Set(delegation["holo:capabilities"] || []);
  return (roster || []).filter((v) => caps.has(v.name));
}
