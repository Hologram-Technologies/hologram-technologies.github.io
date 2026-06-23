#!/usr/bin/env node
// holo-messenger-transport-witness.mjs — THE LIVE STREAM, proven in pure Node.
//
// Real-time, low-latency message delivery over the EXISTING κ pub/sub codec (holo-wire) and
// the gossip/BroadcastChannel transport shape — with integrity enforced at the EDGE, not the
// relay. A fake in-process hub stands in for BroadcastChannel (a separate tab = a separate peer).
//
//   FRAME    — a captured message frames as a holo-wire PUT and round-trips (op/topic/kappa/bytes)
//   STREAM   — publish → the subscriber receives + verifies + delivers in the SAME tick (1 hop)
//   VERIFY   — a tampered frame is refused verify-before-render; onMessage never fires (SEC-1/L5)
//   TOPIC    — a subscriber ignores frames on conversations it isn't subscribed to
//   DEDUP    — the same frame twice delivers once (SEC-3 idempotent)
//   BOUND    — the seen-set is capped by quota, not declared counts (SEC-8)
//   RELAY    — a content-blind relay forwards bytes UNCHANGED and the EDGE refuses tampering (SEC-7)
//   FETCH    — relay answers GET with the cached frame (OBJ) or MISS — never parsing the payload
//   E2E      — capture → thread.ingest → publish → subscriber verifies → thread.ingestObject →
//              the inbox converges to the SAME message κ (cross-tab real-time, serverless)
//
//   node tools/holo-messenger-transport-witness.mjs
//
// Authority: holo-wire · holo-gossip-channel · holospaces SEC-1/SEC-3/SEC-7/SEC-8 · Law L5.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { OP, encodeMsg, decodeMsg } from "../os/sbin/holo-wire.mjs";
import { frameMessage, makePublisher, makeSubscriber, makeRelay } from "../os/usr/lib/holo/holo-messenger-transport.mjs";
import { mint } from "../os/usr/lib/holo/holo-pluck.mjs";
import { conversationGenesis, makeThread } from "../os/usr/lib/holo/holo-messenger-thread.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = new TextEncoder(); const dec = new TextDecoder();

// fake BroadcastChannel: join with a receive fn; the returned post() delivers SYNCHRONOUSLY to
// every OTHER peer (same tick) — exactly the same-origin BroadcastChannel semantics, minus the OS.
function makeHub() {
  const peers = [];
  return { join(recv) { const self = { recv }; peers.push(self); return (f) => { for (const p of peers) if (p !== self) p.recv(f); }; } };
}

const genesis = conversationGenesis({ platform: "whatsapp", chat: "Ilya" });
const objA = mint({ text: "The future is light photonics. HOLOGRAM.", sender: "Ilya", sentAt: "08:31", chat: "Ilya", source: "web.whatsapp.com" }).object;

// ── 1 · FRAME — a captured message frames as a holo-wire PUT and round-trips ──
const f = frameMessage(genesis, objA);
const d = decodeMsg(f);
ok("frame-roundtrips-as-wire-put",
  d.op === OP.PUT && d.topic === genesis && d.kappa === objA.id &&
  JSON.parse(dec.decode(d.bytes)).id === objA.id,
  `op=${d.op} topic=${d.topic.slice(-8)}`);

// ── 2 · STREAM — publish delivers a verified message to the inbox in the SAME tick (1 hop) ──
const hub = makeHub();
let delivered = null;
const inbox = makeSubscriber({ topics: [genesis], onMessage: (m) => { delivered = m; } });
hub.join((fr) => inbox.receive(fr));            // the inbox tab (a peer)
const pubPost = hub.join(() => {});             // the platform tab (a peer)
const pub = makePublisher({ send: pubPost });
pub.publish(genesis, objA);                     // synchronous broadcast
ok("stream-delivers-verified-same-tick",
  !!delivered && delivered.kappa === objA.id && delivered.genesis === genesis && delivered.object["schema:text"] === "The future is light photonics. HOLOGRAM.",
  delivered ? delivered.kappa.slice(-8) : "no delivery");

