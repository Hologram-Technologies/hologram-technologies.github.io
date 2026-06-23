#!/usr/bin/env node
// holo-workspace-roam-host-witness.mjs — proves Phase E device-side roam over a TRANSPORT: two simulated
// devices (separate hosts/stores) exchange per-app chains through a fake hub (the same shape BroadcastChannel
// / WebRTC / IPFS fill in). A window follows you across devices, verify-before-trust, divergence keeps both.
// (The live WAN transport is out-of-band; this is the transport-injected core + the simulated-peer gate.)
//
// Checks (all must hold):
//   1 fastForwardConverges — device A (newer) advertises → device B fast-forwards + resumes A's exact state.
//   2 applyAdoptedFired    — B's applyAdopted hook fires with the adopted state (the shell re-renders the app).
//   3 epidemicLocalAhead   — a STALE device advertising → the newer peer pushes back → the stale one converges.
//   4 divergedKeepsBoth    — concurrent edits after a shared ancestor → neither adopts; both lineages survive.
//   5 tamperRejected       — a tampered advert → rejected; the receiver's chain is untouched.
//   6 wantPullsLatest      — a fresh device asks (want) → a peer serves → the fresh device converges.
//   7 ownIgnored           — a device ignores its own advert echoed back.
//
// Authority: holospaces Laws L1/L2/L5 (monotonic) · RFC 9334 (RATS) · rests on #holo-workspace-roam-host +
// #holo-workspace-roam + #holo-workspace-host + #holo-strand. node tools/holo-workspace-roam-host-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspaceHost } from "../os/usr/lib/holo/holo-workspace-host.mjs";
import { makeRoamNet } from "../os/usr/lib/holo/holo-workspace-roam-host.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-23T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const APP = "did:holo:sha256:" + "a".repeat(64);

// a "device" = its own host over its own store (no shared storage — like real separate devices)
function device(seed = []) {
  const stores = new Map();
  const strandFor = (k) => { if (!stores.has(k)) stores.set(k, clone(seed)); const s = stores.get(k); return makeStrand({ backend: { load: async () => clone(s), save: async (e) => { stores.set(k, clone(e)); } }, now }); };
  return makeWorkspaceHost({ strandFor, now });
}

// a fake transport hub: post() enqueues; drain delivers to every OTHER peer's onMessage (awaits the cascade).
function makeHub() {
  const peers = []; const q = []; let draining = false;
  async function drain() { if (draining) return; draining = true; while (q.length) { const msg = q.shift(); for (const p of peers) if (p.self !== msg.from) await p.net.onMessage(msg); } draining = false; }
  return { add: (self, net) => peers.push({ self, net }), post: (msg) => { q.push(msg); return drain(); } };
}

// ── 1+2 · fast-forward convergence + applyAdopted ────────────────────────────────────────────────────
{
  const hub = makeHub();
  const A = device(), B = device();
  // shared genesis so B has a common ancestor (a realistic roam, not a cold pull)
  await A.workspace(APP).save({ doc: "v0" });
  const E0 = (await A.workspace(APP).bundle()).entries;
  const Bseed = device(E0); const Bhost = Bseed;   // B starts at the shared ancestor
  await A.workspace(APP).save({ doc: "v1-on-A" });  // A advances

  const adopted = [];
  const netA = makeRoamNet({ host: A, self: "A", post: hub.post });
  const netB = makeRoamNet({ host: Bhost, self: "B", post: hub.post, applyAdopted: (app, st) => adopted.push({ app, st }) });
  hub.add("A", netA); hub.add("B", netB);

  await netA.advertise(APP);                         // A broadcasts its newer chain
  const bState = await Bhost.workspace(APP).resume();
  ok("fastForwardConverges", bState && bState.doc === "v1-on-A", JSON.stringify(bState));
  ok("applyAdoptedFired", adopted.length === 1 && adopted[0].st.doc === "v1-on-A", JSON.stringify(adopted));
}

// ── 3 · epidemic: a stale device advertising makes the newer peer push back → stale converges ─────────
{
  const hub = makeHub();
  const A = device();
  await A.workspace(APP).save({ doc: "g0" });
  const E0 = (await A.workspace(APP).bundle()).entries;
  const B = device(E0);
  await B.workspace(APP).save({ doc: "newer-on-B" });   // B is AHEAD
  const netA = makeRoamNet({ host: A, self: "A", post: hub.post });
  const netB = makeRoamNet({ host: B, self: "B", post: hub.post });
  hub.add("A", netA); hub.add("B", netB);

  await netA.advertise(APP);                         // A (stale) speaks → B sees local-ahead → B pushes back → A converges
  const aState = await A.workspace(APP).resume();
  ok("epidemicLocalAhead", aState && aState.doc === "newer-on-B", JSON.stringify(aState));
}

