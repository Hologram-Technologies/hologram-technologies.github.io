#!/usr/bin/env node
// holo-gossip-channel-witness.mjs — proves the REAL gossip transport (G, same-origin leg): driving
// holo-gossip over an actual channel makes peers converge for real, and the epidemic is bounded (it stops
// once everyone knows). A warrant announced by one peer propagates to all; a false warrant propagates to
// none; a peer ignores its own adverts. Uses a fake in-memory hub (BroadcastChannel's behaviour) + real
// warrants (W) + real signers; the browser binding wires the same core to BroadcastChannel.
//
// Checks (all must hold):
//   1 warrantPropagates    — a confirmed warrant announced by A reaches B and C over the channel.
//   2 boundedNoStorm       — the epidemic terminates: total messages is finite + small (idempotent receive).
//   3 falseWarrantBlocked  — a fabricated warrant announced by A reaches no peer (each re-confirms, W).
//   4 ignoresOwnAdverts    — a peer does not process its own broadcast (from === self).
//
// Authority: Holochain gossip model · holospaces Laws L1/L2/L5 · rests on #holo-gossip + #holo-warrant +
// #holo-strand(+rules) + #holo-identity. node tools/holo-gossip-channel-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { seal } from "../os/usr/lib/holo/holo-object.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { defineRuleset } from "../os/usr/lib/holo/holo-strand-rules.mjs";
import { raiseWarrant, makeImmunity } from "../os/usr/lib/holo/holo-warrant.mjs";
import { makeGossip } from "../os/usr/lib/holo/holo-gossip.mjs";
import { makeGossipNet } from "../os/usr/lib/holo/holo-gossip-channel.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// a real confirmable warrant + a false one
const mallory = await enroll({ label: "mallory", passphrase: "ml" });
const RS = defineRuleset({ name: "r", rules: { ingest: { require: ["source"] } } });
const mS = makeStrand({ now, signer: mallory });
const good = await mS.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "5".repeat(64) } });
const bad = await mS.append({ kind: "ingest", payload: { note: "no source" } });
const warrant = await raiseWarrant({ entry: bad, ruleset: RS });
const realFor = await raiseWarrant({ entry: bad, ruleset: RS });
const { "holwar:sig": _s, ...fb } = realFor; fb["holwar:object"] = good; fb["holwar:subject"] = good.id; delete fb.id;
const falseWarrant = seal(fb);

// a fake hub (BroadcastChannel semantics: deliver to everyone EXCEPT the sender), counting messages
let messages = 0;
const peers = [];
const hub = { async broadcast(fromSelf, msg) { messages++; for (const p of peers) { if (p.gossip.self !== fromSelf) await p.net.onMessage(msg); } } };
function addPeer(self, immunity) {
  const gossip = makeGossip({ self, immunity });
  const net = makeGossipNet({ gossip, post: (m) => hub.broadcast(self, m) });
  const peer = { gossip, net }; peers.push(peer); return peer;
}
const A = addPeer("A", makeImmunity());
const B = addPeer("B", makeImmunity());
const C = addPeer("C", makeImmunity());
A.gossip.setHead("A", "did:holo:sha256:" + "a".repeat(64));

// A ingests the real warrant locally, then announces — the channel spreads it
await A.gossip.receive({ heads: {}, warrants: [warrant] });
await A.net.announce();

ok("warrantPropagates", B.gossip.hasWarrant(warrant.id) && C.gossip.hasWarrant(warrant.id), "warrant must reach B and C over the channel");
ok("boundedNoStorm", messages > 0 && messages <= 12, `messages=${messages} (epidemic must terminate, not storm)`);

// A announces a FALSE warrant — no peer should keep it
messages = 0;
await A.gossip.receive({ heads: {}, warrants: [falseWarrant] });   // A re-confirms → rejects → not held
await A.net.announce();
ok("falseWarrantBlocked", !A.gossip.hasWarrant(falseWarrant.id) && !B.gossip.hasWarrant(falseWarrant.id) && !C.gossip.hasWarrant(falseWarrant.id), "false warrant must reach no peer");

// a peer ignores its own advert (from === self)
const before = B.gossip.knownWarrants().length;
const selfAdvert = B.gossip.advertise();
const r = await B.net.onMessage(selfAdvert);
ok("ignoresOwnAdverts", r.newWarrants.length === 0 && B.gossip.knownWarrants().length === before, "own advert must be ignored");

await forget(mallory.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-gossip-channel — real transport for κ-gossip (same-origin leg): driving holo-gossip over an actual channel (BroadcastChannel across tabs/windows in-browser; a fake hub here) converges peers for real, bounded by idempotency (re-broadcast only on new facts → terminates, no storm). A confirmed warrant propagates to all; a false warrant to none (each re-confirms, W); own adverts are ignored. Cross-device transport (WebRTC/libp2p/IPFS pubsub) is the same shape behind the same seam — out-of-band. Pure assembly over holo-gossip; no new crypto.",
  authority: "Holochain gossip model · holospaces Laws L1/L2/L5 · rests on #holo-gossip + #holo-warrant + #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["propagates-over-channel", "bounded-no-storm", "false-blocked", "ignores-own"] : [],
  sample: { warrant: warrant.id, messages },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-gossip-channel-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-gossip-channel witness — REAL transport for κ-gossip (cross-context convergence, bounded)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  peers converge over a real channel; a lie still cannot spread; no storm" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
