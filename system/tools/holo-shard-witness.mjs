#!/usr/bin/env node
// holo-shard-witness.mjs — proves D: the CONTENT-ADDRESSED SHARED SPACE (sharded κ-store). For a content
// κ, the responsible peers are the R smallest-ticket peers under the κ-VRF seeded by that κ — deterministic,
// verifiable, redundant (not full replication). Reads VERIFY-ON-RECEIPT: fetched bytes must re-derive to
// the κ or they're refused. Drives the real holo-swarm VRF + holo-uor addressing with simulated peers
// (real transport is phase G, behind the injected fetchPeer seam).
//
// Checks (all must hold):
//   1 placementDeterministic — shardFor returns the same holders regardless of peer-list order; tickets re-derive.
//   2 redundantNotFull       — exactly R holders for a κ (R < #peers): redundancy without everyone storing it.
//   3 distributesAcrossKs    — different content κs map to different holder sets (load spreads).
//   4 putStoresOnHolders     — put() stores locally only on responsible holders, not on non-holders.
//   5 getFetchesAndVerifies  — a non-holder get() fetches from a holder, verifies-on-receipt, and caches.
//   6 tamperedFetchRefused   — a holder serving wrong/tampered bytes is rejected (Law L5 on the wire).
//
// Authority: Holochain DHT/sharding model · UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-swarm
// (κ-VRF) + #holo-uor. node tools/holo-shard-witness.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { shardFor, isResponsible, makeShardedStore } from "../os/usr/lib/holo/holo-shard.mjs";
import { ticket } from "../os/usr/lib/holo/holo-swarm.mjs";
import { sha256hex } from "../os/usr/lib/holo/holo-uor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const checks = {}; const fail = [];
const ok = (n, c, d = "") => { checks[n] = !!c; if (!c) fail.push(n + (d ? ` — ${d}` : "")); return !!c; };
const enc = (s) => new TextEncoder().encode(s);
const kOf = (bytes) => "did:holo:sha256:" + sha256hex(bytes);

// 5 simulated peers, each with a local κ-store (Map); a shared transport that reads peers' stores
const PEERS = Array.from({ length: 5 }, (_, i) => "did:holo:sha256:" + String(i + 1).repeat(64));
const stores = Object.fromEntries(PEERS.map((p) => [p, new Map()]));
const localOf = (p) => ({ get: async (k) => stores[p].get(k) || null, put: async (k, b) => { stores[p].set(k, b); } });
const fetchPeer = async (peer, k) => stores[peer].get(k) || null;              // honest transport
const REPL = 3;

const data = enc("a shared object on the sharded space");
const K = kOf(data);

// ── 1 · placement is deterministic + verifiable ──────────────────────────────────────────────────────
const s1 = await shardFor(K, PEERS, { replicas: REPL });
const s2 = await shardFor(K, [...PEERS].reverse(), { replicas: REPL });
const ticketsReDerive = (await Promise.all(s1.holders.map(async (p) => (await ticket(K, 0, p)) === s1.tickets[p]))).every(Boolean);
ok("placementDeterministic", JSON.stringify(s1.holders) === JSON.stringify(s2.holders) && ticketsReDerive, JSON.stringify(s1.holders));

// ── 2 · redundant, not full ──────────────────────────────────────────────────────────────────────────
ok("redundantNotFull", s1.holders.length === REPL && REPL < PEERS.length && new Set(s1.holders).size === REPL, `holders=${s1.holders.length}/${PEERS.length}`);

// ── 3 · different κs distribute across different holder sets ──────────────────────────────────────────
const K2 = kOf(enc("a totally different object"));
const sB = await shardFor(K2, PEERS, { replicas: REPL });
ok("distributesAcrossKs", JSON.stringify(sB.holders) !== JSON.stringify(s1.holders), `K→${s1.holders.map(h=>h.slice(-3,-1))} K2→${sB.holders.map(h=>h.slice(-3,-1))}`);

