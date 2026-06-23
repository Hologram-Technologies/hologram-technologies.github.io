// holo-gossip-channel.mjs — REAL transport for κ-gossip (G), same-origin leg. holo-gossip is transport-
// agnostic (advertise()/receive()); this drives it over an actual channel so peers really converge. In a
// browser, separate tabs/windows are separate peers and BroadcastChannel carries adverts between them —
// so a warrant raised in one tab propagates to the others and the bad actor is ejected everywhere, for
// real (not simulated). The epidemic is bounded by gossip's idempotency: a peer re-broadcasts ONLY when
// it learned something new, so once everyone knows, the chatter stops. Cross-DEVICE transport (WebRTC /
// libp2p / IPFS pubsub) is the same shape behind the same seam — out-of-band here.
//
// Core is transport-injected (node-testable with a fake hub); the browser binding wires BroadcastChannel.
// Pure assembly over holo-gossip; no new crypto.

// makeGossipNet({ gossip, post }) → { announce, onMessage }. `post(advert)` sends to peers; onMessage(advert)
// applies an incoming advert to the local gossip and re-broadcasts iff it learned something new (epidemic,
// self-terminating). Own adverts (from === gossip.self) are ignored.
export function makeGossipNet({ gossip, post = () => {} } = {}) {
  function announce() { try { return post(gossip.advertise()); } catch (e) {} }   // return post's result so a sync transport (tests) is awaitable; BroadcastChannel returns void (fine)
  async function onMessage(advert) {
    if (!advert || (advert.from != null && advert.from === gossip.self)) return { newHeads: [], newWarrants: [] };
    const r = await gossip.receive(advert);
    if ((r.newHeads.length + r.newWarrants.length) > 0) announce();   // propagate only NEW facts → terminates (idempotent receive)
    return r;
  }
  return { announce, onMessage };
}

// browser binding: attach a live gossip peer to a BroadcastChannel (real cross-tab/window transport).
// window.HoloGossipNet.attach(gossip, name?) → { announce, onMessage, close }. The caller supplies its
// gossip instance (window.__holoGossip at boot); announce() broadcasts, incoming adverts auto-apply.
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
  window.HoloGossipNet = {
    attach(gossip, name = "holo-gossip") {
      const bc = new BroadcastChannel(name);
      const net = makeGossipNet({ gossip, post: (m) => { try { bc.postMessage(m); } catch (e) {} } });
      bc.onmessage = (e) => { net.onMessage(e.data); };
      net.announce();                                                  // say hello so peers learn our head/warrants
      return { announce: net.announce, onMessage: net.onMessage, channel: bc, close: () => { try { bc.close(); } catch (e) {} } };
    },
  };
}
