#!/usr/bin/env node
// holo-zone-net-witness.mjs — proves RESOLVE OTHER PEOPLE'S NAMES, VERIFY-BEFORE-TRUST (holo-zone-net). A peer
// fetches another owner's zone over a dumb, untrusted transport and resolves a name they own — adopting the
// signed strand entries ONLY if they re-derive end-to-end AND are signed by exactly that owner κ (Law L5). A
// tampered chain in flight or a peer serving a foreign owner's chain is refused. This is the seam holo-root's
// openZone plugs into so anyone's names resolve through the one door. Cached zones are re-served (self-healing).
//
// Drives the REAL substrate over a loopback hub (separate peers, real signed holo-strand zones, real enrolled
// holo-identity owners). The browser binding is the same shape over BroadcastChannel (separate tabs/devices).
//
// Checks: 1 remoteOpenZone · 2 crossOwnerNameThroughRoot · 3 signedAuthorshipPreserved · 4 localFirst ·
//   5 cached · 6 missTimeoutNull · 7 tamperInFlightRefused · 8 foreignOwnerRefused · 9 freshDeviceGetsLatest ·
//   10 oneDoorGossipFed · 11 channelAdapterResolves · 12 channelThroughRoot · 13 channelTamperRefused ·
//   14 channelGarbageIgnored  (11–14 = the attachChannel adapter over the RTCDataChannel send/onmessage contract)
// Authority: UOR-ADDR · holospaces Laws L1/L2/L3/L5 · rests on #holo-zone (adopt/verifyZone) + #holo-identity.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeZoneNet, attachChannel } from "../os/usr/lib/holo/holo-zone-net.mjs";
import { makeZone, normTarget } from "../os/usr/lib/holo/holo-zone.mjs";
import { makeRoot } from "../os/sbin/holo-root.mjs";
import { resolveUnified } from "../os/sbin/holo-omni-unified.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); } }; };
let tick = 0; const now = () => `2026-06-23T00:04:${String(tick++).padStart(2, "0")}.000Z`;
const hexOf = (k) => k.split(":").pop();

const kX = "a1".repeat(32), kY = "b2".repeat(32), kZ = "c3".repeat(32);
const tY = normTarget(kY), tZ = normTarget(kZ);

// a loopback hub: post broadcasts a (optionally transformed) message to every OTHER peer's onMessage.
function makeHub({ transform = (m) => m } = {}) {
  const peers = [];
  return {
    join(self, openLocal) {
      const net = makeZoneNet({ self, openLocal, timeoutMs: 300, post: (m) => { const mm = transform(m); for (const p of peers) if (p.self !== self) p.net.onMessage(mm); } });
      peers.push({ self, net });
      return net;
    },
  };
}
const tamper = (entries) => { const e = clone(entries); const i = e.findIndex((x) => x["holstr:kind"] === "zone.bind"); if (i >= 0) e[i]["holstr:payload"].target = normTarget("dead".padEnd(64, "0")); return e; };

// owner A hosts a zone with a mutable name
const ownerA = await enroll({ label: "zonenet-A", passphrase: "alpha one two three" });
const hexA = hexOf(ownerA.kappa);
const zoneA = makeZone({ owner: ownerA, backend: arrayBackend(), now });
await zoneA.bind("ilya.deck", kX);
await zoneA.bind("ilya.deck", kY);                                // latest = kY

// ── honest hub: A serves its zone, B hosts nothing ──────────────────────────────────────────────────
const hub = makeHub();
const netA = hub.join("A", async (hex) => (hex === hexA ? zoneA : null));
const netB = hub.join("B", async () => null);

// 1 · B fetches A's zone over the net and resolves A's name
const zB = await netB.openZone(hexA);
const gB = zB ? await zB.resolve("ilya.deck") : { ok: false };
ok("remoteOpenZone", !!zB && gB.ok && gB.target === tY, JSON.stringify({ got: !!zB, target: gB.target }));

