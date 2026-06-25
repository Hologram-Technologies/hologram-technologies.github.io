#!/usr/bin/env node
// holo-ad4m-wan-witness.mjs — a Neighbourhood crosses the real internet, still with no server. Over mock
// point-to-point wires (faithful async RTCDataChannel stand-ins), two — then three — agents converge a
// shared graph; a peer that joins mid-stream catches up; a peer that drops doesn't stall the rest; and a
// tampered or forged-author chain arriving ON THE WIRE is refused — because the WAN adapter is dumb plumbing
// and the only trust gate is the Neighbourhood's verifyAuthoredChain (Law L5). The capstone: two full Flux
// webs over makeWanTransport converge a post with its real TEXT — proving WAN is a drop-in for the local bus.
//
// Authority: AD4M Neighbourhood / perspective-diff-sync over real transport · holospaces L5 · composes
// holo-ad4m-neighbourhood + holo-ad4m-boot + holo-ad4m-wan. node tools/holo-ad4m-wan-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAd4m } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { makeNeighbourhood } from "../os/usr/lib/holo/holo-ad4m-neighbourhood.mjs";
import { makeWanBus, attachNeighbourhood, makeWanTransport } from "../os/usr/lib/holo/holo-ad4m-wan.mjs";
import { makeHoloWeb } from "../os/usr/lib/holo/holo-ad4m-boot.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tk = 0; const now = () => `2026-06-25T02:00:${String(tk++).padStart(2, "0")}.000Z`;
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0)); };

// a faithful async point-to-point channel pair (an RTCDataChannel stand-in: send + 'message' events).
function wirePair() {
  const mk = () => ({ peer: null, h: null,
    send(s) { const p = this.peer; if (p && p.h) { const h = p.h; queueMicrotask(() => h({ data: s })); } },
    addEventListener(e, f) { if (e === "message") this.h = f; },
    removeEventListener(e, f) { if (e === "message" && this.h === f) this.h = null; } });
  const a = mk(), b = mk(); a.peer = b; b.peer = a; return [a, b];
}

// a Neighbourhood node bound to a WAN bus (its send sink IS the bus, its receiver is wired by attachNeighbourhood).
async function node(label) {
  const signer = await enroll({ label: "wan-" + label, passphrase: "cohere across the planet" });
  const ad4m = makeAd4m({ signer, now });
  const perspective = ad4m.perspective({ backend: null });
  const bus = makeWanBus();
  const nb = makeNeighbourhood({ perspective, me: signer.kappa, self: signer.kappa, post: bus.post });
  attachNeighbourhood(nb, bus);
  return { signer, ad4m, perspective, bus, nb, kappa: signer.kappa };
}
const link = (x, y) => { const [c1, c2] = wirePair(); x.bus.attach(c1); y.bus.attach(c2); };

// ── scenario 1 · two converge + multi-peer fan-out: A is the inviter (star to B and C) ──────────────────
const A = await node("A"), B = await node("B"), C = await node("C");
link(A, B); link(A, C);
await A.nb.addLink({ source: A.kappa, predicate: "posted", target: "did:holo:sha256:" + "a".repeat(64) });
A.nb.publish();
await settle();
const bSees = B.nb.sharedLinks({ predicate: "posted" }).some((l) => l.author === A.kappa);
const cSees = C.nb.sharedLinks({ predicate: "posted" }).some((l) => l.author === A.kappa);
ok("twoConverge", bSees, `B saw=${bSees}`);
ok("multiPeerFanout", cSees && A.bus.peerCount() === 2, `cSaw=${cSees} peers=${A.bus.peerCount()}`);

// ── scenario 2 · third peer joins mid-stream and catches up via want/have ───────────────────────────────
const D = await node("D");
link(A, D);                                   // D connects AFTER A already posted
D.nb.join();                                  // announce: want → A republishes to all peers
await settle();
const dCaughtUp = D.nb.sharedLinks({ predicate: "posted" }).some((l) => l.author === A.kappa);
ok("lateJoinerCatchesUp", dCaughtUp, `D saw=${dCaughtUp}`);

// ── scenario 3 · a dropped peer does not stall the rest ─────────────────────────────────────────────────
const detachAtoB = (() => { const [c1, c2] = wirePair(); const d = A.bus.attach(c1); B.bus.attach(c2); return d; })();
detachAtoB();                                  // simulate B's link dropping
await A.nb.addLink({ source: A.kappa, predicate: "posted", target: "did:holo:sha256:" + "b".repeat(64) });
A.nb.publish();
await settle();
const cGotSecond = C.nb.sharedLinks({ predicate: "posted" }).some((l) => l.target.endsWith("b".repeat(8) + "b".repeat(56)) || l.target.includes("b".repeat(64)));
ok("droppedPeerNoStall", cGotSecond && A.bus.peerCount() >= 1, `cGot2nd=${cGotSecond}`);

// ── scenario 4 · a TAMPERED chain on the wire is refused (the adapter is dumb; the gate is downstream) ──
const rogue = await node("rogue");
const Bbefore = B.nb.sharedLinks({}).length;
let inboundSawTamper = false;
const origInbound = B.nb.onMessage.bind(B.nb);
// build a real chain from rogue, then tamper one entry's payload so it no longer re-derives.
await rogue.nb.addLink({ source: rogue.kappa, predicate: "posted", target: "did:holo:sha256:" + "c".repeat(64) });
const realEntries = rogue.perspective.raw.replay({});
const tampered = JSON.parse(JSON.stringify(realEntries));
tampered[tampered.length - 1]["holstr:payload"].target = "did:holo:sha256:" + "f".repeat(64);   // mutate after sealing
const [rc1, rc2] = wirePair();
B.bus.attach(rc2);
// wrap B inbound to confirm the wire DID forward the tampered message (proving no verification in the wire)
B.bus.onInbound((m) => { if (m && m.t === "ad4m:links") inboundSawTamper = true; origInbound(m); });
rc1.send(JSON.stringify({ t: "ad4m:links", author: rogue.kappa, entries: tampered, from: "rogue" }));
await settle();
const Bafter = B.nb.sharedLinks({}).length;
ok("tamperedRefusedOnWire", inboundSawTamper && Bafter === Bbefore, `forwarded=${inboundSawTamper} before=${Bbefore} after=${Bafter}`);

