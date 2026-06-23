#!/usr/bin/env node
// holo-roam-wan-witness.mjs — proves roam is EMBEDDED + SEAMLESS across BOTH transports: BroadcastChannel
// (other tabs) and a relay pub/sub topic keyed by κ (other devices, the WAN leg). Verify-before-trust on
// receipt; one ambient handle fans an edit out to every leg. Simulated with fake relay + BroadcastChannel
// hubs; real holo-workspace-host + openSharedWorkspace underneath.
//
// Checks:
//   1 relayMirrors    — device A advertises over the relay → device B applies A's exact state.
//   2 relayTamper     — a tampered relay message → not applied (verify-before-trust).
//   3 ambientFanout   — startAmbientRoam(bc+relay) advertiseAll reaches BOTH a tab peer AND a device peer.
//   4 ambientFailSoft — no transports → advertiseAll is a no-op (today's single-device behaviour), no throw.
//
// Authority: rests on #holo-roam-wan + #holo-roam-ui + #holo-pull-rendezvous + #holo-workspace-host.
// node tools/holo-roam-wan-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeWorkspaceHost } from "../os/usr/lib/holo/holo-workspace-host.mjs";
import { openSharedWorkspace } from "../os/usr/lib/holo/holo-workspace-share.mjs";
import { makeRelayRoam, startAmbientRoam } from "../os/usr/lib/holo/holo-roam-wan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const cp = (x) => JSON.parse(JSON.stringify(x));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const APP = "did:holo:sha256:" + "a".repeat(64);
const device = () => { const s = new Map(); return makeWorkspaceHost({ strandFor: (k) => { if (!s.has(k)) s.set(k, []); const a = s.get(k); return makeStrand({ backend: { load: async () => cp(a), save: async (e) => s.set(k, cp(e)) }, now: () => new Date().toISOString() } ); } }); };
// fake relay: publish awaits every subscriber (deterministic delivery, incl. the publisher's own → ignored by from-guard)
const relayHub = () => { const subs = new Map(); return { publish: async (t, m) => { for (const cb of (subs.get(t) || [])) await cb(m); }, subscribe: (t, cb) => { (subs.get(t) || subs.set(t, []).get(t)).push(cb); return () => {}; } }; };
// fake BroadcastChannel hub
const bcHub = () => { const chans = []; return { make() { const c = { name: "x", onmessage: null, postMessage: async (m) => { for (const o of chans) if (o !== c && o.onmessage) await o.onmessage({ data: m }); }, close() {} }; chans.push(c); return c; } }; };
const node = (st) => [{ id: "n", kind: "app", appId: "x", appDid: APP, appState: st }];

// ── 1+2 · relay roam mirrors + verify-before-trust ───────────────────────────────────────────────────
{
  const relay = relayHub();
  const A = device(), B = device();
  await A.workspace(APP).save({ doc: "from-A-over-relay" });
  const appliedB = [];
  makeRelayRoam({ relay, kappa: "op1", getActiveHost: () => B, getOpenApps: () => [{ appKappa: APP }], applyAdopted: (a, s) => appliedB.push(s), openShared: openSharedWorkspace, self: "B" });
  const ra = makeRelayRoam({ relay, kappa: "op1", getActiveHost: () => A, getOpenApps: () => [{ appKappa: APP }], applyAdopted: () => {}, openShared: openSharedWorkspace, self: "A" });
  await ra.advertiseAll(); await wait(30);
  ok("relayMirrors", appliedB.length === 1 && appliedB[0].doc === "from-A-over-relay", JSON.stringify(appliedB));

  // tamper: a forged relay message for the same topic → not applied
  const appliedB2 = appliedB.length;
  const bundle = await A.workspace(APP).bundle(); bundle.entries[0]["holstr:payload"].state.doc = "FORGED";
  await relay.publish("holo:swarm:op1", { from: "X", app: APP, bundle });
  await wait(30);
  ok("relayTamper", appliedB.length === appliedB2, "applied a tampered msg");
}

// ── 3 · ambient fan-out: one edit → tabs AND devices ─────────────────────────────────────────────────
{
  const relay = relayHub(); const bch = bcHub();
  const A = device();
  await A.workspace(APP).save({ doc: "fanout" });
  // a tab peer (own bc on the same hub) and a device peer (own relay sub)
  const tab = []; const dev = [];
  const bcPeer = bch.make(); const Bt = device();
  bcPeer.onmessage = (e) => { /* a tab peer mirror */ };
  // use the library to build peers so behaviour matches production
  const bcA = bch.make();
  const peerTabHost = device();
  const bcTab = bch.make(); // peer's channel
  const { makeRoamMirror } = await import("../os/usr/lib/holo/holo-roam-ui.mjs");
  const mTab = makeRoamMirror({ self: "tabPeer", getActiveHost: () => peerTabHost, getOpenApps: () => [{ appKappa: APP }], applyAdopted: (a, s) => tab.push(s), openShared: openSharedWorkspace, post: () => {} });
  bcTab.onmessage = (e) => mTab.onMessage(e.data);
  const peerDevHost = device();
  makeRelayRoam({ relay, kappa: "op2", getActiveHost: () => peerDevHost, getOpenApps: () => [{ appKappa: APP }], applyAdopted: (a, s) => dev.push(s), openShared: openSharedWorkspace, self: "devPeer" });

  const h = startAmbientRoam({ getActiveHost: () => A, getOpenApps: () => [{ appKappa: APP }], applyAdopted: () => {}, openShared: openSharedWorkspace, self: "A", bc: bcA, relay, kappa: "op2" });
  await h.advertiseAll(); await wait(40);
  ok("ambientFanout", h.legs.includes("tabs") && h.legs.includes("devices") && tab.some((s) => s.doc === "fanout") && dev.some((s) => s.doc === "fanout"), JSON.stringify({ legs: h.legs, tab, dev }));
}

// ── 4 · fail-soft: no transports ─────────────────────────────────────────────────────────────────────
{
  const A = device(); await A.workspace(APP).save({ doc: "x" });
  const h = startAmbientRoam({ getActiveHost: () => A, getOpenApps: () => [{ appKappa: APP }], applyAdopted: () => {}, openShared: openSharedWorkspace, self: "A", bc: null, relay: null });
  let threw = false; try { await h.advertiseAll(); } catch (e) { threw = true; }
  ok("ambientFailSoft", h.legs.length === 0 && !threw, JSON.stringify(h.legs));
}

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-roam-wan — roam embedded across two transports: BroadcastChannel (tabs) + a κ-keyed relay topic (devices, WAN). Verify-before-trust on receipt; one ambient handle fans an edit to every leg, deduped; fail-soft when a transport is absent. The relay leg rides the existing holo-pull-rendezvous rung; the real relay is injected in prod, faked here.",
  authority: "rests on #holo-roam-wan + #holo-roam-ui + #holo-pull-rendezvous + #holo-workspace-host",
  witnessed,
  covers: witnessed ? ["relay-mirrors", "relay-tamper", "ambient-fanout", "ambient-fail-soft"] : [],
  checks, failed: fail,
};
writeFileSync(join(here, "holo-roam-wan-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-roam-wan witness — roam across tabs AND devices, seamless, verified\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  one edit fans out to every device/tab, verify-before-trust, fail-soft" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
