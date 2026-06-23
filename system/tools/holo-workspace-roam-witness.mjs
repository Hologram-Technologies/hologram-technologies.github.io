#!/usr/bin/env node
// holo-workspace-roam-witness.mjs — proves Phase E (the reconcile core): a window FOLLOWS you across
// devices by carrying its source chain, verify-before-mount, with divergent edits keeping BOTH lineages
// (never a destructive merge — monotonic law). Simulates two devices sharing an app chain over an
// in-memory "transport"; real holo-identity signer; the real holo-strand-admit gate. (Live WebRTC/IPFS
// transport is out-of-band; this witnesses the decision that rides on top of it.)
//
// Checks (all must hold):
//   1 fastForward    — device B extends A → A receives B → fast-forward (adopt remote), new head = B's.
//   2 adoptedVerifies — the adopted remote chain verifies after mount (verify-before-trust held).
//   3 inSync         — identical heads → in-sync, nothing adopted.
//   4 localAhead     — A extends B → A receives the STALE B → local-ahead (keep local).
//   5 diverged       — A and B edit concurrently after a shared ancestor → diverged, BOTH lineages kept.
//   6 noHistoryLost  — after a diverged reconcile, local history is untouched (the other is a rewind point).
//   7 rejectedTamper — a tampered remote → rejected (fail-closed), keep local.
//   8 unrelated      — a chain with a different genesis → unrelated, keep local.
//
// Authority: UOR-ADDR · holospaces Laws L1/L2/L5 (monotonic) · RFC 9334 (RATS) · rests on #holo-strand +
// #holo-strand-admit + #holo-workspace + #holo-identity. node tools/holo-workspace-roam-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspace } from "../os/usr/lib/holo/holo-workspace.mjs";
import { shareWorkspace } from "../os/usr/lib/holo/holo-workspace-share.mjs";
import { reconcileRemote } from "../os/usr/lib/holo/holo-workspace-roam.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-23T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "ws-roam-tester", passphrase: "roam pass" });
const APP = "did:holo:sha256:" + "a".repeat(64);

const arrFrom = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (e) => { s = clone(e); } }; };
const wsOver = (entries) => { const strand = makeStrand({ backend: arrFrom(entries), now, signer: op }); return { strand, ws: makeWorkspace({ appKappa: APP, strand, now }) }; };

// shared ancestor: one genesis entry both devices have
const base = wsOver([]); await base.ws.save({ v: "genesis" });
const E0 = base.strand.replay({});                          // [e0] — the common prefix

// device A advances from the shared ancestor
const A = wsOver(E0); await A.ws.save({ v: "A1", panel: "left" });
const A_entries = A.strand.replay({});                      // [e0, eA1]

// ── 1+2 · fast-forward: device B = A's chain + one more; A receives B ────────────────────────────────
{
  const B = wsOver(A_entries); await B.ws.save({ v: "B2", panel: "right" });   // extends A
  const bundle = await shareWorkspace(B.strand);
  const r = await reconcileRemote(A_entries, bundle);
  ok("fastForward", r.outcome === "fast-forward" && r.head === B.strand.head() && Array.isArray(r.adopt), JSON.stringify({ o: r.outcome }));
  // adopt → mount the adopted chain and confirm it verifies + resumes B's state
  const mounted = wsOver(r.adopt);
  const v = await mounted.strand.verify();
  const resumed = await mounted.ws.resume();
  ok("adoptedVerifies", v.ok === true && resumed.v === "B2" && resumed.panel === "right", JSON.stringify({ vok: v.ok, resumed }));
}

// ── 3 · in-sync: identical heads ─────────────────────────────────────────────────────────────────────
{
  const bundle = await shareWorkspace(A.strand);
  const r = await reconcileRemote(A_entries, bundle);
  ok("inSync", r.outcome === "in-sync" && r.adopt === null, r.outcome);
}

// ── 4 · local-ahead: A extends B; A receives the stale B ─────────────────────────────────────────────
{
  const stale = { head: E0[E0.length - 1].id, entries: clone(E0) };            // B is just the genesis (older)
  const r = await reconcileRemote(A_entries, stale);
  ok("localAhead", r.outcome === "local-ahead" && r.head === A.strand.head(), r.outcome);
}

// ── 5+6 · diverged: A and B both edit after the shared ancestor → keep BOTH; lose nothing ────────────
{
  const B = wsOver(E0); await B.ws.save({ v: "B1", panel: "down" });           // a SIBLING of A1 (shared e0)
  const bundle = await shareWorkspace(B.strand);
  const r = await reconcileRemote(A_entries, bundle);
  ok("diverged", r.outcome === "diverged" && r.ancestorAt === 0 && r.lineages.length === 2
    && r.lineages.some((l) => l.head === A.strand.head()) && r.lineages.some((l) => l.head === B.strand.head()), JSON.stringify({ o: r.outcome, anc: r.ancestorAt }));
  // local history untouched — A still resumes A1, with its full version lineage intact
  const stillA = await A.ws.resume(); const histA = (await A.ws.versions()).length;
  ok("noHistoryLost", stillA.v === "A1" && histA === 2, JSON.stringify({ stillA, histA }));
}

// ── 7 · a tampered remote is rejected (fail-closed) ──────────────────────────────────────────────────
{
  const B = wsOver(A_entries); await B.ws.save({ v: "B2" });
  const bundle = await shareWorkspace(B.strand);
  bundle.entries[bundle.entries.length - 1]["holstr:payload"].state.v = "INJECTED";
  const r = await reconcileRemote(A_entries, bundle);
  ok("rejectedTamper", r.outcome === "rejected" && r.head === A.strand.head(), r.outcome);
}

// ── 8 · an unrelated chain (different genesis) is not adopted ─────────────────────────────────────────
{
  const other = wsOver([]); await other.ws.save({ v: "other-genesis" }); await other.ws.save({ v: "other-1" });
  const bundle = await shareWorkspace(other.strand);
  const r = await reconcileRemote(A_entries, bundle);
  ok("unrelated", r.outcome === "unrelated" && r.head === A.strand.head(), r.outcome);
}

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-workspace-roam E — a window follows you across devices by carrying its source chain, verify-before-mount. The device-side reconcile fast-forwards when the remote extends local, keeps local when it's ahead, ignores a different-genesis or tampered remote (fail-closed), and on concurrent divergence KEEPS BOTH LINEAGES — never a destructive merge (monotonic law); the other device's history stays a rewind point and nothing local is lost. 'Following, not syncing.' Live WebRTC/IPFS transport is out-of-band; this is the witnessed decision core. Pure assembly over holo-strand + holo-strand-admit; no new crypto.",
  authority: "UOR-ADDR · holospaces Laws L1/L2/L5 (monotonic) · RFC 9334 (RATS) · rests on #holo-strand + #holo-strand-admit + #holo-workspace + #holo-identity",
  witnessed,
  covers: witnessed ? ["fast-forward", "adopted-verifies", "in-sync", "local-ahead", "diverged-keeps-both", "no-history-lost", "rejected-tamper", "unrelated"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-workspace-roam-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-workspace-roam witness — a window follows you across devices; divergence keeps both lineages\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  following, not syncing — and history is never destroyed" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
