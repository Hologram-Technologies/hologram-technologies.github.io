// holo-transport.mjs — the MOVE verb, as ONE registry. A Transport MOVES a κ-message between peers and NEVER
// interprets the κ it carries (hash-agnostic by law — the same discipline as a Language never re-hashing). The
// many movers (wan, swarm, gossip, rtc, broadcast, relay, block-fallback) become ENTRIES in this one registry,
// resolvable by name or capability, behind the SAME {send, subscribe} contract. This is the MOVE sibling of
// holo-language (WRAP): same defineX + makeXRegistry pattern, a different verb.

export const TRANSPORT_CAPS = ["local", "wan", "p2p", "broadcast", "relay"];

// defineTransport(spec) — validate + freeze. Rejects a Transport that carries its own hasher: a mover moves
// bytes, it does not mint or interpret κ (Law: hash-agnostic transport).
export function defineTransport(spec) {
  if (!spec || !spec.name) throw new Error("a Transport needs a name");
  if (typeof spec.send !== "function" || typeof spec.subscribe !== "function") {
    throw new Error("a Transport needs send(msg) and subscribe(handler)->unsubscribe");
  }
  if (spec.hasher || spec.hash) {
    throw new Error("Law: a Transport is hash-agnostic — it moves κ, it must not interpret or re-hash it");
  }
  const capabilities = {};
  for (const c of TRANSPORT_CAPS) if (spec.capabilities && spec.capabilities[c]) capabilities[c] = true;
  return Object.freeze({ name: String(spec.name), capabilities, send: spec.send, subscribe: spec.subscribe });
}

// makeTransports() — the registry. register a mover, look up by name or capability, send/subscribe through it.
// Adding a network mover is ONE object, no core change (the same "evolvable" property as Languages).
export function makeTransports() {
  const ts = new Map();
  const register = (spec) => { const T = defineTransport(spec); ts.set(T.name, T); return T.name; };
  const byName = (n) => ts.get(n) || null;
  const byCapability = (cap) => [...ts.values()].filter((T) => T.capabilities[cap]);
  const names = () => [...ts.keys()];
  const coveredCapabilities = () => TRANSPORT_CAPS.filter((c) => byCapability(c).length > 0);
  const send = (name, msg) => { const T = ts.get(name); if (!T) return false; T.send(msg); return true; };
  const subscribe = (name, h) => { const T = ts.get(name); return T ? T.subscribe(h) : () => {}; };
  return { register, byName, byCapability, names, coveredCapabilities, send, subscribe, size: () => ts.size };
}

// an in-memory broadcast bus — the reference Transport (fan-out to all subscribers). Other movers (wan/swarm/
// gossip/rtc) implement the SAME {send, subscribe} and register alongside it.
export function memoryBus(name = "local", capabilities = { local: true, broadcast: true }) {
  const subs = new Set();
  return defineTransport({ name, capabilities, send: (m) => { for (const s of [...subs]) s(m); }, subscribe: (h) => { subs.add(h); return () => subs.delete(h); } });
}

if (typeof window !== "undefined") window.HoloTransport = { makeTransports, defineTransport, memoryBus, TRANSPORT_CAPS };
export default { makeTransports, defineTransport, memoryBus, TRANSPORT_CAPS };
