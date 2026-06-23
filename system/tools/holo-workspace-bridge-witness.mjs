#!/usr/bin/env node
// holo-workspace-bridge-witness.mjs — proves the LIVE WIRING (Phase A in the shell): the bridge turns the
// shell's existing per-app state round-trip into per-app source chains, with ZERO app code. Drives the REAL
// makeWorkspaceHost over in-memory per-app strands with shell-shaped world nodes (kind:"app", appId/appDid,
// appState), exactly what collectAppState folds and the `holo-session:ready` handler reads.
//
// Checks (all must hold):
//   1 capturesRichApps   — captureWorld saves every app node that carries state (→ its per-app chain).
//   2 skipsNonAppAndNull — non-app nodes and apps with no state are skipped (lazy/cheap — no chain).
//   3 reopenResumes      — resumeFor returns the app's last state (close → reopen → as you left it).
//   4 perAppIsolation    — two different apps keep independent chains/state.
//   5 dedupNoChurn       — capturing the SAME world twice adds no new version (host dedups).
//   6 identityPrefersDid — appKappaOf prefers appDid; falls back to holo://appId.
//   7 historyAccrues     — successive distinct states accrue as time-travel versions on the app's chain.
//
// Authority: UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-workspace-host + #holo-workspace +
// #holo-strand. node --import ./tools/holo-fhs-loader.mjs tools/holo-workspace-bridge-witness.mjs (the loader
// resolves the bridge's "./holo-workspace-host.mjs" sibling import in Node exactly as the SW does).

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspaceHost } from "../os/usr/lib/holo/holo-workspace-host.mjs";
import { appKappaOf, captureWorld, resumeFor } from "../os/usr/lib/holo/holo-workspace-bridge.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-23T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "ws-bridge-tester", passphrase: "bridge pass" });

// one in-memory store per app κ (survives a fresh host = a "reload"); a real signer for authorship parity
const stores = new Map();
const strandFor = (appKappa) => { if (!stores.has(appKappa)) stores.set(appKappa, []); const s = stores.get(appKappa); return makeStrand({ backend: { load: async () => clone(s), save: async (e) => { stores.set(appKappa, clone(e)); } }, now, signer: op }); };
const newHost = () => makeWorkspaceHost({ strandFor, now });

const DID = "did:holo:sha256:" + "a".repeat(64);     // an authored app with a content κ
// shell-shaped world: two apps (one with appDid, one with only appId), a stateless app, and a non-app node
const world = [
  { id: "t1", kind: "app", appId: "org.holo.notes", appDid: DID, appState: { doc: "hello", caret: 5 } },
  { id: "t2", kind: "app", appId: "org.holo.calc", appState: null },                 // stateless → no chain
  { id: "t3", kind: "app", appId: "org.holo.wallet", appState: { coin: "BTC" } },     // only appId → holo:// κ
  { id: "t4", kind: "folder", title: "Stuff" },                                       // non-app → skipped
];

// ── 6 · identity derivation ──────────────────────────────────────────────────────────────────────────
ok("identityPrefersDid", appKappaOf(world[0]) === DID && appKappaOf(world[2]) === "holo://org.holo.wallet" && appKappaOf(world[3]) === null, JSON.stringify([appKappaOf(world[0]), appKappaOf(world[2]), appKappaOf(world[3])]));

// ── 1+2 · capture rich apps; skip non-app + null-state ───────────────────────────────────────────────
{
  const host = newHost();
  const saved = await captureWorld(world, host);
  ok("capturesRichApps", saved === 2, `saved=${saved} (expected 2)`);
  const calcChain = stores.get("holo://org.holo.calc");   // never keyed (stateless) → no store entry
  ok("skipsNonAppAndNull", !stores.has(appKappaOf(world[1])) && (calcChain === undefined), `calc=${calcChain === undefined ? "no-chain" : "HAS-CHAIN"}`);
}

// ── 3 · reopen resumes the last state (fresh host = a reload) ─────────────────────────────────────────
{
  const reopened = await resumeFor({ id: "x", kind: "app", appId: "org.holo.notes", appDid: DID }, newHost());
  ok("reopenResumes", reopened && reopened.doc === "hello" && reopened.caret === 5, JSON.stringify(reopened));
}

// ── 4 · per-app isolation ────────────────────────────────────────────────────────────────────────────
{
  const a = await resumeFor(world[0], newHost());     // notes
  const b = await resumeFor(world[2], newHost());     // wallet
  ok("perAppIsolation", a.doc === "hello" && b.coin === "BTC" && a.coin === undefined && b.doc === undefined, JSON.stringify({ a, b }));
}

// ── 5 · dedup: capturing the SAME world again adds no version ─────────────────────────────────────────
{
  const host = newHost();
  const before = (await host.workspace(DID).versions()).length;
  const again = await captureWorld(world, host);       // identical state for notes → no new version
  const after = (await host.workspace(DID).versions()).length;
  ok("dedupNoChurn", again === 0 && after === before, `again=${again} before=${before} after=${after}`);
}

// ── 7 · history accrues across distinct states (time-travel) ─────────────────────────────────────────
{
  const host = newHost();
  await captureWorld([{ id: "t1", kind: "app", appId: "org.holo.notes", appDid: DID, appState: { doc: "v2" } }], host);
  await captureWorld([{ id: "t1", kind: "app", appId: "org.holo.notes", appDid: DID, appState: { doc: "v3" } }], host);
  const vs = await host.workspace(DID).versions();
  ok("historyAccrues", vs.length >= 3, `versions=${vs.length}`);   // hello + v2 + v3 (≥3)
}

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-workspace-bridge — the live wiring: the bridge rides the shell's existing per-app state round-trip (collectAppState / holo-session:ready) to give every app its own source chain with ZERO app code. captureWorld lazily saves each rich-state app node to its per-app chain (skipping non-app + stateless nodes — cheap by construction); resumeFor restores the chain head on cold reopen; per-app isolation, dedup, and accruing time-travel history all hold. Coarse continuity for every window stays the session's job; this adds rich per-app history for participating apps.",
  authority: "UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-workspace-host + #holo-workspace + #holo-strand",
  witnessed,
  covers: witnessed ? ["captures-rich-apps", "skips-nonapp-and-null", "reopen-resumes", "per-app-isolation", "dedup-no-churn", "identity-prefers-did", "history-accrues"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-workspace-bridge-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-workspace-bridge witness — the live wire: every app its own chain, zero app code\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the shell's existing state signal now persists, resumes, and time-travels per app" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