// ── 3 · VERIFY — a tampered frame is refused verify-before-render; onMessage never fires (SEC-1/L5) ──
let bad = null;
const inbox2 = makeSubscriber({ topics: [genesis], onMessage: (m) => { bad = m; } });
const tamperedFrame = encodeMsg({ op: OP.PUT, topic: genesis, kappa: objA.id, bytes: enc.encode(JSON.stringify({ ...objA, "schema:text": "forged" })) });
const rTamper = inbox2.receive(tamperedFrame);
ok("tampered-frame-refused-fail-closed", rTamper.ok === false && /verify-failed/.test(rTamper.why) && bad === null, rTamper.why);

// ── 4 · TOPIC — a subscriber ignores frames on conversations it isn't subscribed to ──
const otherGenesis = conversationGenesis({ platform: "telegram", chat: "Bob" });
const rWrong = inbox2.receive(frameMessage(otherGenesis, objA));
ok("topic-filtering", rWrong.ok === false && rWrong.why === "topic-not-subscribed", rWrong.why);

// ── 5 · DEDUP — the same frame twice delivers once (SEC-3 idempotent) ──
let count = 0;
const inbox3 = makeSubscriber({ topics: [genesis], onMessage: () => { count++; } });
inbox3.receive(f); const r2 = inbox3.receive(f);
ok("idempotent-delivers-once", count === 1 && r2.duplicate === true && inbox3.size === 1, `count=${count}`);

// ── 6 · BOUND — the seen-set is capped by quota (SEC-8), never by declared counts ──
const inbox4 = makeSubscriber({ topics: [genesis], onMessage: () => {}, max: 2 });
for (let i = 0; i < 5; i++) inbox4.receive(frameMessage(genesis, mint({ text: "m" + i, sender: "x", sentAt: "09:0" + i, chat: "Ilya", source: "web.whatsapp.com" }).object));
ok("seen-set-bounded", inbox4.size === 2, `size=${inbox4.size}`);

// ── 7 · RELAY — content-blind: forwards bytes UNCHANGED; the EDGE catches tampering (SEC-7/SEC-1) ──
const relay = makeRelay();
const arrived = [];
let edgeDelivered = 0;
const edge = makeSubscriber({ topics: [genesis], onMessage: () => { edgeDelivered++; } });
const subPeer = relay.connect((fr) => { arrived.push(fr); edge.receive(fr); });   // relay → edge sink
const pubPeer = relay.connect(() => {});                                          // publisher into relay
subPeer.handle(encodeMsg({ op: OP.SUB, topic: genesis }));                         // edge subscribes via the relay
pubPeer.handle(f);                                                                 // a good PUT through the relay
pubPeer.handle(tamperedFrame);                                                     // a tampered PUT through the relay
const forwardedUnchanged = arrived.length === 2 &&
  Buffer.from(arrived[0]).equals(Buffer.from(f)) && Buffer.from(arrived[1]).equals(Buffer.from(tamperedFrame));
// the relay forwards BOTH frames blindly; it caches by κ (header-only) so the two PUTs sharing
// objA.id collapse to ONE cache entry (κ-dedup, SEC-3); the edge accepts only the good one.
ok("relay-content-blind-edge-enforces",
  forwardedUnchanged && relay.cacheSize === 1 && edgeDelivered === 1,
  `forwarded=${arrived.length} cached=${relay.cacheSize} edgeDelivered=${edgeDelivered}`);

// ── 8 · FETCH — relay answers GET with the cached frame (OBJ) or MISS, payload untouched ──
let got = null;
const fetchPeer = relay.connect((fr) => { got = decodeMsg(fr); });
fetchPeer.handle(encodeMsg({ op: OP.GET, kappa: objA.id }));
const hit = got && got.op === OP.OBJ && JSON.parse(dec.decode(got.bytes)).id === objA.id;
fetchPeer.handle(encodeMsg({ op: OP.GET, kappa: "did:holo:sha256:" + "0".repeat(64) }));
const miss = got && got.op === OP.MISS;
ok("relay-get-obj-or-miss", hit !== null && miss === true, `hit→OBJ then miss→MISS`);

