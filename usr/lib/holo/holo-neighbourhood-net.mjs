// holo-neighbourhood-net.mjs — a live, cross-internet transport for an AD4M Neighbourhood: bind its want/have
// post/onMessage to a real WebRTC DATACHANNEL between peers, brokered by a DUMB rendezvous relay (together-signal:
// SSE + POST that only swaps offer/answer/ICE). Once connected, every strand byte is peer-to-peer + E2E — the relay
// never sees, stores, ranks, or holds your strands, posts, graph, or identity. It only helps two browsers find each
// other. Safety comes from the Neighbourhood itself: verify-before-adopt (Law L5 + authorship) makes the untrusted
// channel safe — a chain tampered in flight, or a peer signing as someone else, is refused.
//
// This is the BroadcastChannel binding's bigger sibling: BroadcastChannel = same machine; this = anywhere there's a
// relay to shake hands through. Symmetric mesh (every peer can publish), deterministic perfect-negotiation (the peer
// with the greater transport id offers — no glare), one "nb" datachannel per peer. Off-Hologram-safe: pure browser
// APIs (RTCPeerConnection, EventSource, fetch), so a plain Chrome tab joins your network with no install.
//
//   attachNeighbourhoodRTC({ perspective, me, room, signal, self?, iceServers?, onPeer?, onState? })
//     → { nb, sync, peers, join, close }
// `nb` is a live makeNeighbourhood() — read nb.sharedLinks(), nb.addLink(...), nb.members(). The transport keeps it
// converged: it want/have-syncs on every new peer and re-publishes your strand whenever you add a Link.

import { makeNeighbourhood } from "./holo-ad4m-neighbourhood.mjs";

const DEFAULT_ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
const _rid = () => "p" + Math.random().toString(36).slice(2, 10);

// resolveIceServers(cfg) — production NAT traversal. STUN gets two peers connected across most home routers; a
// symmetric NAT (some corporate/mobile networks) needs a TURN relay to hairpin the media. Ops supply TURN via
// config (or a global HOLO_ICE) so the app ships without baked-in credentials. Accepts an iceServers array, or
// { stun:[url…], turn:[{urls,username,credential}…] }, or a single {urls,username,credential}. STUN first, deduped.
export function resolveIceServers(cfg) {
  const list = [...DEFAULT_ICE]; const add = (e) => { if (e && e.urls) list.push(e); };
  if (cfg) {
    if (Array.isArray(cfg)) cfg.forEach(add);
    else { (cfg.stun || []).forEach((u) => add(typeof u === "string" ? { urls: u } : u)); (cfg.turn || []).forEach(add); if (cfg.urls) add(cfg); }
  }
  const seen = new Set(); return list.filter((e) => { const k = JSON.stringify(e); if (seen.has(k)) return false; seen.add(k); return true; });
}

