#!/usr/bin/env node
// holo-parity-integration-witness.mjs — the END-TO-END multi-agent scenario: every parity phase composed
// into one realistic flow on the κ substrate. A membrane (M) gates who joins; members author signed
// source-chain entries; honest data is sharded across peers (D) and admitted on receipt by re-validation
// (V); a bad actor's violating entry is warranted (W), the warrant gossips and converges (G) so the actor
// is ejected network-wide; a false warrant never spreads; honest data keeps flowing. This proves the
// phases INTEROPERATE — the whole "BitTorrent + Git + signatures + immune system" on κ, no server.
//
// Checks (all must hold):
//   1 membraneGates        — an invited candidate joins; a stranger without an invite is refused (M).
//   2 honestDataAdmits     — a member's signed, conforming entry admits under the membrane ruleset (V).
//   3 shardedFetchVerifies — that entry, sharded across peers (D), is fetched by a non-holder + verified.
//   4 badEntryWarranted    — a member's violating entry yields a confirmable warrant (W).
//   5 immuneConverges      — gossip spreads the warrant to all peers; the false warrant reaches none (G).
//   6 actorEjectedOnReceipt— after convergence, the bad actor's entries are refused on receipt everywhere (V∘W).
//   7 honestKeepsFlowing   — the honest member is unaffected; their data still admits.
//
// Authority: Holochain full model · UOR-ADDR · holospaces Laws L1/L2/L5 + SEC-4 · composes
// #holo-membrane + #holo-strand(+rules) + #holo-shard + #holo-warrant + #holo-strand-admit + #holo-gossip
// + #holo-identity. node tools/holo-parity-integration-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join as pjoin } from "node:path";
import { jcs, sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";
import { seal } from "../os/usr/lib/holo/holo-object.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { defineRuleset } from "../os/usr/lib/holo/holo-strand-rules.mjs";
import { defineMembrane, issueInvite, evaluateJoin } from "../os/usr/lib/holo/holo-membrane.mjs";
import { makeShardedStore, shardFor } from "../os/usr/lib/holo/holo-shard.mjs";
import { raiseWarrant, makeImmunity } from "../os/usr/lib/holo/holo-warrant.mjs";
import { admit } from "../os/usr/lib/holo/holo-strand-admit.mjs";
import { makeGossip, gossipRound } from "../os/usr/lib/holo/holo-gossip.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const kOf = (b) => "did:holo:sha256:" + sha256hex(b);
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

// ── principals: the space operator, an honest member (alice), a bad actor (mallory), a stranger ──
const operator = await enroll({ label: "operator", passphrase: "op" });
const alice = await enroll({ label: "alice", passphrase: "al" });
const mallory = await enroll({ label: "mallory", passphrase: "ml" });
const stranger = await enroll({ label: "stranger", passphrase: "st" });

// ── the app: a membrane (invite-join) whose ruleset requires ingest entries to carry `source` ──
const RS = defineRuleset({ name: "space-rules", rules: { ingest: { require: ["source", "name"] } } });
const membrane = defineMembrane({ app: "studio", operator: operator.kappa, rulesetKappa: RS.id, join: { type: "invite" } });

// ── 1 · membrane gates entry ─────────────────────────────────────────────────────────────────────────
const inviteAlice = await issueInvite(membrane.id, alice.kappa, operator);
const joinAlice = await evaluateJoin(membrane, { candidate: alice.kappa, invite: inviteAlice });
const joinStranger = await evaluateJoin(membrane, { candidate: stranger.kappa });   // no invite
ok("membraneGates", joinAlice.admitted === true && joinStranger.admitted === false, JSON.stringify({ alice: joinAlice.admitted, stranger: joinStranger.admitted }));

// ── members author signed source-chain entries ──────────────────────────────────────────────────────
const aStrand = makeStrand({ now, signer: alice });
const aEntry = await aStrand.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "1".repeat(64), name: "alice-notes.txt" } });
const mStrand = makeStrand({ now, signer: mallory });
const mBad = await mStrand.append({ kind: "ingest", payload: { name: "mallory-no-source.txt" } });   // violates RS

// ── 2 · honest data admits under the membrane ruleset (V) ────────────────────────────────────────────
const sharedImmunity = makeImmunity();
const admitAlice = await admit(aEntry, { ruleset: RS, immunity: sharedImmunity });
ok("honestDataAdmits", admitAlice.ok === true && admitAlice.actor === alice.kappa, JSON.stringify(admitAlice));