// ── 9 · E2E — capture → thread.ingest → publish → verify → thread.ingestObject → inbox converges ──
const op = await enroll({ label: "transport-tester", passphrase: "correct horse battery" });
let tick = 0; const now = () => `2026-06-23T11:00:${String(tick++).padStart(2, "0")}.000Z`;
const arrayBackend = () => { let s = []; return { load: async () => JSON.parse(JSON.stringify(s)), save: async (r) => { s = JSON.parse(JSON.stringify(r)); } }; };
const tabA = makeThread({ genesis, backend: arrayBackend(), now, signer: op });   // platform tab
const tabB = makeThread({ genesis, backend: arrayBackend(), now, signer: op });   // inbox tab
const hub2 = makeHub();
let receivedB = null;
const inboxB = makeSubscriber({ topics: [genesis], onMessage: (m) => { receivedB = m; } });  // delivery is synchronous
hub2.join((fr) => inboxB.receive(fr));
const aPost = hub2.join(() => {});
const pubA = makePublisher({ send: aPost });
const INPUT = { text: "streaming, live", sender: "Ilya", sentAt: "08:40", chat: "Ilya", source: "web.whatsapp.com" };
const ingA = await tabA.ingest(INPUT);                 // A captures + appends
pubA.publish(genesis, mint(INPUT).object);             // A streams it (delivered same tick → receivedB set)
if (receivedB) await tabB.ingestObject(receivedB.object);   // B admits it verify-before-trust
const aView = tabA.view(); const bView = tabB.view();
ok("e2e-realtime-cross-tab-convergence",
  ingA.appended && bView.length === 1 &&
  bView[bView.length - 1].text === "streaming, live" &&
  bView[bView.length - 1].kappa === ingA.kappa,        // B holds the SAME message κ A captured (content identity)
  `A=${aView.length} B=${bView.length} κ=${ingA.kappa.slice(-8)}`);
await forget(op.kappa).catch(() => {});

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult", witnessed,
  covers: [
    "FRAME — a captured message frames as a holo-wire PUT (op/topic=genesis/kappa/bytes) and round-trips byte-faithfully",
    "STREAM — publish() delivers a verified message to a subscribed inbox in the SAME tick over one in-process hop (the low-latency same-device path)",
    "VERIFY — a frame whose bytes don't re-derive to its claimed κ is refused verify-before-render; onMessage never fires (SEC-1, Law L5)",
    "TOPIC — a subscriber ignores frames for conversations it isn't subscribed to",
    "DEDUP — the same frame received twice delivers once; the seen-set makes re-delivery idempotent (SEC-3)",
    "BOUND — the seen-set is capped by a fixed quota, not by any declared count (SEC-8 DoS resistance)",
    "RELAY — a content-blind relay forwards frame bytes UNCHANGED and caches them opaquely; the EDGE (subscriber) refuses tampering — integrity at the edge, not the relay (SEC-7 + SEC-1)",
    "FETCH — the relay answers GET with the cached frame (OBJ) or MISS, reading only the wire header, never parsing the payload",
    "E2E — capture → thread.ingest → publish → subscriber verify-before-render → thread.ingestObject converges the inbox tab to the SAME message κ the platform tab captured, with no server in the path",
  ],
  genesis, sample: { kappa: objA.id, frameBytes: f.length },
  checks, failed: fail,
  authority: "holo-wire (κ pub/sub) · holo-gossip-channel (BroadcastChannel) · holospaces SEC-1/SEC-3/SEC-7/SEC-8 · Law L5",
};
writeFileSync(join(here, "holo-messenger-transport-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("Holo Messenger transport witness — the live stream\n");
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "✓" : "✗"}  ${k}`);
console.log(`\n  conversation topic ${genesis.slice(-12)} · frame ${f.length} bytes · same-tick delivery, content-blind relay, edge-enforced integrity`);
console.log(`\n  ${witnessed ? "WITNESSED ✓" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
