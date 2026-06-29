#!/usr/bin/env node
// holo-ad4m-discovery-witness.mjs — find peers for a Space with NO invite link, still serverless. A newcomer
// connected to ONE intermediary learns (via directory gossip, transitively) who is in a Space it has never
// touched, then auto-rendezvous-connects to a member over MESH-RELAYED signaling — opening a real channel +
// a verified membership grant with nobody pasting a link. The relay is a peer, not a server, and gains
// nothing by relaying (trust is carried, never conferred). The cold first contact (connected to no one) is
// the one honest edge — it still needs a single out-of-band link.
//
// Authority: holo-gossip anti-entropy (carry-not-confer) + holo-ad4m-wan invite handshake, signaling relayed
// over the mesh. node tools/holo-ad4m-discovery-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeWanTransport } from "../os/usr/lib/holo/holo-ad4m-wan.mjs";
import { makeDiscovery } from "../os/usr/lib/holo/holo-ad4m-discovery.mjs";
import { makeHoloWeb } from "../os/usr/lib/holo/holo-ad4m-boot.mjs";
import * as pair from "../os/usr/lib/holo/holo-pair.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tk = 0; const now = () => `2026-06-25T04:00:${String(tk++).padStart(2, "0")}.000Z`;
const T0 = Date.parse("2026-06-25T04:00:00.000Z");
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 0)); };

// faithful async channel pair (RTCDataChannel stand-in) + a shared RTC stub that pairs offerer↔answerer.
function wirePair() {
  const mk = () => ({ peer: null, h: null,
    send(s) { const p = this.peer; if (p && p.h) { const h = p.h; queueMicrotask(() => h({ data: s })); } },
    addEventListener(e, f) { if (e === "message") this.h = f; }, removeEventListener(e, f) { if (e === "message" && this.h === f) this.h = null; } });
  const a = mk(), b = mk(); a.peer = b; b.peer = a; return [a, b];
}
function rtcStub() {
  let offChan = null, ansChan = null;
  return {
    createOfferer: async ({ onChannel }) => { offChan = onChannel; return { offer: "OFFER", accept: async () => { const [a, b] = wirePair(); offChan && offChan(a); ansChan && ansChan(b); }, close() {} }; },
    createAnswerer: async (o, { onChannel }) => { ansChan = onChannel; return { answer: "ANSWER", close() {} }; },
  };
}

// a κ-addressed signaling bus = the mesh routing layer (an intermediary forwards toward the destination).
const bus = new Map();                                   // peer κ → handleSignal
const router = (dest, msg) => { const h = bus.get(dest); if (h) queueMicrotask(() => h(msg)); };

const A = await enroll({ label: "disc-a", passphrase: "find me" });   // owner of Space X
const B = await enroll({ label: "disc-b", passphrase: "find me" });   // the intermediary (relay only)
const C = await enroll({ label: "disc-c", passphrase: "find me" });   // the newcomer
const names = new Map([[A.kappa, "A"], [B.kappa, "B"], [C.kappa, "C"]]);
const SPACE_X = "did:holo:sha256:" + "a7".repeat(32);

// A and C share ONE rtc stub so the relayed handshake between them wires a real (mock) channel pair.
let webA, webC;
const sharedRtc = rtcStub();
const txA2 = makeWanTransport({ deliver: (s, m) => webA._internal.deliver(s, m), operator: A, webrtc: sharedRtc, pair, nowMs: T0 });
const txC2 = makeWanTransport({ deliver: (s, m) => webC._internal.deliver(s, m), operator: C, webrtc: sharedRtc, pair, nowMs: T0 });
webA = makeHoloWeb({ signer: A, now, displayName: "A", names, transport: txA2 });
webC = makeHoloWeb({ signer: C, now, displayName: "C", names, transport: txC2 });

const discA = makeDiscovery({ self: A.kappa, transport: txA2, signal: router });
const discB = makeDiscovery({ self: B.kappa, transport: null, signal: router });   // B is a pure relay (no transport)
const discC = makeDiscovery({ self: C.kappa, transport: txC2, signal: router });
bus.set(A.kappa, discA.handleSignal); bus.set(B.kappa, discB.handleSignal); bus.set(C.kappa, discC.handleSignal);

// A is in Space X; C and B start knowing nothing. A and C each open the Space locally (gated by invite later).
await webA.open("club-x");                                // ensures A's local Space exists
discA.announce(SPACE_X);