// 2 · B's holo-root resolves A's NAME without hosting it
const rootB = makeRoot({ openZone: netB.openZone });
const rr = await rootB.resolveName("holo://zone/" + hexA + "/ilya.deck");
ok("crossOwnerNameThroughRoot", rr.ok && rr.kappa === tY, JSON.stringify({ ok: rr.ok, kappa: rr.kappa === tY }));

// 3 · the adopted entries still carry A's operator signature (B verified authorship)
ok("signedAuthorshipPreserved", zB.entries().every((e) => e["holstr:op"] === ownerA.kappa && e["holstr:sig"]), "every entry signed by owner A");

// 4 · a node serves its OWN zone instantly (local before net)
ok("localFirst", (await netA.openZone(hexA)) === zoneA, "openLocal short-circuits the net");

// 5 · the fetched zone is cached (self-healing — B can now serve it onward)
ok("cached", netB.cache.has(hexA) === true, "verified zone cached after fetch");

// 6 · a name nobody hosts fails closed (timeout → null)
const miss = await netB.openZone("0".repeat(64));
ok("missTimeoutNull", miss === null, JSON.stringify({ miss }));

// 7 · a chain TAMPERED in flight is refused (verify-before-adopt) ────────────────────────────────────
const hubT = makeHub({ transform: (m) => (m.t === "have" ? { ...m, entries: tamper(m.entries) } : m) });
hubT.join("At", async (hex) => (hex === hexA ? zoneA : null));
const netBt = hubT.join("Bt", async () => null);
const zBt = await netBt.openZone(hexA);
ok("tamperInFlightRefused", zBt === null, JSON.stringify({ got: zBt }));

// 8 · a peer serving a FOREIGN owner's chain (claiming to be A) is refused ───────────────────────────
const ownerC = await enroll({ label: "zonenet-C-impostor", passphrase: "charlie nine eight" });
const zoneC = makeZone({ owner: ownerC, backend: arrayBackend(), now });
await zoneC.bind("ilya.deck", kZ);
const hubF = makeHub();
hubF.join("Cliar", async () => zoneC);                           // lies: answers ANY want with its OWN zone
const netBf = hubF.join("Bf", async () => null);
const zBf = await netBf.openZone(hexA);                          // asks for A, gets C-signed → must refuse
ok("foreignOwnerRefused", zBf === null, JSON.stringify({ got: zBf }));

// 9 · a FRESH device gets A's LATEST binding after A mutates ─────────────────────────────────────────
await zoneA.bind("ilya.deck", kZ);                               // A re-binds → kZ
const netD = hub.join("D", async () => null);
const zD = await netD.openZone(hexA);
const gD = zD ? await zD.resolve("ilya.deck") : { ok: false };
ok("freshDeviceGetsLatest", gD.ok && gD.target === tZ, JSON.stringify({ target: gD.target }));

// 10 · the ONE door, gossip-fed: resolveUnified routes a foreign-owned name via the net ──────────────
const u = await resolveUnified("holo://zone/" + hexA + "/ilya.deck", { openZone: netD.openZone });
ok("oneDoorGossipFed", u.ok && u.lane === "zone" && u.kappa === tZ, JSON.stringify({ lane: u.lane, kappa: u.kappa === tZ }));

// ── 11–14 · the CHANNEL ADAPTER (attachChannel) over the RTCDataChannel send/onmessage contract ──────
// a loopback pair of objects implementing exactly { send(str), addEventListener("message", fn→{data}) } —
// the RTCDataChannel contract. `tamper` corrupts any "have" frame travelling A→B (a lying transport).
function channelPair({ tamperHave = false } = {}) {
  const mk = () => { const ls = []; return { _ls: ls, addEventListener: (t, fn) => { if (t === "message") ls.push(fn); } }; };
  const a = mk(), b = mk();
  const deliver = (ls, s) => queueMicrotask(() => ls.forEach((fn) => fn({ data: s })));
  a.send = (s) => { if (tamperHave) { try { const m = JSON.parse(s); if (m && m.t === "have") { m.entries = tamper(m.entries); s = JSON.stringify(m); } } catch (e) {} } deliver(b._ls, s); };
  b.send = (s) => deliver(a._ls, s);
  return [a, b];
}