// ── 4 · put stores only on responsible holders ───────────────────────────────────────────────────────
const holder = s1.holders[0];
const nonHolder = PEERS.find((p) => !s1.holders.includes(p));
const holderStore = makeShardedStore({ self: holder, peers: () => PEERS, replicas: REPL, local: localOf(holder), fetchPeer, kappaOf: kOf });
const nonHolderStore = makeShardedStore({ self: nonHolder, peers: () => PEERS, replicas: REPL, local: localOf(nonHolder), fetchPeer, kappaOf: kOf });
const ph = await holderStore.put(K, data);
const pn = await nonHolderStore.put(K, data);
ok("putStoresOnHolders",
  ph.storedLocal === true && stores[holder].has(K) && pn.storedLocal === false && !stores[nonHolder].has(K)
  && (await isResponsible(holder, K, PEERS, { replicas: REPL })) === true,
  JSON.stringify({ holderStored: ph.storedLocal, nonHolderStored: pn.storedLocal }));

// ── 5 · a non-holder get() fetches from a holder, verifies, caches ───────────────────────────────────
// seed all responsible holders so a fetch can succeed
for (const h of s1.holders) stores[h].set(K, data);
const fetched = await nonHolderStore.get(K);
ok("getFetchesAndVerifies",
  fetched && new TextDecoder().decode(fetched) === "a shared object on the sharded space" && stores[nonHolder].has(K),
  fetched ? "fetched+cached" : "no fetch");

// ── 6 · a holder serving tampered bytes is refused (verify-on-receipt, Law L5) ───────────────────────
const evilPeer = "did:holo:sha256:" + "e".repeat(64);
const evilStores = { ...stores, [evilPeer]: new Map([[K, enc("EVIL swapped bytes")]]) };
const onlyEvilHolders = [evilPeer];                                            // force the fetch to hit only the evil holder
const victim = makeShardedStore({
  self: "did:holo:sha256:" + "f".repeat(64),
  peers: () => onlyEvilHolders, replicas: 1,
  local: { get: async () => null, put: async () => {} },
  fetchPeer: async (p, k) => evilStores[p].get(k) || null, kappaOf: kOf,
});
const got = await victim.get(K);
ok("tamperedFetchRefused", got === null, "tampered bytes whose κ≠K must be refused");

const witnessed = Object.values(checks).every(Boolean);
const result = {
  "@type": "earl:TestResult",
  spec: "holo-shard D — the content-addressed shared space (sharded κ-store): for a content κ the responsible peers are the R smallest-ticket peers under the holo-swarm κ-VRF seeded by that κ — deterministic, verifiable from public κs (L5), redundant (R replicas not full replication). put() stores only on responsible holders; get() fetches from a holder and VERIFIES-ON-RECEIPT (fetched bytes must re-derive to κ) before trusting/caching, so a holder cannot serve tampered data. Transport is injected (real gossip = phase G); IPFS is the durability floor. Pure assembly over holo-swarm + holo-uor.",
  authority: "Holochain DHT/sharding model · UOR-ADDR · holospaces Laws L1/L2/L5 · rests on #holo-swarm (κ-VRF) + #holo-uor",
  witnessed,
  covers: witnessed ? ["deterministic-placement", "redundant-not-full", "distributes", "put-on-holders", "get-fetch-verify", "tampered-refused"] : [],
  sample: { K, holders: s1.holders, replicas: REPL, peers: PEERS.length },
  checks, failed: fail,
};
writeFileSync(join(here, "holo-shard-witness.result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("holo-shard witness — D CONTENT-ADDRESSED SHARED SPACE (sharded κ-store, verify-on-receipt)\n");
for (const [k, val] of Object.entries(checks)) console.log(`  ${val ? "✓" : "✗"}  ${k}`);
console.log(`\n  ${REPL}/${PEERS.length} peers hold each κ · placement deterministic + verifiable · tampered fetch refused`);
console.log(`\n  ${witnessed ? "WITNESSED ✓  redundant, verifiable, serverless storage — no peer can serve bad bytes" : "NOT witnessed — " + fail.join("; ")}`);
process.exit(witnessed ? 0 : 1);
