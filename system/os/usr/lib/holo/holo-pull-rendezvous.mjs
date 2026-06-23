// holo-pull-rendezvous.mjs — serverless per-κ peer discovery (the DHT/PEX analog). A κ keys a
// rendezvous topic on the existing relay/pubsub rung (holo-dial / holo-peers / holo-edge in prod; an
// injectable `relay` here so it's Node-witnessable). A holder ANNOUNCES "I have κ"; everyone subscribed
// to that κ's topic learns the peer, and re-broadcasts the set so newcomers are introduced to each other
// (transitive PEX) — no tracker, no central registry. Trust stays in κ + L5: a learned descriptor is
// only ever a CANDIDATE. Every block a candidate serves still re-derives via holo-swarm-fetch, so a
// lying announcer wastes one connection attempt and nothing more. Pure routing of small descriptors.
//
//   relay := { publish(topic, msg), subscribe(topic, cb) → unsubscribe }
//   self  := { id, ... }   (a peer descriptor: id + whatever the transport needs to dial it)

export const topicOf = (kappa) => "holo:swarm:" + String(kappa);   // the κ IS the rendezvous address

export function createRendezvous(relay, kappa, self, { onPeer } = {}) {
  const topic = topicOf(kappa);
  const known = new Map();                                          // peerId → descriptor (never includes self)

  function learn(desc) {
    if (!desc || !desc.id || desc.id === self.id || known.has(desc.id)) return false;   // idempotent, no self
    known.set(desc.id, desc);
    try { onPeer && onPeer(desc); } catch {}
    relay.publish(topic, { t: "peers", from: self.id, peers: [...known.values(), self] });  // transitive PEX
    return true;
  }

  const unsub = relay.subscribe(topic, (m) => {
    if (!m || m.from === self.id) return;
    if (m.t === "announce") learn(m.peer);
    else if (m.t === "peers") for (const d of m.peers || []) learn(d);
  });

  return {
    topic,
    announce() { relay.publish(topic, { t: "announce", from: self.id, peer: self }); },
    peers() { return [...known.values()]; },
    close() { try { unsub && unsub(); } catch {} },
  };
}

export default { topicOf, createRendezvous };