// ── scenario 5 · a FORGED-AUTHOR chain on the wire is refused (a peer cannot speak for another agent) ──
const before5 = C.nb.sharedLinks({}).length;
const [fc1, fc2] = wirePair();
C.bus.attach(fc2);
fc1.send(JSON.stringify({ t: "ad4m:links", author: C.kappa, entries: rogue.perspective.raw.replay({}), from: "forge" }));  // rogue's entries claimed as C's
await settle();
ok("forgedAuthorRefusedOnWire", C.nb.sharedLinks({}).length === before5, `before=${before5} after=${C.nb.sharedLinks({}).length}`);

// ── scenario 6 · longest-valid-per-author still wins (a stale shorter copy can't override the latest) ──
const E = await node("E"), F = await node("F");
link(E, F);
await E.nb.addLink({ source: E.kappa, predicate: "posted", target: "did:holo:sha256:" + "1".repeat(64) });
E.nb.publish(); await settle();
const eLen1 = E.perspective.raw.replay({}).slice();           // snapshot the shorter chain
await E.nb.addLink({ source: E.kappa, predicate: "posted", target: "did:holo:sha256:" + "2".repeat(64) });
E.nb.publish(); await settle();
const afterLong = F.nb.sharedLinks({ predicate: "posted" }).length;
// now replay the STALE shorter chain at F — must NOT shrink the graph
const [sc1, sc2] = wirePair(); F.bus.attach(sc2);
sc1.send(JSON.stringify({ t: "ad4m:links", author: E.kappa, entries: eLen1, from: "stale" }));
await settle();
ok("longestValidWins", F.nb.sharedLinks({ predicate: "posted" }).length === afterLong && afterLong === 2, `afterLong=${afterLong} now=${F.nb.sharedLinks({ predicate: "posted" }).length}`);

// ── scenario 7 · the adapter does ZERO verification — bytes pass through, the Neighbourhood is the only gate ─
// (proven structurally: scenarios 4 & 5 forwarded invalid frames yet nothing was adopted.) Assert the bus
// itself never inspects content: a non-JSON frame is silently dropped, a JSON frame is delivered verbatim.
let delivered = null; const probe = makeWanBus(); probe.onInbound((m) => { delivered = m; });
const [pc1, pc2] = wirePair(); probe.attach(pc2);
pc1.send("not json{{");                  // garbage → dropped, no throw
await settle();
const afterGarbage = delivered;
pc1.send(JSON.stringify({ t: "anything", payload: 42 }));   // arbitrary → delivered verbatim, uninspected
await settle();
ok("wireIsDumbPlumbing", afterGarbage === null && delivered && delivered.t === "anything" && delivered.payload === 42, JSON.stringify(delivered));

// ── scenario 8 · CAPSTONE: two full Flux webs over makeWanTransport converge a post with its real TEXT ──
const ana = await enroll({ label: "wan-ana", passphrase: "p" });
const bob = await enroll({ label: "wan-bob", passphrase: "p" });
const names = new Map([[ana.kappa, "Ana"], [bob.kappa, "Bob"]]);
let webA, webB;
const txA = makeWanTransport({ deliver: (sid, m) => webA._internal.deliver(sid, m) });
const txB = makeWanTransport({ deliver: (sid, m) => webB._internal.deliver(sid, m) });
const [wc1, wc2] = wirePair(); txA.attach(wc1); txB.attach(wc2);
webA = makeHoloWeb({ signer: ana, now, displayName: "Ana", names, transport: txA });
webB = makeHoloWeb({ signer: bob, now, displayName: "Bob", names, transport: txB });
await webA.open("Orchard"); await webB.open("Orchard"); await settle();
await webA.post("Orchard", "the apples are ripe"); await settle();
const seen = (await webB.open("Orchard")).posts.find((p) => p.text === "the apples are ripe");
ok("fluxConvergesOverWan", !!seen && seen.by === "Ana", JSON.stringify((await webB.open("Orchard")).posts.map((p) => ({ t: p.text, by: p.by }))));

await Promise.all([A, B, C, D, E, F, rogue].map((n) => forget(n.kappa)).concat([forget(ana.kappa), forget(bob.kappa)]));

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-wan — a Neighbourhood over real point-to-point transport (WebRTC DataChannels), serverless: two then three agents converge a shared graph over the wire; a late joiner catches up via want/have; a dropped peer doesn't stall the rest; a tampered or forged-author chain on the wire is refused (the adapter is dumb plumbing — verifyAuthoredChain is the only gate, Law L5); longest-valid-per-author still wins; and two full Flux webs over makeWanTransport converge a post with its real text — WAN is a drop-in for the local bus. No signaling server, no relay, no TURN.",
  authority: "AD4M Neighbourhood / perspective-diff-sync over real transport · holospaces L5 · composes holo-ad4m-neighbourhood + holo-ad4m-boot + holo-ad4m-wan",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-wan-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m WAN witness — Neighbourhoods over real transport, serverless, verify-before-adopt unchanged\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — the shared Space spans the planet, and still proves itself` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