// ── 3 · alice's entry sharded across peers (D), fetched by a non-holder + verified ───────────────────
const PEERS = Array.from({ length: 5 }, (_, i) => "did:holo:sha256:" + String(i + 1).repeat(64));
const stores = Object.fromEntries(PEERS.map((p) => [p, new Map()]));
const fetchPeer = async (peer, k) => stores[peer].get(k) || null;
const bytes = enc(jcs(aEntry)); const K = kOf(bytes);
const place = await shardFor(K, PEERS, { replicas: 3 });
for (const h of place.holders) stores[h].set(K, bytes);                 // holders carry it
const nonHolder = PEERS.find((p) => !place.holders.includes(p));
const store = makeShardedStore({ self: nonHolder, peers: () => PEERS, replicas: 3, local: { get: async () => null, put: async () => {} }, fetchPeer, kappaOf: kOf });
const got = await store.get(K);
const refetchedEntry = got ? JSON.parse(new TextDecoder().decode(got)) : null;
const admitRefetched = refetchedEntry ? await admit(refetchedEntry, { ruleset: RS, immunity: sharedImmunity }) : { ok: false };
ok("shardedFetchVerifies", !!got && refetchedEntry && refetchedEntry.id === aEntry.id && admitRefetched.ok === true, "fetched κ-verified entry must still admit");

// ── 4 · the bad entry is warrantable (W) ─────────────────────────────────────────────────────────────
const warrant = await raiseWarrant({ entry: mBad, ruleset: RS });
const realFor = await raiseWarrant({ entry: mBad, ruleset: RS });
const { "holwar:sig": _s, ...fb } = realFor; fb["holwar:object"] = aEntry; fb["holwar:subject"] = aEntry.id; delete fb.id;
const falseWarrant = seal(fb);                                          // accuses alice's VALID entry → must die
ok("badEntryWarranted", !!warrant && warrant["holwar:subject"] === mBad.id, "a violating entry must yield a warrant");

// ── 5 · gossip converges the warrant; the false one spreads to no one (G) ────────────────────────────
const A = makeGossip({ self: "A", immunity: makeImmunity() });
const B = makeGossip({ self: "B", immunity: makeImmunity() });
const C = makeGossip({ self: "C", immunity: sharedImmunity });          // C shares the immunity the receive gate uses
A.setHead(alice.kappa, aStrand.head()); B.setHead(mallory.kappa, mStrand.head());
await A.receive({ heads: {}, warrants: [warrant, falseWarrant] });
let rounds = 0, learned; do { learned = await gossipRound([A, B, C]); rounds++; } while (learned > 0 && rounds < 10);
ok("immuneConverges",
  [A, B, C].every((g) => g.hasWarrant(warrant.id)) && [A, B, C].every((g) => !g.hasWarrant(falseWarrant.id)),
  `rounds=${rounds}`);

// ── 6 · the bad actor is ejected on receipt EVERYWHERE — even an otherwise-valid mallory entry refused ─
const mGoodLooking = await mStrand.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "9".repeat(64), name: "m-ok.txt" } });
const admitMallory = await admit(mGoodLooking, { ruleset: RS, immunity: sharedImmunity });   // sharedImmunity now blocks mallory (via C)
ok("actorEjectedOnReceipt", admitMallory.ok === false && admitMallory.stage === "immune" && admitMallory.actor === mallory.kappa, JSON.stringify(admitMallory));

// ── 7 · honest data keeps flowing (alice unaffected) ─────────────────────────────────────────────────
const aEntry2 = await aStrand.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "2".repeat(64), name: "alice-2.txt" } });
const admitAlice2 = await admit(aEntry2, { ruleset: RS, immunity: sharedImmunity });
ok("honestKeepsFlowing", admitAlice2.ok === true, JSON.stringify(admitAlice2));

await forget(operator.kappa); await forget(alice.kappa); await forget(mallory.kappa); await forget(stranger.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-parity INTEGRATION — the full multi-agent flow composed end-to-end on κ: a membrane (M) gates entry; members author signed source-chain entries; honest data is sharded (D) and admitted on receipt by re-validation (V); a bad actor's violating entry is warranted (W), the warrant gossips + converges (G) and a false warrant dies, so the actor is ejected network-wide on receipt (V∘W) while honest data keeps flowing. Proves the phases interoperate — Holochain's whole model on the κ substrate, no server, no new crypto.",
  authority: "Holochain full model · UOR-ADDR · holospaces Laws L1/L2/L5 + SEC-4 · composes #holo-membrane + #holo-strand(+rules) + #holo-shard + #holo-warrant + #holo-strand-admit + #holo-gossip + #holo-identity",
  witnessed,
  covers: witnessed ? ["membrane-gate", "honest-admits", "sharded-fetch-verifies", "bad-warranted", "immune-converges", "actor-ejected", "honest-keeps-flowing"] : [],
  sample: { membrane: membrane.id, ruleset: RS.id, gossipRounds: rounds, shardHolders: place.holders.length },
  checks, failed: fail,
};
writeFileSync(pjoin(here, "holo-parity-integration-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-parity INTEGRATION witness — the full multi-agent flow on κ (membrane → author → shard → admit → warrant → gossip → eject)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  gated entry · sharded+verified data · bad actor ejected network-wide · honest flow intact" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