// ── 1 · DIRECTORY GOSSIP is TRANSITIVE: C, talking only to B, learns A is in Space X (never met A) ─────
discB.onAdvert(discA.advertise());                        // A → B (B learns A∈X)
discC.onAdvert(discB.advertise());                        // B → C (C learns A∈X via B, transitively)
ok("transitiveDirectory", discC.membersOf(SPACE_X).includes(A.kappa) && !discC.membersOf(SPACE_X).includes(C.kappa), JSON.stringify(discC.membersOf(SPACE_X).map((k) => names.get(k) || k)));

// ── 2 · AUTO-RENDEZVOUS with no pasted link: C discovers A and connects over mesh-relayed signaling ────
const r = await discC.discoverAndJoin(SPACE_X);
await settle();
ok("autoRendezvousNoLink", r.ok && r.peer === A.kappa && !!r.grant, JSON.stringify({ ok: r.ok, peer: names.get(r.peer), grant: !!r.grant }));

// ── 3 · a REAL direct channel now exists between C and A (attached to both WAN transports) ─────────────
ok("directChannelOpened", txA2.peerCount() >= 1 && txC2.peerCount() >= 1 && discC.connectedPeers().includes(A.kappa), `peersA=${txA2.peerCount()} peersC=${txC2.peerCount()}`);

// ── 4 · the membership grant C accepted is operator(A)-signed for C's agent κ (verified, L5) ───────────
ok("membershipVerified", r.admitted && r.admitted.operator === A.kappa && r.admitted.can.includes("space/member"), JSON.stringify(r.admitted));

// ── 5 · they CONVERGE: A posts in Space X, C sees it over the discovered channel (gated membership) ────
// both sides open the same Space (id derived from SPACE_X); the discovered channel carries the Flux traffic.
await webA.open(SPACE_X); await webC.open(SPACE_X);
await webA.post(SPACE_X, "discovered, not invited"); await settle();
const cSees = (await webC.open(SPACE_X)).posts.map((p) => p.text);
ok("convergeAfterDiscovery", cSees.includes("discovered, not invited"), JSON.stringify(cSees));

// ── 6 · TRUST NOT CONFERRED by relaying: B forwarded everything yet holds no membership + no channel ───
ok("relayGainsNothing", !discB.connectedPeers().includes(A.kappa) && discB.membersOf(SPACE_X).every((k) => k !== B.kappa), JSON.stringify({ bPeers: discB.connectedPeers().length, bInX: discB.membersOf(SPACE_X).includes(B.kappa) }));

// ── 7 · IDEMPOTENT directory: re-hearing the same advert learns nothing new (converges regardless of order) ─
const before = JSON.stringify([...discC.directory()].map(([s, set]) => [s, [...set].sort()]));
const learnedAgain = discC.onAdvert(discB.advertise());
const after = JSON.stringify([...discC.directory()].map(([s, set]) => [s, [...set].sort()]));
ok("idempotentGossip", learnedAgain === 0 && before === after, `learnedAgain=${learnedAgain}`);

// ── 8 · the COLD edge is honest: a peer connected to nobody can't discover (needs one out-of-band link) ─
const lonely = makeDiscovery({ self: "did:holo:sha256:" + "00".repeat(32), transport: txC2, signal: router });
const cold = await lonely.discoverAndJoin(SPACE_X);
ok("coldEdgeHonest", cold.ok === false && /no known peer/.test(cold.reason), JSON.stringify(cold));

await Promise.all([forget(A.kappa), forget(B.kappa), forget(C.kappa)]);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-discovery — peers find each other for a Space with NO invite link, serverless: a newcomer connected to one intermediary learns transitively (directory gossip) who is in a Space, then auto-rendezvous-connects to a member over mesh-relayed signaling — a real channel + a verified membership grant open with nobody pasting a link. The relay carries, never confers (it gains no membership/channel); the directory is idempotent; and the cold first contact (connected to no one) is the one honest edge.",
  authority: "holo-gossip anti-entropy + holo-ad4m-wan invite handshake over mesh-relayed signaling · holo-pair delegation (L5)",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-discovery-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m DISCOVERY witness — find peers with no invite link, serverless, trust carried not conferred\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN — the mesh finds its own, and still proves every byte` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