// open the dumb relay SSE for (room, peer); returns { post, close }. Identical wire-protocol to holo-together-rtc.
function _connect(base, room, peer, onMsg) {
  const es = new EventSource(`${base}/signal?room=${encodeURIComponent(room)}&peer=${encodeURIComponent(peer)}`);
  es.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch { return; } onMsg(d); };
  const post = (obj) => { try { fetch(`${base}/signal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, from: peer, ...obj }) }); } catch {} };
  return { post, close: () => { try { es.close(); } catch {} } };
}

const _hexOf = (url) => String(url).split(":").pop();

export function attachNeighbourhoodRTC({ perspective, me, room, signal = null, self = null, iceServers = null, ice = null, store = null, onPeer = () => {}, onState = () => {} } = {}) {
  if (typeof RTCPeerConnection === "undefined") throw new Error("attachNeighbourhoodRTC needs a browser with WebRTC");
  if (!perspective || !me || !room) throw new Error("attachNeighbourhoodRTC needs { perspective, me, room }");
  const base = signal || (typeof location !== "undefined" ? location.origin : "");
  const ICE = iceServers || resolveIceServers(ice || (typeof globalThis !== "undefined" && globalThis.HOLO_ICE) || null);   // STUN + optional TURN
  const peerId = self || _rid();
  const conns = new Map();   // remotePeerId → { pc, ch }

  // The Neighbourhood's transport: post → fan out to every OPEN datachannel. The payload is the strand want/have only.
  function broadcast(msg) { const s = JSON.stringify(msg); for (const e of conns.values()) { if (e.ch && e.ch.readyState === "open") { try { e.ch.send(s); } catch {} } } }
  const nb = makeNeighbourhood({ perspective, me, self: peerId, post: broadcast });

  // CONTENT SYNC over the SAME channel: the Neighbourhood distributes the signed Links (who-posted-what-when); a
  // post's actual bytes are a content-addressed Expression that must resolve on the peer too. With no shared κ-fabric
  // between two browsers, the datachannel IS the fabric: after adopting Links we ASK for any post/repost target we
  // lack, and answer others' asks from our store. Trust travels with the bytes — getExpression re-verifies on read
  // (Law L5), so a κ-mismatched or tampered blob simply resolves to null and is skipped. Opaque to the relay.
  const has = (k) => { try { return store && !!store.get(_hexOf(k)); } catch { return false; } };
  function wantContent() {
    if (!store) return;
    const ks = []; for (const l of nb.sharedLinks()) { if ((l.predicate === "posted" || l.predicate === "reposted") && l.target && !has(l.target)) ks.push(l.target); }
    if (ks.length) broadcast({ t: "holo:content-want", ks: [...new Set(ks)], from: peerId });
  }
  function onContent(msg) {
    if (msg.t === "holo:content-want") { if (!store || !Array.isArray(msg.ks)) return; const items = [];
      for (const k of msg.ks) { const e = store.get(_hexOf(k)); if (e) items.push({ k, e }); }
      if (items.length) broadcast({ t: "holo:content-have", items, from: peerId }); return true; }
    if (msg.t === "holo:content-have") { if (store && Array.isArray(msg.items)) for (const it of msg.items) { try { store.set(_hexOf(it.k), it.e); } catch {} } return true; }
    return false;
  }

  // wrap addLink so a new Link is immediately re-advertised to live peers (else they'd see it only on the next sync)
  const _addLink = nb.addLink;
  nb.addLink = async (...a) => { const r = await _addLink(...a); try { nb.publish(); } catch {} return r; };

  function bindChannel(remote, ch) {
    const e = conns.get(remote) || {}; e.ch = ch; conns.set(remote, e);
    ch.onopen = () => { onState({ phase: "peer", peer: remote, peers: openPeers() }); try { nb.join(); } catch {} try { wantContent(); } catch {} onPeer(remote); };
    ch.onmessage = async (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (onContent(m)) return; try { await nb.onMessage(m); } catch {} if (m && m.t === "ad4m:links") { try { wantContent(); } catch {} } };
    ch.onclose = () => { onState({ phase: "peer-left", peer: remote, peers: openPeers() }); };
  }
  function openPeers() { let n = 0; for (const e of conns.values()) if (e.ch && e.ch.readyState === "open") n++; return n; }

  // deterministic initiator: the GREATER transport id offers (and creates the channel); the other answers. No glare.
  const iInitiate = (remote) => peerId > remote;

  async function offerTo(remote) {
    if (conns.has(remote)) return;
    const pc = new RTCPeerConnection({ iceServers: ICE }); conns.set(remote, { pc });
    const ch = pc.createDataChannel("nb"); bindChannel(remote, ch);
    pc.onicecandidate = (ev) => { if (ev.candidate) sig.post({ to: remote, kind: "ice", data: ev.candidate }); };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    sig.post({ to: remote, kind: "offer", data: offer });
  }
  async function onOffer(remote, sdp) {
    let e = conns.get(remote);
    if (!e) { const pc = new RTCPeerConnection({ iceServers: ICE }); e = { pc }; conns.set(remote, e); pc.ondatachannel = (ev) => bindChannel(remote, ev.channel); pc.onicecandidate = (iev) => { if (iev.candidate) sig.post({ to: remote, kind: "ice", data: iev.candidate }); }; }
    try { await e.pc.setRemoteDescription(sdp); const ans = await e.pc.createAnswer(); await e.pc.setLocalDescription(ans); sig.post({ to: remote, kind: "answer", data: ans }); } catch {}
  }

  const sig = _connect(base, room, peerId, async (d) => {
    if (d.kind === "ready" && Array.isArray(d.peers)) { for (const p of d.peers) if (iInitiate(p)) offerTo(p); }
    else if (d.kind === "peer-join" && d.from) { if (iInitiate(d.from)) offerTo(d.from); }
    else if (d.kind === "offer" && d.from && d.data) { await onOffer(d.from, d.data); }
    else if (d.kind === "answer" && d.from && d.data) { const e = conns.get(d.from); if (e && e.pc) try { await e.pc.setRemoteDescription(d.data); } catch {} }
    else if (d.kind === "ice" && d.from && d.data) { const e = conns.get(d.from); if (e && e.pc) try { await e.pc.addIceCandidate(d.data); } catch {} }
    else if (d.kind === "peer-leave" && d.from) { const e = conns.get(d.from); if (e) { try { e.pc && e.pc.close(); } catch {} conns.delete(d.from); onState({ phase: "peer-left", peer: d.from, peers: openPeers() }); } }
  });
  onState({ phase: "connecting", room });

  return {
    nb,
    sync: () => { try { nb.publish(); } catch {} return { peers: openPeers(), links: nb.sharedLinks().length, members: nb.members().length }; },
    peers: openPeers,
    join: () => { try { nb.join(); } catch {} },
    close: () => { for (const e of conns.values()) try { e.pc && e.pc.close(); } catch {} conns.clear(); sig.close(); onState({ phase: "closed" }); },
  };
}

// browser convenience: window.HoloNeighbourhood.attachRTC(perspective, me, { room, signal, self })
if (typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined") {
  window.HoloNeighbourhood = Object.assign(window.HoloNeighbourhood || {}, {
    attachRTC(perspective, me, opts = {}) { return attachNeighbourhoodRTC({ perspective, me, ...opts }); },
  });
}

export default { attachNeighbourhoodRTC };
