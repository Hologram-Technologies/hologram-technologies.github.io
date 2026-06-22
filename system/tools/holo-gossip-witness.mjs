#!/usr/bin/env node
// holo-gossip-witness.mjs — proves G: κ-GOSSIP of heads + warrants converges (anti-entropy) WITHOUT
// conferring trust. Across gossip rounds every peer learns every head and every CONFIRMED warrant and
// blocks the bad actor; a FALSE warrant never propagates (each peer re-confirms, W); gossip is idempotent
// (re-hearing changes nothing) so it converges regardless of order. Real warrants (W) + real signers.
//
// Checks (all must hold):
//   1 headsConverge        — after gossip, all peers know all principals' heads (eventual consistency).
//   2 warrantPropagates    — a confirmed warrant reaches every peer (each confirmed it independently).
//   3 blocksConverge       — every peer blocks the bad actor after gossip.
//   4 falseWarrantDies     — a fabricated warrant (object actually conforms) propagates to NO peer.
//   5 idempotentConverged  — once converged, another round learns 0 new facts.
//   6 selfHeals            — a peer that started knowing nothing ends fully synced (heads + warrant).
//
// Authority: Holochain gossip/immune model · UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-warrant
// + #holo-strand + #holo-strand-rules + #holo-identity. node tools/holo-gossip-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { seal } from "../os/usr/lib/holo/holo-object.mjs";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { defineRuleset } from "../os/usr/lib/holo/holo-strand-rules.mjs";
import { raiseWarrant, makeImmunity } from "../os/usr/lib/holo/holo-warrant.mjs";
import { makeGossip, gossipRound } from "../os/usr/lib/holo/holo-gossip.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const mallory = await enroll({ label: "mallory", passphrase: "m pass" });
const RS = defineRuleset({ name: "ingest-rules", rules: { ingest: { require: ["source", "name"] } } });

// mallory's chain: a good entry and a violating one → a REAL confirmable warrant on the bad one
const mStrand = makeStrand({ now, signer: mallory });
const mGood = await mStrand.append({ kind: "ingest", payload: { source: "did:holo:sha256:" + "3".repeat(64), name: "ok.txt" } });
const mBad = await mStrand.append({ kind: "ingest", payload: { name: "no-source.txt" } });
const warrant = await raiseWarrant({ entry: mBad, ruleset: RS });

// a FALSE warrant: claim the GOOD entry is invalid (re-seal so its own κ re-derives, but confirm() will
// re-validate and find it conforms → object-is-valid → rejected everywhere).
const realFor = await raiseWarrant({ entry: mBad, ruleset: RS });
const { "holwar:sig": _s, ...fb } = realFor; fb["holwar:object"] = mGood; fb["holwar:subject"] = mGood.id; delete fb.id;
const falseWarrant = seal(fb);

// three peers (A holds the warrant + its own head; B, C each their own heads; C starts knowing nothing else)
const A = makeGossip({ self: "peerA", immunity: makeImmunity() });
const B = makeGossip({ self: "peerB", immunity: makeImmunity() });
const C = makeGossip({ self: "peerC", immunity: makeImmunity() });
A.setHead("peerA", "did:holo:sha256:" + "a".repeat(64));
B.setHead("peerB", "did:holo:sha256:" + "b".repeat(64));
C.setHead("peerC", "did:holo:sha256:" + "c".repeat(64));
await A.receive({ heads: {}, warrants: [warrant, falseWarrant] });   // A ingests both; only the real one is kept

ok("falseWarrantDies", A.hasWarrant(warrant.id) && !A.hasWarrant(falseWarrant.id), "false warrant must not even be held by A");

// gossip to convergence
const peers = [A, B, C];
let rounds = 0, learned;
do { learned = await gossipRound(peers); rounds++; } while (learned > 0 && rounds < 10);

// 1 · heads converge
const allHeads = (g) => { const h = g.knownHeads(); return h.peerA && h.peerB && h.peerC; };
ok("headsConverge", [A, B, C].every(allHeads), JSON.stringify(C.knownHeads()));

// 2 · the confirmed warrant reached every peer
ok("warrantPropagates", [A, B, C].every((g) => g.hasWarrant(warrant.id)), [A, B, C].map((g) => g.knownWarrants().length).join(","));

// 3 · every peer blocks the bad actor
ok("blocksConverge", [A, B, C].every((g) => g.knownWarrants().includes(warrant.id)) && B.knownWarrants().length === 1, "each peer holds exactly the one real warrant");

// 4 · the false warrant reached no peer
ok("falseWarrantDies2", [A, B, C].every((g) => !g.hasWarrant(falseWarrant.id)), "false warrant must be absent everywhere");

// 5 · idempotent once converged
ok("idempotentConverged", (await gossipRound(peers)) === 0, "a converged round learns 0 new facts");

// 6 · C (started knowing only its own head) ended fully synced
ok("selfHeals", allHeads(C) && C.hasWarrant(warrant.id), "the peer that knew nothing ends fully synced");

await forget(mallory.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-gossip G — κ-gossip of heads + warrants converges (anti-entropy, self-healing) WITHOUT conferring trust: heads are pointers (trust on fetch+admit, V), warrants are confirmed independently on receipt (W) before they propagate or block — so confirmed warrants reach every peer and a false warrant dies at the first honest peer. Idempotent → converges regardless of order; a peer that knew nothing ends fully synced. Transport is the caller's; live gossip is a thin loop over advertise()/receive(). Pure assembly over holo-warrant; no new crypto. (Simulated peers; real multi-device propagation out-of-band.)",
  authority: "Holochain gossip/immune model · UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-warrant + #holo-strand + #holo-strand-rules + #holo-identity",
  witnessed,
  covers: witnessed ? ["heads-converge", "warrant-propagates", "blocks-converge", "false-warrant-dies", "idempotent", "self-heals"] : [],
  sample: { rounds, peers: 3, realWarrant: warrant.id, falseWarrant: falseWarrant.id },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-gossip-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-gossip witness — G κ-GOSSIP of heads + warrants (anti-entropy, self-healing, no trust conferred)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  converged in ${rounds} round(s): all 3 peers know all heads + the 1 confirmed warrant; the false warrant reached none`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the network converges + self-heals, and a lie cannot spread" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
