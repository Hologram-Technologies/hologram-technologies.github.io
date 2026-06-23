// holo-messenger-transport.mjs — THE LIVE STREAM. Real-time, low-latency message delivery.
//
// Beeper streams events from a homeserver to its clients. Holo Messenger streams a captured
// message from the platform tab that plucked it to every surface that subscribes — over the
// EXISTING κ pub/sub codec (holo-wire) and the EXISTING gossip transport shape (holo-gossip-
// channel binds it to BroadcastChannel). On the same device the hop is an in-process
// BroadcastChannel: a message rendered in a platform tab appears in the unified inbox in the
// SAME tick — no server, no network round trip. That is the low latency.
//
// The relay is CONTENT-BLIND (SEC-7): it routes and caches opaque (κ, bytes) frames and never
// parses or verifies a payload — a pipe, not an observer. Integrity is enforced at the EDGE:
// every subscriber re-derives a frame's bytes to its claimed κ before rendering (Law L5 /
// SEC-1) via the substrate's own verify-before-trust (holo-pluck.mountFromPayload). So a
// forging relay or a tampered byte is refused by the receiver, not trusted because it arrived.
// Buffers are bounded by payload, never by declared counts (SEC-8).
//
// Pure assembly over holo-wire + holo-pluck; no new crypto, no new frame format. The core is
// transport-injected (Node-testable with a fake hub); the browser binding wires BroadcastChannel
// exactly like holo-gossip-channel.
//
// Authority: holo-wire (κ pub/sub frame) · holo-gossip-channel (BroadcastChannel leg) ·
//   holospaces SEC-1 (verify-on-receipt) · SEC-3 (idempotent) · SEC-7 (egress content-blind) ·
//   SEC-8 (bounded) · Law L5.

import { OP, encodeMsg, decodeMsg } from "../../../sbin/holo-wire.mjs";
import { mountFromPayload } from "./holo-pluck.mjs";

const enc = new TextEncoder();
const dec = new TextDecoder();
const u8 = (f) => (f instanceof Uint8Array ? f : new Uint8Array(f));

// frameMessage(genesis, object) → a PUT frame: the message's canonical bytes under its
// conversation topic (the genesis κ). The bytes ARE the message; the κ proves them.
export function frameMessage(genesis, object) {
  return encodeMsg({ op: OP.PUT, topic: String(genesis), kappa: String(object.id), bytes: enc.encode(JSON.stringify(object)) });
}

// makePublisher({ send }) — a platform tab announces each captured message to peers. `send`
// is the transport (BroadcastChannel.postMessage in the browser; a fake hub in tests).
export function makePublisher({ send = () => {} } = {}) {
  return {
    publish(genesis, object) { const f = frameMessage(genesis, object); send(f); return f; },
  };
}

// makeSubscriber({ topics, onMessage, max }) — the unified inbox's receiving end. Verifies
// EVERY frame verify-before-render (SEC-1/L5); idempotent on κ (SEC-3); bounded seen-set (SEC-8).
// onMessage({ genesis, kappa, object }) fires ONLY for a fresh, verified message.
export function makeSubscriber({ topics = [], onMessage = () => {}, max = 4096 } = {}) {
  const subs = new Set(topics.map(String));
  const seen = new Set(); const order = [];
  function receive(frame) {
    let msg; try { msg = decodeMsg(u8(frame)); } catch { return { ok: false, why: "decode" }; }
    if (msg.op !== OP.PUT && msg.op !== OP.OBJ && msg.op !== OP.ANN) return { ok: false, why: "op-ignored" };
    if (subs.size && !subs.has(msg.topic)) return { ok: false, why: "topic-not-subscribed" };
    if (!msg.bytes || msg.bytes.length === 0) return { ok: false, why: "no-bytes" };
    let object; try { object = JSON.parse(dec.decode(msg.bytes)); } catch { return { ok: false, why: "payload-parse" }; }
    const mounted = mountFromPayload({ kappa: msg.kappa, object });          // VERIFY-BEFORE-RENDER (SEC-1, L5)
    if (!mounted.ok) return { ok: false, why: "verify-failed:" + mounted.why };
    if (seen.has(mounted.kappa)) return { ok: true, duplicate: true, kappa: mounted.kappa };  // idempotent (SEC-3)
    seen.add(mounted.kappa); order.push(mounted.kappa);
    if (order.length > max) seen.delete(order.shift());                       // bounded (SEC-8)
    try { onMessage({ genesis: msg.topic, kappa: mounted.kappa, object: mounted.object }); } catch (e) {}
    return { ok: true, kappa: mounted.kappa, genesis: msg.topic };
  }
  return {
    receive,
    subscribe: (t) => subs.add(String(t)),
    unsubscribe: (t) => subs.delete(String(t)),
    get size() { return seen.size; },
  };
}

