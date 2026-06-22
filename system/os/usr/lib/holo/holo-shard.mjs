// holo-shard.mjs — D of the Holochain-parity plan: the CONTENT-ADDRESSED SHARED SPACE (a sharded κ-store).
// Holochain's DHT shards public data across peers by hash proximity — redundancy without everyone storing
// everything. Here the SAME idea on the κ substrate, reusing holo-swarm's κ-VRF: for a content κ, the
// responsible peers (its "shard") are the R peers with the smallest VRF ticket SEEDED BY THAT κ. The
// placement is deterministic, verifiable by anyone from public κs (Law L5), and redundant (R replicas,
// not full replication). Reads VERIFY-ON-RECEIPT: fetched bytes must re-derive to the κ or they're
// refused — so a holder cannot serve tampered data (L5 on the wire).
//
// Transport is INJECTED (fetchPeer) so the placement + verify logic is pure and node-witnessable with
// simulated peers; real multi-device gossip is phase G and lives behind the same seam. IPFS remains the
// durability floor under this. Pure assembly over holo-swarm + holo-uor; no new crypto. Additive.

import { ticket } from "./holo-swarm.mjs";
import { sha256hex } from "./holo-uor.mjs";

const kappaOfBytes = (bytes) => "did:holo:sha256:" + sha256hex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

// shardFor(contentKappa, peers, { replicas }) → { holders, tickets, replicas }. The responsible peers are
// the `replicas` smallest-ticket peers for the κ-VRF SEEDED BY the content κ. Deterministic + verifiable.
export async function shardFor(contentKappa, peers = [], { replicas = 3 } = {}) {
  const set = [...new Set(peers.map(String))].filter(Boolean);
  const tickets = {};
  for (const p of set) tickets[p] = await ticket(contentKappa, 0, p);          // seed = the content κ itself
  const holders = set.slice().sort((a, b) => tickets[a].localeCompare(tickets[b]) || a.localeCompare(b)).slice(0, Math.min(replicas, set.length));
  return { holders, tickets, replicas: Math.min(replicas, set.length) };
}
export async function isResponsible(peer, contentKappa, peers, opts) {
  return (await shardFor(contentKappa, peers, opts)).holders.includes(String(peer));
}

// makeShardedStore({ self, peers, replicas, local, fetchPeer, kappaOf }) → { put, get, holdersOf }.
//   self      : this device's κ.    peers() : () → current peer κs (incl. self).
//   local     : { get(κ)→bytes|null, put(κ,bytes) } — this device's κ-store (IndexedDB/OPFS in the browser).
//   fetchPeer : async (peerκ, κ) → bytes|null — the injected transport (a simulated map in tests; gossip live).
//   kappaOf   : bytes → κ (defaults to sha256 did:holo) — the verify-on-receipt derivation (Law L5).
export function makeShardedStore({ self, peers = () => [], replicas = 3, local, fetchPeer = null, kappaOf = kappaOfBytes } = {}) {
  const verifyReturn = async (kappa, bytes) => (bytes && (await kappaOf(bytes)) === kappa ? bytes : null);

  // put — store locally iff this device is a responsible holder; report the placement (the holders that
  // SHOULD carry it; pushing to the others is the transport's job — phase G).
  async function put(kappa, bytes) {
    if ((await kappaOf(bytes)) !== kappa) throw new Error("put: bytes do not address to κ (Law L5)");
    const ps = peers();
    const { holders } = await shardFor(kappa, ps, { replicas });
    const mine = holders.includes(String(self));
    if (mine) await local.put(kappa, bytes);
    return { kappa, holders, storedLocal: mine };
  }

  // get — local first; else fetch from a responsible holder and VERIFY-ON-RECEIPT before trusting/caching.
  async function get(kappa) {
    const lb = await local.get(kappa);
    if (lb) { const v = await verifyReturn(kappa, lb); if (v) return v; }       // even local bytes are re-derived
    if (!fetchPeer) return null;
    const { holders } = await shardFor(kappa, peers(), { replicas });
    for (const h of holders) {
      if (String(h) === String(self)) continue;
      let got = null; try { got = await fetchPeer(h, kappa); } catch (e) { got = null; }
      const v = await verifyReturn(kappa, got);                                  // tampered/wrong bytes → skip this holder
      if (v) { try { await local.put(kappa, v); } catch (e) {} return v; }       // cache the verified copy
    }
    return null;                                                                 // no holder served verifying bytes
  }

  return { put, get, holdersOf: (kappa) => shardFor(kappa, peers(), { replicas }) };
}

if (typeof window !== "undefined") {
  window.HoloShard = { shardFor, isResponsible, makeShardedStore };
}
