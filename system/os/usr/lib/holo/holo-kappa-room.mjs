// holo-kappa-room.mjs — the co-view ROOM: viewers of ONE projected surface form a swarm.
//
// Each viewer reconstructs tiles into its selfStore (becoming a holder). The room lets a viewer ask the others
// "who has blake3 X?" and serve the tiles it holds to whoever asks — so viewer #2 pulls tiles from viewer #1
// instead of the origin, and the origin (the host) uploads each novel tile ~once. Presence-gated: a lone viewer
// never queries the room (no latency tax) — it only asks peers once it knows peers exist.
//
// joinRoom(key, selfStore, opts?) → { peer, stats, leave } — `peer` plugs straight into the swarm resolver
// (window.__holoOsrPeers = [room.peer]). Cross-tab today via BroadcastChannel; the SAME tiny protocol
// (hello/hi · req/res) runs over a WebRTC mesh for cross-device — inject `opts.channel` (a {postMessage,onmessage}).
//
// Safety note: the room moves BYTES, but trust is the swarm's job — every served tile is L5-re-derived by the
// receiver (admit / swarmGet) before paint. A lying peer is refused; the room needs no trust.

export function joinRoom(key, selfStore, { channel, timeoutMs = 200 } = {}) {
  // TRANSPORT-AGNOSTIC: a BroadcastChannel (cross-tab) OR any { send, onMessage } transport (a WebRTC DataChannel
  // for cross-DEVICE — holo-canvas-transport's makeRTCTransport / a dial channel). Same hello/hi · req/res protocol.
  const bc = channel || new BroadcastChannel("holo-osr-room-" + key);
  const isTransport = typeof bc.onMessage === "function" && typeof bc.send === "function";
  const post = (m) => { try { isTransport ? bc.send(m) : (bc.postMessage ? bc.postMessage(m) : bc.send(m)); } catch (e) {} };
  const myId = "v" + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
  const members = new Set();                      // other viewers we've seen
  const memberHoldings = new Map();               // id → Set<b3> : which tiles each member ADVERTISES (real has())
  const latency = new Map();                      // id → EMA ms (measured req→res RTT) : nearest-first picking
  const waiting = new Map();                      // "b3|holderId" → { finish, t0 } for our in-flight requests
  const EMPTY = new Set();
  const stats = { members: 0, servedTiles: 0, servedBytes: 0, gotFromPeer: 0, asked: 0, wire: isTransport ? "rtc" : "broadcast" };
  const toU8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));
  const seeMember = (id, holds) => { members.add(id); stats.members = members.size; if (Array.isArray(holds)) memberHoldings.set(id, new Set(holds)); else if (!memberHoldings.has(id)) memberHoldings.set(id, new Set()); };

  const handle = (d) => {                          // d is the raw message OBJECT (normalized across transports)
    if (!d) return;
    if (d.hello && d.hello !== myId) { seeMember(d.hello); post({ hi: myId, to: d.hello, holds: [...selfStore.keys()] }); return; }  // reply WITH my holdings
    if (d.hi && d.to === myId) { seeMember(d.hi, d.holds); return; }
    if (d.hold && d.from !== myId) { let s = memberHoldings.get(d.from); if (!s) memberHoldings.set(d.from, (s = new Set())); s.add(d.hold); return; }
    if (d.bye) { members.delete(d.bye); memberHoldings.delete(d.bye); latency.delete(d.bye); stats.members = members.size; return; }
    if (d.req && d.from !== myId && (!d.to || d.to === myId)) {   // a peer wants a tile (broadcast or targeted at us) — serve iff held
      const bytes = selfStore.get(d.req);
      if (bytes) { stats.servedTiles++; stats.servedBytes += bytes.length; post({ res: d.req, bytes, to: d.from, from: myId }); }
      return;
    }
    if (d.res && d.to === myId) {                  // a response to OUR request — measure RTT, resolve
      const w = waiting.get(d.res + "|" + d.from) || waiting.get(d.res + "|null");
      if (w) { stats.gotFromPeer++; const rtt = Math.max(1, Date.now() - w.t0); latency.set(d.from, latency.has(d.from) ? latency.get(d.from) * 0.7 + rtt * 0.3 : rtt); w.finish(toU8(d.bytes)); }
    }
  };
  if (isTransport) bc.onMessage((m) => handle(m));
  else if (bc.addEventListener) bc.addEventListener("message", (e) => handle(e.data));
  else bc.onmessage = (e) => handle(e.data);
  const announce = () => post({ hello: myId });    // announce; existing members reply { hi, holds }
  if (isTransport && bc.ready && bc.ready.then) bc.ready.then(announce); else announce();   // RTC: wait for the channel

  function requestFrom(id, b3) {                   // ask a SPECIFIC holder (id) — or broadcast (id=null)
    return new Promise((resolve) => {
      const rk = b3 + "|" + (id == null ? "null" : id); let done = false;
      const finish = (v) => { if (done) return; done = true; clearTimeout(t); if (waiting.get(rk) === entry) waiting.delete(rk); resolve(v); };
      const entry = { finish, t0: Date.now() }; waiting.set(rk, entry);
      const t = setTimeout(() => finish(null), timeoutMs);   // no answer in time → swarm falls to the next holder / origin
      stats.asked++; post({ req: b3, from: myId, to: id });
    });
  }

  // advertise a newly-held tile so other viewers can pull it from us (wired from the swarm's onHold)
  const advertise = (b3) => { if (members.size) post({ hold: b3, from: myId }); };
  // PER-MEMBER peers for the resolver's piece-picking: REAL has() (advertised holdings) + measured latency.
  const peers = () => [...members].map((id) => ({ id, has: (b3) => (memberHoldings.get(id) || EMPTY).has(b3), get: (b3) => requestFrom(id, b3), latency: latency.get(id) }));
  // legacy single virtual peer (optimistic broadcast) — kept for callers wanting one peer.
  const peer = { has: () => members.size > 0, get: (b3) => requestFrom(null, b3) };
  const leave = () => { post({ bye: myId }); try { bc.close && bc.close(); } catch (e) {} };
  if (typeof window !== "undefined") window.addEventListener?.("pagehide", leave);
  return { peer, peers, advertise, stats, leave, myId, members, memberHoldings, latency };
}

export default { joinRoom };