// makeRelay({ max }) — a CONTENT-BLIND bus (SEC-7) for cross-device / on-demand fetch. It
// caches opaque (κ → frame bytes) on PUT and re-broadcasts to topic subscribers; answers GET
// with the cached frame (OBJ) or MISS. It NEVER parses or verifies a payload — it only reads
// the wire header (op/topic/kappa). A pipe, not an observer. Caches are bounded (SEC-8).
export function makeRelay({ max = 4096 } = {}) {
  const peers = new Set();              // each peer: a send(frame) sink
  const topics = new Map();             // topic → Set(peer)
  const cache = new Map();              // kappa → frame bytes (opaque); bounded
  const order = [];
  const fanout = (topic, frame, except) => { (topics.get(topic) || new Set()).forEach((p) => { if (p !== except) try { p(frame); } catch (e) {} }); };

  function connect(send) {
    peers.add(send);
    const peer = {
      send,
      handle(frame) {
        const m = decodeMsg(u8(frame));                                      // header only — payload stays opaque
        if (m.op === OP.SUB) { if (!topics.has(m.topic)) topics.set(m.topic, new Set()); topics.get(m.topic).add(send); return; }
        if (m.op === OP.PUT) {
          const bytes = u8(frame);
          if (!cache.has(m.kappa)) { cache.set(m.kappa, bytes); order.push(m.kappa); if (order.length > max) cache.delete(order.shift()); }
          fanout(m.topic, frame, send);                                      // forward UNCHANGED, content-blind
          return;
        }
        if (m.op === OP.GET) { const hit = cache.get(m.kappa); send(hit || encodeMsg({ op: OP.MISS, kappa: m.kappa })); return; }
      },
      close() { peers.delete(send); topics.forEach((s) => s.delete(send)); },
    };
    return peer;
  }
  return { connect, get cacheSize() { return cache.size; } };
}

// ── browser binding: window.HoloMessengerTransport — attach a live peer over BroadcastChannel ──
// attach({ topics, onMessage, name }) → { publish, subscribe, close }. Mirrors holo-gossip-
// channel.attach: a separate tab/window is a separate peer; BroadcastChannel carries frames
// between them, so a message plucked in a platform tab streams to the inbox tab for real.
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" && !window.HoloMessengerTransport) {
  window.HoloMessengerTransport = {
    frameMessage, makePublisher, makeSubscriber, makeRelay,
    attach({ topics = [], onMessage = () => {}, name = "holo-messenger" } = {}) {
      const bc = new BroadcastChannel(name);
      const sub = makeSubscriber({ topics, onMessage });
      const pub = makePublisher({ send: (f) => { try { bc.postMessage(f); } catch (e) {} } });
      bc.onmessage = (e) => { try { sub.receive(e.data); } catch (err) {} };
      return { publish: pub.publish, subscribe: sub.subscribe, unsubscribe: sub.unsubscribe, channel: bc, close: () => { try { bc.close(); } catch (e) {} } };
    },
  };
}
