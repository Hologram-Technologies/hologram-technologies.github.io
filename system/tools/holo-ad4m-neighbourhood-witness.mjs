#!/usr/bin/env node
// holo-ad4m-neighbourhood-witness.mjs — AD4M's NEIGHBOURHOOD on κ: a shared Perspective many agents read and
// write with NO server. Each agent keeps their own signed strand; the Neighbourhood is the VERIFIED UNION.
// Two real enrolled agents talk over a loopback channel (models a BroadcastChannel / RTCDataChannel): they
// converge, a tampered chain is refused, a forged-author chain is refused, and a stale copy can't override.
//
// Authority: AD4M Neighbourhood / LinkLanguage / perspective-diff-sync (docs.ad4m.dev) · holospaces Law L5
// (verify-before-adopt over the sequence) · mirrors holo-zone-net. node tools/holo-ad4m-neighbourhood-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeAd4m } from "../os/usr/lib/holo/holo-ad4m.mjs";
import { makeNeighbourhood, verifyAuthoredChain } from "../os/usr/lib/holo/holo-ad4m-neighbourhood.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const clone = (x) => JSON.parse(JSON.stringify(x));
const arrayBackend = (init = []) => { let s = clone(init); return { load: async () => clone(s), save: async (r) => { s = clone(r); }, dump: () => clone(s) }; };
let tick = 0; const now = () => `2026-06-25T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// a loopback hub: post(msg) delivers to every OTHER attached peer's async onMessage (models a channel);
// settle() awaits the in-flight verify-before-adopt work (verifyAuthoredChain uses real WebCrypto).
const hub = {
  peers: [], inflight: [],
  post(from, msg) { for (const p of this.peers) if (p.self !== from) this.inflight.push(Promise.resolve(p.onMessage(msg))); },
  async settle() { const f = this.inflight; this.inflight = []; await Promise.all(f); },
};

// two real agents, each with their own Perspective + Neighbourhood handle on the shared hub
const alice = await enroll({ label: "nb-alice", passphrase: "alice sovereign" });
const bob = await enroll({ label: "nb-bob", passphrase: "bob sovereign" });
const aAd4m = makeAd4m({ signer: alice, now });
const bAd4m = makeAd4m({ signer: bob, now });
const aPersp = aAd4m.perspective({ backend: arrayBackend() });
const bPersp = bAd4m.perspective({ backend: arrayBackend() });
const aNb = makeNeighbourhood({ perspective: aPersp, me: alice.kappa, self: "A", post: (m) => hub.post("A", m) });
const bNb = makeNeighbourhood({ perspective: bPersp, me: bob.kappa, self: "B", post: (m) => hub.post("B", m) });
hub.peers.push({ self: "A", onMessage: aNb.onMessage }, { self: "B", onMessage: bNb.onMessage });

// ── 1 · Alice adds a Link, publishes ⇒ Bob's shared graph contains it ────────────────────────────────
await aNb.addLink({ source: alice.kappa, predicate: "shares", target: "expr:sunset-photo" });
aNb.publish();
  await hub.settle();
ok("aToBConverges", bNb.sharedLinks().some((l) => l.target === "expr:sunset-photo" && l.author === alice.kappa),
  JSON.stringify(bNb.sharedLinks().map((l) => l.predicate)));

// ── 2 · Bob adds a Link, publishes ⇒ Alice sees it (bidirectional) ──────────────────────────────────
await bNb.addLink({ source: bob.kappa, predicate: "replies", target: "expr:sunset-photo" });
bNb.publish();
  await hub.settle();
ok("bToAConverges", aNb.sharedLinks().some((l) => l.predicate === "replies" && l.author === bob.kappa),
  JSON.stringify(aNb.sharedLinks().map((l) => l.predicate)));

// ── 3 · members() lists both agents on each side ─────────────────────────────────────────────────────
ok("membersListed", aNb.members().includes(alice.kappa) && aNb.members().includes(bob.kappa) && aNb.members().length === 2, JSON.stringify(aNb.members().map((m) => m.slice(-6))));

// ── 4 · the merged graph holds BOTH contributions ───────────────────────────────────────────────────
ok("unionGraph", aNb.sharedLinks().length === 2 && bNb.sharedLinks().length === 2, `a=${aNb.sharedLinks().length} b=${bNb.sharedLinks().length}`);

// ── 5 · a TAMPERED inbound chain is refused on adopt (Law L5) ────────────────────────────────────────
const aEntries = clone(aPersp.raw.replay({}));
aEntries[0]["holstr:payload"].target = "expr:hijacked";              // mutate content → id no longer re-derives
const vTamper = await verifyAuthoredChain(aEntries, alice.kappa);
const freshBob = makeNeighbourhood({ perspective: bAd4m.perspective({ backend: arrayBackend() }), me: bob.kappa, self: "B2" });
await freshBob.onMessage({ t: "ad4m:links", author: alice.kappa, entries: aEntries, from: "evil" });
ok("tamperedInboundRefused", vTamper.ok === false && !freshBob.members().includes(alice.kappa), JSON.stringify(vTamper));

// ── 6 · a FORGED-AUTHOR chain is refused (Eve serves Alice's real chain under Bob's name) ────────────
const honestAlice = clone(aPersp.raw.replay({}));
const vForge = await verifyAuthoredChain(honestAlice, bob.kappa);     // claim author = Bob over Alice-signed entries
ok("forgedAuthorRefused", vForge.ok === false && vForge.why === "author-mismatch", JSON.stringify(vForge));

// ── 7 · a STALE (shorter) copy can never override a newer (longer) one ───────────────────────────────
await aNb.addLink({ source: alice.kappa, predicate: "edits", target: "expr:sunset-photo" }); // Alice now has 2 entries
aNb.publish();
  await hub.settle();                                                        // Bob adopts the length-2 chain
const stale = clone(aPersp.raw.replay({})).slice(0, 1);              // a length-1 stale snapshot
await bNb.onMessage({ t: "ad4m:links", author: alice.kappa, entries: stale, from: "stale-peer" });
const aliceLinksOnBob = bNb.sharedLinks().filter((l) => l.author === alice.kappa);
ok("staleDoesNotOverride", aliceLinksOnBob.length === 2, `bob holds ${aliceLinksOnBob.length} of Alice's links (newest wins)`);

