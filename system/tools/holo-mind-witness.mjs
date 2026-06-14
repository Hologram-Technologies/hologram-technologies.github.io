#!/usr/bin/env node
// holo-mind-witness.mjs — proves Holo Mind PHASE 0 (ADR-0081): agency is an ambient κ-transform.
// All checks must hold (each a boolean over the real os/usr/lib/holo/holo-mind.mjs core):
//   1. rosterUnion        — the three agent doors (MCP·agents·skills) compose into ONE de-duped roster, capped at MAX_ARM
//   2. receiptReDerives   — a sealed action receipt re-derives (Law L5); a flipped field no longer re-derives → refused
//   3. receiptSymmetry    — a human action and an agent action seal the IDENTICAL shape (only the actor differs)
//   4. tamperRefused      — verifyDeep refuses a receipt whose prior-link bytes were tampered (Law L5, depth ≥ 1)
//   5. gateFailsClosed    — a blocked step seals NOTHING and dispatches NOTHING; AND the real conscience (ADR-033) fail-closes when unsealed
//   6. noNewRoot          — every roster verb name ORIGINATES from an input door (no minted verbs, Law L4); the receipt id is on the shared sha256 axis
//   7. memoHit            — an identical ask ⊕ context ⊕ roster is an O(1) plan replay (Law L3): plan runs ONCE across two loops
//
//   node tools/holo-mind-witness.mjs        (also run live by tools/gate.mjs)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { address as objAddress } from "../os/usr/lib/holo/holo-object.mjs";   // the canonical Node envelope — for the byte-identity cross-check
import { verify, verifyDeep, address, composeRoster, sealIntent, sealActionReceipt, runLoop, modelPlan, parsePlan, MAX_ARM } from "../os/usr/lib/holo/holo-mind.mjs";
const ENC = new TextEncoder(), DEC = new TextDecoder();

const here = dirname(fileURLToPath(import.meta.url));
const checks = {};
const ACCEPT = async () => ({ outcome: "accept" });
const BLOCK = async () => ({ outcome: "block", blocked: ["P5"] });
const STEPS = [{ verb: "resolve_object", decision: {} }, { verb: "search_web", decision: {} }];

// ── 1. rosterUnion — overlapping doors → one capped, de-duped surface (first door wins) ──
{
  const mcp = ["a", "b", "c", "d", "e"].map((n) => ({ name: n, description: n }));
  const agents = [{ name: "c", description: "dup-from-agents" }, { name: "f" }, { name: "g" }];
  const skills = ["h", "i", "j", "k"].map((n) => ({ name: n }));
  const r = composeRoster({ mcp, agents, skills });
  const names = r.map((v) => v.name);
  const unique = new Set(names).size === names.length;
  const cDoor = r.find((v) => v.name === "c");
  checks.rosterUnion = r.length === MAX_ARM && unique && cDoor && cDoor.source === "mcp"
    && names.slice(0, 5).join("") === "abcde";          // order preserved, mcp first
}

// ── 2. receiptReDerives — Law L5 over a sealed receipt ──
{
  const store = new Map();
  const intent = sealIntent(store, { utterance: "summarise this", source: "user" });
  const receipt = sealActionReceipt(store, { intent, step: STEPS[0], verdict: { outcome: "accept" }, actor: "agent", effect: "did:holo:sha256:" + "a".repeat(64) });
  const reDerives = verify(receipt);
  const tampered = { ...receipt, "holo:verb": "rm_rf" };  // flip one field
  checks.receiptReDerives = reDerives === true && verify(tampered) === false;
}

// ── 3. receiptSymmetry — human ≡ agent in shape ──
{
  const store = new Map();
  const intent = sealIntent(store, { utterance: "do the thing" });
  const v = { outcome: "accept" };
  const rH = sealActionReceipt(store, { intent, step: STEPS[0], verdict: v, actor: "human", effect: "x" });
  const rA = sealActionReceipt(store, { intent, step: STEPS[0], verdict: v, actor: "agent", effect: "x" });
  const keysEq = JSON.stringify(Object.keys(rH).sort()) === JSON.stringify(Object.keys(rA).sort());
  const sameType = JSON.stringify(rH["@type"]) === JSON.stringify(rA["@type"]);
  checks.receiptSymmetry = keysEq && sameType && verify(rH) && verify(rA)
    && rH["holo:actor"] === "human" && rA["holo:actor"] === "agent";
}

// ── 4. tamperRefused — verifyDeep through the prior-link, then corrupt the linked bytes ──
{
  const store = new Map();
  const intent = sealIntent(store, { utterance: "chain it" });
  const first = sealActionReceipt(store, { intent, step: STEPS[0], verdict: { outcome: "accept" }, actor: "agent", effect: "1" });
  const second = sealActionReceipt(store, { intent, step: STEPS[1], verdict: { outcome: "accept" }, actor: "agent", effect: "2", prior: first });
  const cleanOk = verifyDeep(store, second).ok === true;             // honest baseline: the clean DAG verifies
  const hex = first.id.split(":").pop();
  store.set(hex, ENC.encode(JSON.stringify({ ...JSON.parse(DEC.decode(store.get(hex))), "holo:verb": "tampered" })));
  const tamperOk = verifyDeep(store, second).ok === false;           // the corrupted link is refused
  checks.tamperRefused = cleanOk && tamperOk;
}

