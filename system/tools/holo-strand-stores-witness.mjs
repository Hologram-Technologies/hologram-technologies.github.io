#!/usr/bin/env node
// holo-strand-stores-witness.mjs — proves P5: OLD STORES BECOME PROJECTIONS OF THE ONE SPINE. A real
// store (holo-memory) runs unmodified on a strandBackend, so its persistence rides the source chain; a
// fresh store over the same spine recovers its state (projection survives "reload"); two stores coexist
// on one spine; and projectStores reconstructs every store's state from the chain alone. Drives the REAL
// holo-memory + holo-strand + a real enrolled signer.
//
// Checks:
//   1 storeRunsOnSpine     — makeMemory({backend: strandBackend(...)}): remember() persists as `store.memory` entries.
//   2 projectionSurvives   — a FRESH memory over the same spine recovers the remembered records (reload proof).
//   3 dataIsOnTheChain     — the strand verifies; the store snapshots are signed, tamper-evident entries.
//   4 manyStoresOneSpine   — a second store (ns "session") coexists; projectStores returns both, anchored to head.
//
// Authority: UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-memory + #holo-strand + #holo-identity.
// node tools/holo-strand-stores-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { makeStrand } from "../os/usr/lib/holo/holo-strand.mjs";
import { makeMemory } from "../os/usr/lib/holo/holo-memory.mjs";
import { strandBackend, projectStores } from "../os/usr/lib/holo/holo-strand-stores.mjs";
import { enroll, forget } from "../os/usr/lib/holo/holo-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
let tick = 0; const now = () => `2026-06-22T00:00:${String(tick++).padStart(2, "0")}.000Z`;

const op = await enroll({ label: "stores-tester", passphrase: "correct horse battery stores" });
const strand = makeStrand({ now, signer: op });

// 1 · a real store (holo-memory) runs on the strand backend
const mem = makeMemory({ backend: strandBackend(strand, "memory"), now });
await mem.ready();
await mem.remember({ kind: "intent", text: "open the wallet" });
await mem.remember({ kind: "feedback", text: "great answer", vote: "up" });
await mem.remember({ kind: "intent", text: "summarize my notes" });
const snaps = strand.replay({ kind: "store.memory" });
ok("storeRunsOnSpine", snaps.length === 3 && snaps[2]["holstr:payload"].n === 3, `snapshots=${snaps.length}`);

// 2 · a FRESH memory over the SAME spine recovers the records (projection survives reload)
const mem2 = makeMemory({ backend: strandBackend(strand, "memory"), now });
await mem2.ready();
const sum = mem2.summary();
ok("projectionSurvives", sum.total === 3 && sum.intents === 2 && sum.feedback.up === 1, JSON.stringify(sum));

// 3 · the store data lives on the tamper-evident, signed chain
const v = await strand.verify();
ok("dataIsOnTheChain", v.ok && snaps.every((e) => e["holstr:sig"] && e["holstr:op"] === op.kappa), JSON.stringify({ chain: v.ok }));

// 4 · a second store coexists on the one spine; projectStores reconstructs both from the chain alone
const sess = makeMemory({ backend: strandBackend(strand, "session"), now });
await sess.ready();
await sess.remember({ kind: "artifact", text: "tabs:home,wallet" });
const proj = projectStores(strand);
ok("manyStoresOneSpine",
  proj.stores.memory && proj.stores.memory.n === 3 && proj.stores.session && proj.stores.session.n === 1
  && /^did:holo:sha256:[0-9a-f]{64}$/.test(proj.head),
  JSON.stringify({ memory: proj.stores.memory && proj.stores.memory.n, session: proj.stores.session && proj.stores.session.n }));

await forget(op.kappa);

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-strand P5 — OLD STORES BECOME PROJECTIONS OF THE ONE SPINE: strandBackend gives the {load,save} contract the old stores already accept, but persists THROUGH the source chain (`store.<ns>` snapshot entries). A real holo-memory runs unmodified on it; a fresh store over the same spine recovers its state (reload proof); many stores coexist on one spine; projectStores reconstructs every store's state from the chain alone — the proof that the spine is a sufficient single backend (precondition for retiring the separate stores). Drop-in, reversible, projection-only.",
  authority: "UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-memory + #holo-strand + #holo-identity",
  witnessed,
  covers: witnessed ? ["store-on-spine", "projection-survives-reload", "data-on-chain", "many-stores-one-spine"] : [],
  sample: { stores: projectStores(strand).stores, head: strand.head() },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-strand-stores-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-strand witness — P5 OLD STORES → PROJECTIONS OF THE ONE SPINE\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  one spine backs: ${Object.keys(projectStores(strand).stores).join(", ")} (memory recovered ${mem2.summary().total} records after reload)`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  the dozen backends collapse to one re-derivable spine" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
