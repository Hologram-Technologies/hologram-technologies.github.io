// holo-relay-bus.mjs — the live serverless pub/sub bus that lights up roam's DEVICE leg.
//
// holo-roam-wan's "devices" leg activates iff `window.HoloRelay` is a relay with the shape
//   relay := { publish(topic, msg), subscribe(topic, cb) → unsubscribe }
// (the same shape holo-pull-rendezvous + holo-roam-wan already consume). That relay was missing — only the
// same-origin "tabs" leg (BroadcastChannel) existed. This module IS that relay: a topic multiplexer over ONE
// duplex link (a WebRTC RTCDataChannel between PAIRED devices in production; a fake hub in the witness). It is
// CONTENT-BLIND — it moves opaque {topic,msg} frames and never inspects msg (encryption + verify-before-trust
// live one layer up, in the roam mirror). Pure core (link injected, node-witnessable); the browser binding
// wires holo-ad4m-wan's makeWanBus and exposes window.HoloRelay + .attach (pairing adds the device channel).
//
//   link := { send(frame), onMessage(cb) }   (adapter over makeWanBus: send=bus.post, onMessage=bus.onInbound)

function rid() {
  try { return (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : "r" + Math.random().toString(16).slice(2); }
  catch (e) { return "r" + Object.keys({}).length; }
}

// makeRelayBus({ link, self }) → { self, publish, subscribe, close }. Multiplexes many topics over one link;
// fans each inbound frame to that topic's subscribers; never delivers a peer its own frame; dedups by mid.
export function makeRelayBus({ link, self } = {}) {
  if (!link || typeof link.send !== "function" || typeof link.onMessage !== "function") {
    throw new Error("holo-relay-bus: link { send, onMessage } required");
  }
  const id = self || rid();
  const topics = new Map();   // topic → Set<cb>
  const seen = new Set();     // bounded dedup by frame mid
  let n = 0;

  function deliver(frame) {
    if (!frame || frame.__roam !== 1) return;              // ignore non-roam traffic sharing the link
    if (frame.from === id) return;                         // never echo our own frames back to us
    if (frame.mid) { if (seen.has(frame.mid)) return; seen.add(frame.mid); if (seen.size > 4096) seen.clear(); }
    const subs = topics.get(frame.topic); if (!subs || !subs.size) return;
    for (const cb of [...subs]) { try { cb(frame.msg, { from: frame.from, topic: frame.topic }); } catch (e) {} }
  }
  link.onMessage(deliver);

  return {
    self: id,
    publish(topic, msg) {
      try { link.send({ __roam: 1, from: id, topic: String(topic), msg, mid: id + ":" + (++n) }); } catch (e) {}
    },
    subscribe(topic, cb) {
      const t = String(topic); let s = topics.get(t); if (!s) topics.set(t, s = new Set());
      s.add(cb);
      return () => { try { s.delete(cb); } catch (e) {} };
    },
    close() { topics.clear(); },
  };
}

// ── browser binding: install window.HoloRelay over a real WAN bus. Zero peers until pairing attaches a
//    device channel (window.HoloRelay.attach(rtcDataChannel)) — so an unpaired device is inert (no roam),
//    and roam-wan's `relay = window.HoloRelay` finds a ready relay to add its "devices" leg to. Idempotent.
if (typeof window !== "undefined" && !window.HoloRelay) {
  window.HoloRelayBus = { makeRelayBus };
  (async () => {
    try {
      const { makeWanBus } = await import("./holo-ad4m-wan.mjs");
      const bus = makeWanBus();
      const link = { send: (f) => bus.post(f), onMessage: (cb) => bus.onInbound(cb) };
      const relay = makeRelayBus({ link });
      window.HoloRelay = {
        publish: relay.publish,
        subscribe: relay.subscribe,
        attach: (ch) => { try { return bus.attach(ch); } catch (e) {} },   // pairing wires the device RTCDataChannel here
        peerCount: () => { try { return bus.peerCount(); } catch (e) { return 0; } },
        self: relay.self,
      };
    } catch (e) { /* no WAN bus → tabs-only roam, single-device behaviour preserved (fail-soft) */ }
  })();
}

export default { makeRelayBus };