// 11 · cross-owner resolution over the channel adapter (zoneA is at kZ now)
{
  const [ca, cb] = channelPair();
  attachChannel(async (h) => (h === hexA ? zoneA : null), ca, { self: "ChA", timeoutMs: 300 });
  const B = attachChannel(async () => null, cb, { self: "ChB", timeoutMs: 300 });
  const z = await B.openZone(hexA); const g = z ? await z.resolve("ilya.deck") : { ok: false };
  ok("channelAdapterResolves", !!z && g.ok && g.target === tZ, JSON.stringify({ got: !!z, target: g.target }));
  // 12 · through holo-root over the adapter
  const r = makeRoot({ openZone: B.openZone });
  const rr = await r.resolveName("holo://zone/" + hexA + "/ilya.deck");
  ok("channelThroughRoot", rr.ok && rr.kappa === tZ, JSON.stringify({ ok: rr.ok, kappa: rr.kappa === tZ }));
}
// 13 · a lying transport (tampered have frames) is refused
{
  const [ca, cb] = channelPair({ tamperHave: true });
  attachChannel(async (h) => (h === hexA ? zoneA : null), ca, { self: "ChAt", timeoutMs: 300 });
  const B = attachChannel(async () => null, cb, { self: "ChBt", timeoutMs: 300 });
  const z = await B.openZone(hexA);
  ok("channelTamperRefused", z === null, JSON.stringify({ got: z }));
}
// 14 · garbage frames are ignored (no crash), valid traffic still resolves
{
  const [ca, cb] = channelPair();
  attachChannel(async (h) => (h === hexA ? zoneA : null), ca, { self: "ChAg", timeoutMs: 300 });
  const B = attachChannel(async () => null, cb, { self: "ChBg", timeoutMs: 300 });
  ca.send("} not json {"); cb.send(" garbage");                 // junk on the wire
  const z = await B.openZone(hexA); const g = z ? await z.resolve("ilya.deck") : { ok: false };
  ok("channelGarbageIgnored", !!z && g.ok && g.target === tZ, JSON.stringify({ resolvedDespiteJunk: !!z }));
}

await forget(ownerA.kappa); await forget(ownerC.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-zone-net — RESOLVE OTHER PEOPLE'S NAMES, VERIFY-BEFORE-TRUST: a peer fetches another owner's zone over a dumb untrusted transport and resolves a name they own, adopting the signed strand entries only if they re-derive end-to-end and are signed by exactly that owner κ (Law L5). Tampered-in-flight and foreign-owner chains are refused; the answer is the math, not the messenger. Cached zones are re-served (self-healing). This is the seam holo-root's openZone plugs into so anyone's names resolve through the one door. Loopback hub here; BroadcastChannel/WebRTC is the same shape behind the same seam.",
  authority: "UOR-ADDR (κ = H(canonical_form)) · holospaces Laws L1/L2/L3/L5 · rests on #holo-zone (adopt/verifyZone) + #holo-identity + #holo-strand",
  witnessed,
  covers: witnessed ? ["remote-open-zone", "cross-owner-name", "signed-authorship", "local-first", "cache-heal", "miss-fail-closed", "tamper-in-flight-refused", "foreign-owner-refused", "fresh-device-latest", "one-door-gossip-fed"] : [],
  sample: { ownerA: ownerA.kappa, name: "holo://zone/" + hexA + "/ilya.deck", latest: tZ },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-zone-net-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-zone-net witness — resolve other people's names, verify-before-trust (the answer is the math, not the messenger)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  B fetched A's zone over the net → ${tY.slice(0, 24)}…  ·  fresh device got latest → ${tZ.slice(0, 24)}…`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  anyone's names resolve cross-device, and a lying messenger is refused" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
