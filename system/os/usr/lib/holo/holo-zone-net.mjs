// holo-zone-net.mjs — RESOLVE OTHER PEOPLE'S NAMES, VERIFY-BEFORE-TRUST. holo-zone gives you owned, mutable
// names on YOUR source chain; this fetches SOMEONE ELSE'S zone over a transport so a name they own resolves
// on your device — with no registrar and no trusted intermediary. The transport is dumb and untrusted: you
// ask "who has owner <hex>'s zone?", a peer sends the signed strand entries, and you ADOPT them only if they
// re-derive end-to-end AND every binding is signed by exactly that owner κ (holo-zone.adopt → verifyZone,
// Law L5). A tampered chain in flight, or a peer serving a different owner's chain, is refused — the answer
// is the math, never the messenger. Fetched zones are cached and re-served, so the network heals itself.
//
// Mirrors holo-gossip-channel: a transport-injected core (node-testable with a loopback hub) + a browser
// binding over BroadcastChannel (separate tabs/devices are real peers). Pure assembly over holo-zone; no new
// crypto. This is the seam holo-root's openZone(ownerHex) plugs into so a bare/qualified name owned by anyone
// resolves through the one door.

import { makeZone } from "./holo-zone.mjs";

const kappaOf = (hex) => "did:holo:sha256:" + String(hex).toLowerCase();

// makeZoneNet({ self, openLocal, post, timeoutMs }) → { openZone, onMessage, cache }.
//   self      : this peer's id (own messages are ignored).
//   openLocal : async (ownerHex) → a zone instance THIS node hosts (the operator's own), or null.
//   post      : (msg) → broadcast to peers (the transport).
//   timeoutMs : how long to wait for a peer to answer a want before failing closed.
export function makeZoneNet({ self = "peer", openLocal = async () => null, post = () => {}, timeoutMs = 1500 } = {}) {
  const cache = new Map();                          // ownerHex → a VERIFIED, adopted zone
  const pending = new Map();                        // nonce → resolve(entries|null)
  let seq = 0;

  // onMessage — the want/have protocol. A "want" I can satisfy (host or cache) → I post the signed entries.
  // A "have" for one of my outstanding wants → resolve it (the entries are verified in fetchRemote, not here).
  async function onMessage(msg) {
    if (!msg || msg.from === self) return;
    if (msg.t === "want") {
      let z = cache.get(msg.owner) || await openLocal(msg.owner);
      if (z && typeof z.entries === "function") { try { post({ t: "have", owner: msg.owner, nonce: msg.nonce, entries: z.entries(), from: self }); } catch (e) {} }
    } else if (msg.t === "have" && pending.has(msg.nonce)) {
      pending.get(msg.nonce).collect(msg.entries);            // collect ALL answers in the window (don't stop at the first)
    }
  }

  // fetchRemote — ask the net, gather answers for one window, then adopt the LONGEST chain that verifies as
  // the requested owner. Append-only ⇒ the longest valid chain is the most recent, so a peer with a STALE
  // cached copy can never override the owner's latest binding; tampered/foreign chains simply fail to adopt.
  async function fetchRemote(owner) {
    const nonce = self + ":" + (seq++);
    const candidates = [];
    await new Promise((resolve) => {
      pending.set(nonce, { collect: (e) => { if (Array.isArray(e)) candidates.push(e); } });
      setTimeout(resolve, timeoutMs);                          // wait the window, then choose
      try { post({ t: "want", owner, nonce, from: self }); } catch (e) {}
    });
    pending.delete(nonce);
    candidates.sort((a, b) => b.length - a.length);            // longest first = most recent
    for (const entries of candidates) {
      const z = makeZone({ owner: kappaOf(owner) });           // read-only: owner κ scopes + gates the signatures
      const r = await z.adopt(entries);                        // VERIFY-BEFORE-TRUST: re-derive chain + owner-signed
      if (r.ok) { cache.set(owner, z); return z; }             // tampered / foreign-owner / broken → try the next
    }
    return null;                                               // no valid answer (miss / all refused) → fail closed
  }

  // openZone(ownerHex) — my own zone first, then cache, then the net (verified). Returns null on refuse/miss.
  async function openZone(owner) {
    const local = await openLocal(owner);
    if (local) return local;
    if (cache.has(owner)) return cache.get(owner);
    return fetchRemote(owner);
  }

  return { openZone, onMessage, cache };
}

// attachChannel(openLocal, channel, opts) — run a zone-net over ANY point-to-point channel that speaks the
// send/onmessage contract: an RTCDataChannel (WebRTC, cross-device WAN), a WebSocket, or a MessagePort. This
// is the WebRTC leg — a DataChannel IS a send+message channel, so a real peer connection drops in unchanged;
// only the SDP/ICE signaling that opens the channel is out-of-band (a one-time exchange via holo-dial). The
// adapter JSON-frames the want/have protocol; verify-before-adopt is unchanged (the channel is untrusted).
export function attachChannel(openLocal, channel, { self = null, timeoutMs = 1500 } = {}) {
  const id = self || ((globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : "peer-" + Math.floor((globalThis.performance && performance.now) ? performance.now() : 0));
  const send = typeof channel.send === "function" ? (s) => { try { channel.send(s); } catch (e) {} } : (s) => { try { channel.postMessage(s); } catch (e) {} };
  const net = makeZoneNet({ self: id, openLocal, timeoutMs, post: (m) => send(JSON.stringify(m)) });
  const handler = (ev) => { let m; try { m = JSON.parse(typeof ev.data === "string" ? ev.data : (ev && ev.data != null ? ev.data : ev)); } catch (e) { return; } net.onMessage(m); };
  if (typeof channel.addEventListener === "function") { channel.addEventListener("message", handler); if (typeof channel.start === "function") channel.start(); }
  else { channel.onmessage = handler; }
  return { openZone: net.openZone, onMessage: net.onMessage, self: id, detach: () => { try { channel.removeEventListener && channel.removeEventListener("message", handler); } catch (e) {} } };
}

// browser binding: a live zone-net over BroadcastChannel — separate tabs/windows/devices are real peers.
// window.HoloZoneNet.attach(openLocal, name?) → { openZone, close }. The caller supplies openLocal (the
// operator's own zone). openZone(ownerHex) then resolves ANY owner's names across the channel, verify-before-trust.
if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
  window.HoloZoneNet = {
    attach(openLocal, name = "holo-zone-net") {
      const bc = new BroadcastChannel(name);
      const self = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : "tab-" + Math.floor((globalThis.performance && performance.now ? performance.now() : 0));
      const net = makeZoneNet({ self, openLocal, post: (m) => { try { bc.postMessage(m); } catch (e) {} } });
      bc.onmessage = (e) => { net.onMessage(e.data); };
      return { openZone: net.openZone, onMessage: net.onMessage, channel: bc, close: () => { try { bc.close(); } catch (e) {} } };
    },
  };
}

export default { makeZoneNet };