// ── 5. gateFailsClosed — injected block seals/dispatches nothing; real conscience fail-closes ──
{
  const store = new Map();
  let dispatched = 0;
  const dispatch = async () => { dispatched++; return "e"; };
  const run = await runLoop({ utterance: "rm -rf /", actor: "agent" }, { store, roster: [], plan: async () => STEPS, gate: BLOCK, dispatch, memo: new Map() });
  const injectedClosed = run.receiptIds.length === 0 && run.refused.length === STEPS.length && dispatched === 0;

  let realFailClosed = false, conscienceNote = "imported";
  try {
    const { evaluate } = await import("../os/usr/lib/holo/holo-conscience.js");
    realFailClosed = evaluate({}).outcome === "block";              // _sealed === null on fresh import ⇒ block (ADR-033)
  } catch (e) { conscienceNote = "import failed: " + e.message; }
  checks.gateFailsClosed = injectedClosed && realFailClosed;
  checks._conscienceNote = conscienceNote;
}

// ── 6. noNewRoot — no minted verbs (Law L4); receipt on the shared sha256 axis (no parallel hasher) ──
{
  const mcp = [{ name: "resolve_object" }, { name: "answer" }];
  const agents = [{ name: "verify_receipt" }];
  const skills = [{ name: "summarize" }];
  const doorNames = new Set([...mcp, ...agents, ...skills].map((v) => v.name));
  const r = composeRoster({ mcp, agents, skills });
  const allFromDoors = r.every((v) => doorNames.has(v.name));
  const store = new Map();
  const intent = sealIntent(store, { utterance: "x" });
  const receipt = sealActionReceipt(store, { intent, step: STEPS[0], verdict: { outcome: "accept" }, actor: "agent", effect: null });
  const sharedAxis = receipt.id.startsWith("did:holo:sha256:") && receipt.id === address(receipt);
  checks.noNewRoot = allFromDoors && sharedAxis;
}

// ── 7. memoHit — identical ask is an O(1) plan replay (Law L3) ──
{
  const store = new Map();
  const memo = new Map();
  const roster = composeRoster({ mcp: [{ name: "answer" }] });
  let planned = 0, dispatched = 0;
  const plan = async () => { planned++; return STEPS; };
  const dispatch = async () => { dispatched++; return "ok"; };
  const ask = { utterance: "same question", contextKappa: null, actor: "agent" };
  const r1 = await runLoop(ask, { store, roster, plan, gate: ACCEPT, dispatch, memo });
  const r2 = await runLoop(ask, { store, roster, plan, gate: ACCEPT, dispatch, memo });
  checks.memoHit = planned === 1 && r1.memoHit === false && r2.memoHit === true && dispatched === 4;
}

// ── 8. sealEquivalence — the isomorphic sealer is BYTE-IDENTICAL to the canonical Node envelope (holo-object) ──
{
  const store = new Map();
  const intent = sealIntent(store, { utterance: "equivalence" });
  const r = sealActionReceipt(store, { intent, step: STEPS[0], verdict: { outcome: "accept" }, actor: "agent", effect: "z" });
  checks.sealEquivalence = r.id === address(r) && r.id === objAddress(r) && intent.id === objAddress(intent);
}

// ── 9. modelPlan — REAL model planning: the model's tool calls become steps; an INVENTED verb is refused (Law L4) ──
{
  const roster = [{ name: "answer", description: "answer a question" }, { name: "search_web", description: "search the web" }];
  const sampler = async ({ prompt }) => (typeof prompt === "string" && prompt.includes("answer"))
    ? `Sure. <tool_call>{"name":"answer","arguments":{"query":"2+2"}}</tool_call>` : "";
  const steps = await modelPlan({ "holo:utterance": "what is 2+2?" }, roster, sampler);
  const good = steps.length === 1 && steps[0].verb === "answer" && steps[0].args.query === "2+2";
  const invented = parsePlan('<tool_call>{"name":"rm_rf","arguments":{}}</tool_call>', roster).length === 0;  // not in roster → refused
  const none = parsePlan("no tool needed here", roster).length === 0;
  const noModel = (await modelPlan({ "holo:utterance": "x" }, roster, null)).length === 0;                     // no sampler → empty (fall back)
  checks.modelPlan = good && invented && none && noModel;
}

// ── verdict + result file (the shape tools/gate.mjs joins) ──
const boolChecks = Object.fromEntries(Object.entries(checks).filter(([k]) => !k.startsWith("_")));
const witnessed = Object.values(boolChecks).every(Boolean);
const result = {
  spec: "Holo Mind Phase 0 (ADR-0081) — agency is an OS-wide ambient κ-transform: one verb surface from the three existing agent doors (MCP·agents·skills), every action gated by the existing fail-closed conscience (ADR-033) and sealed as a self-verifying PROV-O receipt that re-derives (Law L5), human and agent through the identical surface, identical plans replayed O(1) (Law L3), no new substrate (Law L4).",
  authority: "W3C PROV-O · W3C DID Core · IETF RFC 8785 (JCS) · W3C Subresource Integrity · UOR-ADDR (κ = H(canonical form)) · the Holo Constitution conscience gate (ADR-033) · ADR-0047/0049/0035 (the three agent doors) · holospaces Laws L1/L3/L4/L5 (identity is content · the store is the memory · everything through the substrate · verify by re-derivation)",
  witnessed,
  covers: witnessed ? ["holo-mind", "ambient-agency", "action-receipt", "verb-roster", "conscience-gated", "law-l3", "law-l4", "law-l5"] : [],
  checks: boolChecks,
  notes: { conscience: checks._conscienceNote },
};
writeFileSync(join(here, "holo-mind-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
for (const [k, v] of Object.entries(boolChecks)) console.log(`  ${v ? "ok  " : "FAIL"}  ${k}`);
console.log(`  ·    conscience: ${checks._conscienceNote}`);
console.log(`VERDICT : ${witnessed ? "WITNESSED ✓" : "NOT WITNESSED"}`);
process.exit(witnessed ? 0 : 1);
