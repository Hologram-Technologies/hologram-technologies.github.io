#!/usr/bin/env node
// holo-mind-orchestrate-witness.mjs — proves Holo Mind PHASE 4 (ADR-0081): orchestration at scale.
//   1. workReceiptComposes — N sub-agent receipts compose into ONE work DAG that commits to + re-derives each (ADR-0045)
//   2. tamperBreaksWork    — a tampered sub-receipt breaks the work root (Law L5 over the whole collaboration)
//   3. workReceiptReDerives — the work receipt re-derives; a flipped field is refused
//   4. scheduledTaskReDerives — a holo:ScheduledTask DEFINITION re-derives; a flipped schedule is refused
//   5. dueLogic            — dueTasks is PURE over (tasks ⊕ now): the clock is an input at the edge, so the core re-derives
//
//   node tools/holo-mind-orchestrate-witness.mjs        (also run live by tools/gate.mjs)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verify, verifyDeep, makeObject } from "../os/usr/lib/holo/holo-mind.mjs";
import { sealWorkReceipt, sealScheduledTask, dueTasks, mintDelegation, attenuates, isRevoked, scopeRoster } from "../os/usr/lib/holo/holo-mind-orchestrate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ENC = new TextEncoder(), DEC = new TextDecoder();
const HOLO = { holo: "https://hologram.os/ns/mind#" };
const K = (c) => "did:holo:sha256:" + String(c).repeat(64).slice(0, 64);
const checks = {};

// ── 1 + 2. parallel sub-agents → one work DAG; a tampered sub-receipt breaks the root ──
{
  const store = new Map();
  const subs = [];
  for (let i = 0; i < 3; i++) subs.push(makeObject(store, { type: ["holo:ActionReceipt", "prov:Activity"], context: [HOLO], "holo:verb": "sub" + i, "prov:generated": { "holo:effectKappa": K(i) } }).id);
  const work = sealWorkReceipt(store, { subKappas: subs, actor: "agent" });
  checks.workReceiptComposes = work["holo:subAgents"] === 3 && (work.links || []).length === 3 && verifyDeep(store, work).ok === true;
  const hex = subs[1].split(":").pop();
  store.set(hex, ENC.encode(JSON.stringify({ ...JSON.parse(DEC.decode(store.get(hex))), "holo:verb": "tampered" })));
  checks.tamperBreaksWork = verifyDeep(store, work).ok === false;
}

// ── 3. workReceiptReDerives — Law L5 over the work receipt ──
{
  const store = new Map();
  const sub = makeObject(store, { type: ["prov:Activity"], context: [HOLO], "holo:verb": "x" }).id;
  const work = sealWorkReceipt(store, { subKappas: [sub], actor: "agent" });
  checks.workReceiptReDerives = verify(work) === true && verify({ ...work, "holo:actor": "forged" }) === false;
}

// ── 4. scheduledTaskReDerives — the task definition re-derives ──
{
  const store = new Map();
  const t = sealScheduledTask(store, { utterance: "daily summary", everyMs: 86400000 });
  checks.scheduledTaskReDerives = verify(t) === true && t["holo:everyMs"] === 86400000 && verify({ ...t, "holo:everyMs": 1 }) === false;
}

// ── 5. dueLogic — pure over (tasks ⊕ now); the clock is an input ──
{
  const tasks = [{ utterance: "a", everyMs: 1000, lastFired: 0 }, { utterance: "b", everyMs: 1000, lastFired: 900 }, { utterance: "c", everyMs: null }];
  const due1 = dueTasks(tasks, 1500).map((t) => t.utterance);   // a: 1500-0≥1000 due · b: 1500-900=600<1000 not · c: no schedule
  const due2 = dueTasks(tasks, 1500).map((t) => t.utterance);
  checks.dueLogic = JSON.stringify(due1) === JSON.stringify(["a"]) && JSON.stringify(due1) === JSON.stringify(due2);
}

// ── 6. delegationAttenuates — a sub-grant must be a SUBSET of its granter (no escalation); the κ re-derives ──
{
  const store = new Map();
  const parent = mintDelegation(store, { capabilities: ["answer", "search_web", "resolve_object"] });
  const child = mintDelegation(store, { capabilities: ["answer", "search_web"], parentKappa: parent.id });   // ⊆ parent
  checks.delegationAttenuates = verify(parent) && verify(child) && verify({ ...parent, "holo:granter": "forged" }) === false
    && attenuates(parent["holo:capabilities"], child["holo:capabilities"]) === true
    && attenuates(parent["holo:capabilities"], ["answer", "write_file"]) === false;   // escalation caught
}

// ── 7. delegationScopes — a delegation NARROWS a roster to its granted verbs ──
{
  const store = new Map();
  const roster = [{ name: "answer" }, { name: "search_web" }, { name: "write_file" }];
  const d = mintDelegation(store, { capabilities: ["answer"] });
  checks.delegationScopes = scopeRoster(roster, d, { store }).map((v) => v.name).join() === "answer"
    && scopeRoster(roster, null).length === 3;   // no delegation → full roster
}

// ── 8. delegationRevokes — revoking a delegation (or any ancestor) empties the scope → refuse all (subtree) ──
{
  const store = new Map();
  const roster = [{ name: "answer" }];
  const parent = mintDelegation(store, { capabilities: ["answer"] });
  const child = mintDelegation(store, { capabilities: ["answer"], parentKappa: parent.id });
  const revoked = new Set();
  const before = scopeRoster(roster, child, { revoked, store }).length;   // 1 — allowed
  revoked.add(parent.id);                                                  // revoke the PARENT
  checks.delegationRevokes = before === 1 && isRevoked(child, revoked, store) === true
    && scopeRoster(roster, child, { revoked, store }).length === 0;        // subtree refused
}

// ── verdict + result file ──
const witnessed = Object.values(checks).every(Boolean);
const result = {
  spec: "Holo Mind Phase 4 (ADR-0081) — orchestration at scale: parallel sub-agents (each an ordinary conscience-gated loop run) compose into ONE self-verifying PROV-O work DAG (Holo Orchestrate idiom, ADR-0045 — the root κ proves the whole collaboration, verifyDeep re-runs every sub-receipt, a tampered sub breaks the root); and scheduled tasks as re-derivable κ-objects whose firing is a runtime event (the clock is an INPUT at the edge — dueTasks is pure, so the core re-derives; in-tab, serverless, fires only while the tab is open — honest scope, no background server).",
  authority: "W3C PROV-O (prov:wasInformedBy — the work DAG) · W3C DID Core · IETF RFC 8785 (JCS) · W3C Subresource Integrity · UOR-ADDR (κ = H(canonical form)) · Holo Orchestrate (ADR-0045, the verifiable multi-agent work receipt) · Holo Delegate (ADR-0042, UCAN-scoped sub-authority) · the Holo Constitution conscience gate (ADR-033) · holospaces Laws L1/L2/L3/L4/L5",
  witnessed,
  covers: witnessed ? ["holo-mind-orchestrate", "parallel-sub-agents", "work-receipt", "scheduled-tasks", "ucan-delegation", "attenuation", "revocation", "law-l1", "law-l4", "law-l5"] : [],
  checks,
};
writeFileSync(join(here, "holo-mind-orchestrate-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