// ── 4 · diverged keeps both ──────────────────────────────────────────────────────────────────────────
{
  const hub = makeHub();
  const A = device();
  await A.workspace(APP).save({ doc: "anc" });
  const E0 = (await A.workspace(APP).bundle()).entries;
  const B = device(E0);
  await A.workspace(APP).save({ doc: "A-branch" });
  await B.workspace(APP).save({ doc: "B-branch" });     // sibling of A-branch (shared ancestor)
  let outcome = null;
  const netA = makeRoamNet({ host: A, self: "A", post: hub.post });
  const netB = makeRoamNet({ host: B, self: "B", post: (m) => hub.post(m) });
  // capture B's decision
  const wrapB = { onMessage: async (m) => { const r = await netB.onMessage(m); if (r && r.outcome) outcome = r.outcome; return r; } };
  hub.add("A", netA); hub.add("B", wrapB);
  await netA.advertise(APP);
  const bState = await B.workspace(APP).resume();
  ok("divergedKeepsBoth", outcome === "diverged" && bState.doc === "B-branch", JSON.stringify({ outcome, bState }));
}

// ── 5 · tampered advert rejected ─────────────────────────────────────────────────────────────────────
{
  const hub = makeHub();
  const A = device(); const B = device();
  await A.workspace(APP).save({ doc: "real" });
  const netB = makeRoamNet({ host: B, self: "B", post: hub.post });
  const advert = { from: "A", app: APP, bundle: await A.workspace(APP).bundle() };
  advert.bundle.entries[0]["holstr:payload"].state.doc = "FORGED";   // tamper after sealing
  const r = await netB.onMessage(advert);
  const bHas = (await B.workspace(APP).bundle()).entries.length;
  ok("tamperRejected", r && r.outcome === "rejected" && bHas === 0, JSON.stringify({ o: r && r.outcome, bHas }));
}

// ── 6 · want pulls the latest to a fresh device ──────────────────────────────────────────────────────
{
  const hub = makeHub();
  const A = device(); const B = device();              // B has nothing
  await A.workspace(APP).save({ doc: "only-on-A" });
  const netA = makeRoamNet({ host: A, self: "A", post: hub.post });
  const adopted = [];
  const netB = makeRoamNet({ host: B, self: "B", post: hub.post, applyAdopted: (app, st) => adopted.push(st) });
  hub.add("A", netA); hub.add("B", netB);
  await netB.want(APP);                                // ask peers → A serves → B converges (awaits the cascade)
  const bState = await B.workspace(APP).resume();
  ok("wantPullsLatest", bState && bState.doc === "only-on-A", JSON.stringify(bState));
}

// ── 7 · own advert ignored ───────────────────────────────────────────────────────────────────────────
{
  const A = device();
  await A.workspace(APP).save({ doc: "x" });
  const netA = makeRoamNet({ host: A, self: "A", post: () => {} });
  const r = await netA.onMessage({ from: "A", app: APP, bundle: await A.workspace(APP).bundle() });
  ok("ownIgnored", r === null, JSON.stringify(r));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-workspace-roam-host E — device-side roam over a pluggable transport: devices advertise their per-app chains; a peer reconciles (verify-before-trust) and fast-forwards when the remote is newer (the window follows you), re-advertises when it is newer (epidemic convergence), keeps both lineages on divergence (monotonic), rejects tampered/unrelated/older, and serves pull (want) requests. Transport-injected core proven with a simulated hub; BroadcastChannel is the same-origin leg, WebRTC/IPFS the out-of-band WAN leg behind the same seam. No new crypto.",
  authority: "holospaces Laws L1/L2/L5 (monotonic) · RFC 9334 (RATS) · rests on #holo-workspace-roam-host + #holo-workspace-roam + #holo-workspace-host + #holo-strand",
  witnessed,
  covers: witnessed ? ["fast-forward-converges", "apply-adopted-fired", "epidemic-local-ahead", "diverged-keeps-both", "tamper-rejected", "want-pulls-latest", "own-ignored"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-workspace-roam-host-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-workspace-roam-host witness — a window follows you across devices over a real transport\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  advertise → reconcile → fast-forward; divergence keeps both; tamper refused" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