// ── 8 · durability: the merged view survives a fresh Neighbourhood over the same local backend ───────
const persisted = aPersp.raw.replay({});
const aPersp2 = aAd4m.perspective({ backend: arrayBackend(persisted) });
await aPersp2.ready();
const aNb2 = makeNeighbourhood({ perspective: aPersp2, me: alice.kappa, self: "A3" });
const vDur = await aPersp2.verify();
ok("durableLocal", vDur.ok && aNb2.sharedLinks().filter((l) => l.author === alice.kappa).length === 2, JSON.stringify({ v: vDur.ok }));

await forget(alice.kappa); await forget(bob.kappa);

const n = Object.keys(checks).length;
const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-ad4m-neighbourhood — AD4M's Neighbourhood as a serverless shared Perspective: each agent keeps their own signed holo-strand; the Neighbourhood is the verified UNION across members. The want/have merge mirrors holo-zone-net — adopt only chains that re-derive end-to-end AND are signed by the claimed author (Law L5 + authorship), longest-valid-per-author wins. No server, no consensus, no DHT.",
  authority: "AD4M Neighbourhood / LinkLanguage / perspective-diff-sync (docs.ad4m.dev) · holospaces Law L5 · mirrors #holo-zone-net · rests on #holo-strand + #holo-ad4m",
  witnessed,
  checks, failed: fail,
};
writeFileSync(join(here, "holo-ad4m-neighbourhood-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-ad4m NEIGHBOURHOOD witness — a serverless shared Perspective (verified union of agents)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? `WITNESSED ✓  ${n}/${n} GREEN` : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
