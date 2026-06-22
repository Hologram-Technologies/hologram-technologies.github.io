// holo-gossip.mjs — G of the Holochain-parity plan: κ-GOSSIP of heads + warrants (anti-entropy /
// self-healing). Peers periodically advertise WHAT THEY KNOW — each principal's latest source-chain head
// κ, and the warrants they hold — and a receiver reconciles toward the union. This is the propagation
// that activates the earlier phases across devices: a warrant raised anywhere (W) reaches everywhere; a
// head learned here lets a peer fetch+admit the chain there (D + V). Eventual consistency, no server.
//
// THE INVARIANT: gossip CARRIES, it never CONFERS trust. Heads are mere pointers (trust arrives only when
// the chain is fetched and admitted, V). Warrants are CONFIRMED INDEPENDENTLY on receipt (W) before they
// propagate or block anyone — so a false/forged warrant dies at the first honest peer instead of
// spreading. Idempotent (re-hearing the same advert changes nothing) → it converges regardless of order.
//
// Pure assembly over holo-warrant; transport is the caller's (the witness pumps rounds; live gossip is a
// thin network loop over the same advertise()/receive()). No new crypto. Additive.

import { confirmWarrant } from "./holo-warrant.mjs";

// makeGossip({ self, immunity }) → a peer's gossip engine. `immunity` is a holo-warrant makeImmunity()
// (shared with this peer's receive gate) so a confirmed warrant blocks the actor here too.
export function makeGossip({ self = null, immunity = null } = {}) {
  const heads = new Map();                                   // principal κ → its latest head κ (a pointer, untrusted)
  const warrants = new Map();                                // warrant κ → warrant object (CONFIRMED only)

  function setHead(principal, head) { if (principal && head) heads.set(String(principal), head); }

  function advertise() {
    return { "@type": "HoloGossip", from: self, heads: Object.fromEntries(heads), warrants: [...warrants.values()] };
  }

  // receive(advert) → reconcile toward the union. Heads are recorded if new/advanced (no trust). Warrants
  // are CONFIRMED INDEPENDENTLY before being kept/propagated; only a confirmed warrant blocks its actor.
  async function receive(advert = {}) {
    const out = { newHeads: [], newWarrants: [], blocked: [], rejected: [] };
    for (const [p, h] of Object.entries(advert.heads || {})) {
      if (heads.get(p) !== h) { heads.set(p, h); out.newHeads.push([p, h]); }   // pointer only — fetch+admit happens elsewhere (V)
    }
    for (const w of advert.warrants || []) {
      const key = w && w.id; if (!key || warrants.has(key)) continue;           // idempotent: already known
      const r = immunity ? await immunity.receive(w) : await confirmWarrant(w); // W — verify, don't trust the gossiper
      if (r.confirmed) { warrants.set(key, w); out.newWarrants.push(key); if (r.actor) out.blocked.push(r.actor); }
      else out.rejected.push(key);                                              // a false/forged warrant stops here
    }
    return out;
  }

  return {
    self, setHead, advertise, receive,
    knownHeads: () => Object.fromEntries(heads),
    knownWarrants: () => [...warrants.keys()],
    hasWarrant: (k) => warrants.has(k),
  };
}

// gossipRound(peers) — one synchronous anti-entropy round: every peer receives every other peer's current
// advertisement. Returns the total number of new facts learned this round (0 ⇒ converged). A convenience
// for drivers/tests; live transport calls advertise()/receive() over the network instead.
export async function gossipRound(peers = []) {
  let learned = 0;
  const adverts = peers.map((p) => p.advertise());
  for (let i = 0; i < peers.length; i++) {
    for (let j = 0; j < peers.length; j++) {
      if (i === j) continue;
      const r = await peers[i].receive(adverts[j]);
      learned += r.newHeads.length + r.newWarrants.length;
    }
  }
  return learned;
}

if (typeof window !== "undefined") {
  window.HoloGossip = { makeGossip, gossipRound };
}
