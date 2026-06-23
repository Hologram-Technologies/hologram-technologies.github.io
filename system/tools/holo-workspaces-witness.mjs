#!/usr/bin/env node
// holo-workspaces-witness.mjs — proves Phase C: THE DESKTOP IS THE SET OF WORKSPACES. A user keeps
// several NAMED workspaces; each is a content-κ Space that scopes its own per-app source chains, so the
// SAME app κ open in two workspaces holds independent state AND independent history. The set itself is a
// hash-linked, signed registry (create/rename/activate), and switching auto-saves the current one and
// restores the target — every window resumes from its own chain. Built on the Phase A/B host; real
// holo-identity signer; in-memory per-scope strands (the browser binding wires encrypted κ-stores).
//
// Checks (all must hold):
//   1 createAndList        — create two named workspaces → list shows both, with their names.
//   2 renameStableId       — rename one → its label changes, its id (identity) does NOT.
//   3 independentState     — the SAME app κ in WS1 vs WS2 holds DIFFERENT state.
//   4 independentHistory   — that app has its own version lineage per workspace (2 in WS1, 1 in WS2).
//   5 activeTracked        — activate(id) makes it the active workspace (projected from the registry).
//   6 saveCurrentOnSwitch  — switchTo runs the pre-switch flush hook (auto-save current before restore).
//   7 cleanSwitch          — after switching away and back, WS1's app resumes WS1's exact state.
//   8 registryVerifies     — the registry chain re-derives + links (signed) — the set's own integrity.
//
// Authority: UOR-ADDR · holospaces Laws L1/L2/L5 (monotonic) · rests on #holo-strand + #holo-workspace-host
// + #holo-object + #holo-identity. node tools/holo-workspaces-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspaces } from "../os/usr/lib/holo/holo-workspaces.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-23T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "workspaces-tester", passphrase: "ws set pass" });

// one in-memory store keyed by scope = "the one backend, many chains". A fresh makeStrand over the same
// scope key sees the same entries (durable across "reloads").
const stores = new Map();
const backendFor = (scopeKey) => {
  if (!stores.has(scopeKey)) stores.set(scopeKey, []);
  return { load: async () => clone(stores.get(scopeKey)), save: async (e) => { stores.set(scopeKey, clone(e)); } };
};
const strandFor = (scopeKey) => makeStrand({ backend: backendFor(scopeKey), now, signer: op });
const registryStrand = makeStrand({ backend: backendFor("registry::" + String(op.kappa).split(":").pop()), now, signer: op });

const sets = makeWorkspaces({ registryStrand, strandFor, operator: op.kappa, now });

const APP = "did:holo:sha256:" + "a".repeat(64);   // the SAME app, in two workspaces

// ── 1 · create two named workspaces, list them ───────────────────────────────────────────────────────
const research = await sets.create("Research");
const trading = await sets.create("Trading");
{
  const { workspaces } = await sets.list();
  const names = workspaces.map((w) => w.name).sort();
  ok("createAndList", workspaces.length === 2 && names[0] === "Research" && names[1] === "Trading" && research.id !== trading.id, JSON.stringify(names));
}

// ── 2 · rename keeps the identity stable ─────────────────────────────────────────────────────────────
{
  await sets.rename(research.id, "Deep Research");
  const { workspaces } = await sets.list();
  const r = workspaces.find((w) => w.id === research.id);
  ok("renameStableId", r && r.name === "Deep Research", JSON.stringify(r));
}

// ── 3+4 · the SAME app κ in WS1 vs WS2 — independent state AND independent history ────────────────────
{
  const wsR = sets.host(research.id).workspace(APP);
  const wsT = sets.host(trading.id).workspace(APP);
  await wsR.save({ query: "holochain", notes: 1 });        // WS1: change 1
  await wsR.save({ query: "holochain", notes: 2 });        // WS1: change 2
  await wsT.save({ symbol: "BTC" });                        // WS2: change 1 (independent)

  const stateR = await wsR.resume(), stateT = await wsT.resume();
  ok("independentState", stateR.query === "holochain" && stateR.notes === 2 && stateT.symbol === "BTC" && stateT.query === undefined, JSON.stringify({ stateR, stateT }));

  const histR = (await wsR.versions()).length, histT = (await wsT.versions()).length;
  ok("independentHistory", histR === 2 && histT === 1, `WS1=${histR} WS2=${histT}`);
}

// ── 5 · active workspace tracked from the registry ───────────────────────────────────────────────────
{
  await sets.activate(trading.id);
  ok("activeTracked", (await sets.active()) === trading.id, await sets.active());
}

// ── 6 · switchTo runs the pre-switch save (auto-save current before restoring target) ────────────────
{
  let flushed = false;
  const host = await sets.switchTo(research.id, { saveCurrent: async () => { flushed = true; } });
  ok("saveCurrentOnSwitch", flushed === true && host != null && (await sets.active()) === research.id, JSON.stringify({ flushed, active: await sets.active() }));
}

// ── 7 · clean switch: away to Trading and back to Research restores WS1's exact app state ─────────────
{
  await sets.switchTo(trading.id);                          // away
  await sets.switchTo(research.id);                         // back
  // a FRESH host over the same stores = a reload; the app resumes its own WS1 chain
  const fresh = makeWorkspaces({ registryStrand, strandFor, operator: op.kappa, now });
  const resumed = await fresh.host(research.id).workspace(APP).resume();
  ok("cleanSwitch", resumed && resumed.query === "holochain" && resumed.notes === 2, JSON.stringify(resumed));
}

// ── 8 · the registry chain itself verifies (signed, hash-linked) ─────────────────────────────────────
{
  const v = await sets.verify();
  ok("registryVerifies", v.ok === true && v.length >= 5, JSON.stringify(v));
}

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-workspaces C — the desktop is the SET of named workspaces. Each named workspace is a content-κ Space that scopes its own per-app source chains, so the same app κ in two workspaces keeps independent state and independent history. The set is a hash-linked, signed registry (create/rename/activate); rename keeps identity stable; switching auto-saves the current workspace and restores the target, each window resuming from its own chain. Built on the Phase A/B host; monotonic (never destroys history); zero app code; no κ surfaced to the user.",
  authority: "UOR-ADDR · holospaces Laws L1/L2/L5 (monotonic) · rests on #holo-strand + #holo-workspace-host + #holo-object + #holo-identity",
  witnessed,
  covers: witnessed ? ["create-and-list", "rename-stable-id", "independent-state", "independent-history", "active-tracked", "save-current-on-switch", "clean-switch", "registry-verifies"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-workspaces-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-workspaces witness — the desktop is the set of named workspaces (independent state + history)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  many named workspaces, each a sovereign set of time-travelling windows" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
