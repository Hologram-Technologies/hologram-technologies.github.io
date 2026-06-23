#!/usr/bin/env node
// holo-roam-mirror-witness.mjs — proves the "⇄ Roam" mirror core (Phase E click-test surface): open windows
// mirror across peers over a transport, verify-before-trust, with CONTENT dedup so there is no echo loop.
// Two simulated peers over a fake hub; real openSharedWorkspace + real per-app hosts.
//
// Checks:
//   1 mirrorsApply     — A advertises → B applies A's state to its live frame (applyAdopted fires).
//   2 contentDedupEcho — after applying, B advertising the SAME content sends nothing (no echo loop).
//   3 tamperRejected   — a tampered advert → not applied (verify-before-trust).
//   4 wantPulls        — a fresh peer asks (want) → a peer serves → the fresh peer applies.
//   5 ownIgnored       — a peer ignores its own advert.
//
// Authority: holospaces Laws L1/L2/L5 · rests on #holo-roam-ui + #holo-workspace-share + #holo-workspace-host.
// node tools/holo-roam-mirror-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspaceHost } from "../os/usr/lib/holo/holo-workspace-host.mjs";
import { openSharedWorkspace } from "../os/usr/lib/holo/holo-workspace-share.mjs";
import { makeRoamMirror } from "../os/usr/lib/holo/holo-roam-ui.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const cp = (x) => JSON.parse(JSON.stringify(x));
let tick = 0; const now = () => `2026-06-23T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const APP = "did:holo:sha256:" + "a".repeat(64);
const device = () => { const s = new Map(); return makeWorkspaceHost({ strandFor: (k) => { if (!s.has(k)) s.set(k, []); const a = s.get(k); return makeStrand({ backend: { load: async () => cp(a), save: async (e) => s.set(k, cp(e)) }, now }); } }); };
const makeHub = () => { const peers = []; const q = []; let draining = false; async function drain() { if (draining) return; draining = true; while (q.length) { const m = q.shift(); for (const p of peers) if (p.self !== m.from) await p.net.onMessage(m); } draining = false; } return { add: (self, net) => peers.push({ self, net }), post: (m) => { q.push(m); return drain(); } }; };

const mirror = (self, host, applied) => makeRoamMirror({ self, post: hub.post, getActiveHost: () => host, getOpenApps: () => [{ appKappa: APP }], applyAdopted: (app, st) => applied.push(st), openShared: openSharedWorkspace });

let hub;

// ── 1+2 · mirror applies + no echo ───────────────────────────────────────────────────────────────────
{
  hub = makeHub();
  const A = device(), B = device();
  await A.workspace(APP).save({ doc: "A1" });
  const appliedA = [], appliedB = [];
  const netA = mirror("A", A, appliedA), netB = mirror("B", B, appliedB);
  hub.add("A", netA); hub.add("B", netB);

  await netA.advertiseAll();
  ok("mirrorsApply", appliedB.length === 1 && appliedB[0].doc === "A1", JSON.stringify(appliedB));

  const sent = await netB.advertiseAll();   // B now holds A1 (applied + adopted) → same content → nothing to send
  ok("contentDedupEcho", sent === 0, `B re-sent ${sent}`);
}

// ── 3 · tampered advert rejected ─────────────────────────────────────────────────────────────────────
{
  hub = makeHub();
  const A = device(), B = device();
  await A.workspace(APP).save({ doc: "real" });
  const appliedB = [];
  const netB = mirror("B", B, appliedB);
  hub.add("B", netB);
  const bundle = await A.workspace(APP).bundle();
  bundle.entries[0]["holstr:payload"].state.doc = "FORGED";
  await netB.onMessage({ from: "A", app: APP, bundle });
  ok("tamperRejected", appliedB.length === 0, JSON.stringify(appliedB));
}

// ── 4 · want pulls latest ────────────────────────────────────────────────────────────────────────────
{
  hub = makeHub();
  const A = device(), C = device();
  await A.workspace(APP).save({ doc: "only-A" });
  const appliedC = [];
  const netA = mirror("A", A, []), netC = mirror("C", C, appliedC);
  hub.add("A", netA); hub.add("C", netC);
  await hub.post({ from: "C", want: true });   // C asks → A serves → C applies
  ok("wantPulls", appliedC.length === 1 && appliedC[0].doc === "only-A", JSON.stringify(appliedC));
}

// ── 5 · own advert ignored ───────────────────────────────────────────────────────────────────────────
{
  const A = device(); await A.workspace(APP).save({ doc: "x" });
  const applied = [];
  const net = makeRoamMirror({ self: "A", post: () => {}, getActiveHost: () => A, getOpenApps: () => [{ appKappa: APP }], applyAdopted: (a, s) => applied.push(s), openShared: openSharedWorkspace });
  const r = await net.onMessage({ from: "A", app: APP, bundle: await A.workspace(APP).bundle() });
  ok("ownIgnored", r === null && applied.length === 0, JSON.stringify({ r, applied }));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-roam-ui mirror — the ⇄ Roam toggle's core: open windows mirror across peers over a transport, verify-before-trust (tampered → not applied), with content dedup so applying a peer's state never echoes back into a loop; want pulls the latest; own adverts ignored. Same-origin tabs (BroadcastChannel) work now; WAN (WebRTC/IPFS) is the same seam. No new crypto.",
  authority: "holospaces Laws L1/L2/L5 · rests on #holo-roam-ui + #holo-workspace-share + #holo-workspace-host",
  witnessed,
  covers: witnessed ? ["mirrors-apply", "content-dedup-echo", "tamper-rejected", "want-pulls", "own-ignored"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-roam-mirror-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-roam-ui mirror witness — open windows mirror across tabs, verified, no echo\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  flip Roam on in two tabs → your windows mirror, verified, loop-free" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
