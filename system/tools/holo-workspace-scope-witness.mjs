#!/usr/bin/env node
// holo-workspace-scope-witness.mjs — proves the isolation gap is CLOSED: the live capture bridge, when
// pointed at a workspace's SCOPED host (what activeHost() returns in the browser), gives the SAME app κ an
// independent state AND an independent rewind history in each workspace. Drives the real holo-workspaces
// core + the real bridge (captureWorld / resumeFor); real holo-identity signer; in-memory scoped strands.
//
// Checks (all must hold):
//   1 stateIsolated    — same app κ in workspace A vs B resumes DIFFERENT state through the bridge.
//   2 historyIsolated  — that app's rewind history is per-workspace (2 versions in A, 1 in B).
//   3 noCrossLeak      — editing the app in A does NOT change what B resumes (no shared chain).
//   4 reopenScoped     — resumeFor on B's host returns B's state, never A's (cold reopen is workspace-correct).
//
// Authority: holospaces Laws L1/L2/L5 (monotonic) · rests on #holo-workspace-bridge + #holo-workspaces +
// #holo-workspace-host + #holo-strand + #holo-identity. node tools/holo-workspace-scope-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspaces } from "../os/usr/lib/holo/holo-workspaces.mjs";
import { captureWorld, resumeFor } from "../os/usr/lib/holo/holo-workspace-bridge.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-23T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "scope-tester", passphrase: "scope pass" });
const stores = new Map();
const strandFor = (k) => { if (!stores.has(k)) stores.set(k, []); const s = stores.get(k); return makeStrand({ backend: { load: async () => clone(s), save: async (e) => { stores.set(k, clone(e)); } }, now, signer: op }); };
const registryStrand = makeStrand({ backend: (() => { let s = []; return { load: async () => clone(s), save: async (e) => { s = clone(e); } }; })(), now, signer: op });
const sets = makeWorkspaces({ registryStrand, strandFor, operator: op.kappa, now });

const A = await sets.create("A");
const B = await sets.create("B");
const hostA = sets.host(A.id), hostB = sets.host(B.id);

const DID = "did:holo:sha256:" + "a".repeat(64);                 // the SAME app, in both workspaces
const node = (state) => [{ id: "n", kind: "app", appId: "org.holo.notes", appDid: DID, appState: state }];

// capture the same app's state in each workspace through the live bridge
await captureWorld(node({ doc: "alpha" }), hostA);               // workspace A
await captureWorld(node({ doc: "beta" }), hostB);                // workspace B

// ── 1 · state is isolated ────────────────────────────────────────────────────────────────────────────
{
  const a = await resumeFor(node()[0], hostA), b = await resumeFor(node()[0], hostB);
  ok("stateIsolated", a && a.doc === "alpha" && b && b.doc === "beta", JSON.stringify({ a, b }));
}

// edit the app again ONLY in A
await captureWorld(node({ doc: "alpha-2" }), hostA);

// ── 2 · history is isolated ──────────────────────────────────────────────────────────────────────────
{
  const hA = (await hostA.workspace(DID).versions()).length, hB = (await hostB.workspace(DID).versions()).length;
  ok("historyIsolated", hA === 2 && hB === 1, `A=${hA} B=${hB}`);
}

// ── 3 · no cross-leak: B is unchanged by A's edit ────────────────────────────────────────────────────
{
  const b = await resumeFor(node()[0], hostB);
  ok("noCrossLeak", b && b.doc === "beta", JSON.stringify(b));
}

// ── 4 · cold reopen on B's host (fresh host = a reload) returns B's state, not A's ───────────────────
{
  const freshSets = makeWorkspaces({ registryStrand, strandFor, operator: op.kappa, now });
  const b = await resumeFor(node()[0], freshSets.host(B.id));
  ok("reopenScoped", b && b.doc === "beta", JSON.stringify(b));
}

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-workspace-scope — the live capture bridge, pointed at a workspace's scoped host (what activeHost returns in the browser), isolates per-app STATE and per-app rewind HISTORY per workspace: the same app κ in two workspaces resumes different state, keeps independent version lineages, and never leaks across. Closes the gap where per-app capture was keyed by app κ alone. Monotonic; zero app code.",
  authority: "holospaces Laws L1/L2/L5 (monotonic) · rests on #holo-workspace-bridge + #holo-workspaces + #holo-workspace-host + #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["state-isolated", "history-isolated", "no-cross-leak", "reopen-scoped"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-workspace-scope-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-workspace-scope witness — per-app state + history isolated per workspace (live bridge)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the same app in two workspaces keeps separate state + separate history" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
