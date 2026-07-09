// holo-together-rtc.mjs - installs window.HoloTogether (host + join) using the together-signal relay + STANDARD WebRTC.
// Off-Hologram-safe: pure browser APIs (RTCPeerConnection, EventSource, fetch, getDisplayMedia) - a plain Chrome tab
// hosts or views with no install. The relay (together-signal) only swaps offer/answer/ICE; media is direct P2P + E2E.
// One host → many viewers (a fresh RTCPeerConnection per viewer). View-only by default: viewers receive, never send.
//
// Drives holo-together.mjs's getMesh()/joinSession()/hostSession() - when this is installed, mode === "live".

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
const _rid = () => "p" + Math.random().toString(36).slice(2, 10);
function _base(intent) { return (intent && intent.signal) || (typeof location !== "undefined" ? location.origin : ""); }

// open the relay SSE for (room, peer); returns { post, close }
function _connect(base, room, peer, onMsg) {
  const es = new EventSource(`${base}/signal?room=${encodeURIComponent(room)}&peer=${encodeURIComponent(peer)}`);
  es.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch { return; } onMsg(d); };
  const post = (obj) => { try { fetch(`${base}/signal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, from: peer, ...obj }) }); } catch {} };
  return { post, close: () => { try { es.close(); } catch {} } };
}

// HOST: publish `stream` (or capture the screen) AND/OR a control channel to whoever joins. `control:true` = no media
// (watch-together: each peer loads the same content locally, synced over the "ctl" datachannel) → no screen prompt.
// Returns { stop, peers(), broadcast(msg) } - broadcast pushes a control message to every connected viewer.
export async function host({ room, stream = null, control = false, onState = () => {}, onControl = () => {}, signal = null } = {}) {
  const base = signal || (typeof location !== "undefined" ? location.origin : "");
  const me = _rid();
  let media = stream;
  if (!media && !control) { try { media = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }); } catch (e) { onState({ phase: "error", detail: "Screen share was declined." }); return { ok: false, error: "no-stream" }; } }
  const pcs = new Map();        // viewerPeerId → RTCPeerConnection
  const channels = new Map();   // viewerPeerId → RTCDataChannel("ctl")
  const sig = _connect(base, room, me, async (d) => {
    if (d.kind === "peer-join" || (d.kind === "ready" && d.peers)) {
      const targets = d.kind === "peer-join" ? [d.from] : d.peers;
      for (const t of targets) { if (pcs.has(t)) continue; await _offerTo(t); }
    } else if (d.kind === "answer" && d.from && pcs.has(d.from)) { try { await pcs.get(d.from).setRemoteDescription(d.data); } catch {} }
    else if (d.kind === "ice" && d.from && pcs.has(d.from) && d.data) { try { await pcs.get(d.from).addIceCandidate(d.data); } catch {} }
    else if (d.kind === "peer-leave" && pcs.has(d.from)) { try { pcs.get(d.from).close(); } catch {} pcs.delete(d.from); channels.delete(d.from); onState({ phase: "peers", count: pcs.size }); }
  });
  async function _offerTo(viewer) {
    const pc = new RTCPeerConnection({ iceServers: ICE }); pcs.set(viewer, pc);
    const ch = pc.createDataChannel("ctl");   // the sync/control channel - always present
    ch._q = [];                               // messages queued before the channel opens (else they'd be lost - fatal for doc ops, which have no heartbeat)
    ch.onopen = () => { onState({ phase: "peers", count: pcs.size }); const q = ch._q; ch._q = []; for (const s of q) try { ch.send(s); } catch {} };
    ch.onmessage = (e) => { try { onControl(JSON.parse(e.data), viewer); } catch {} };
    channels.set(viewer, ch);
    if (media) for (const track of media.getTracks()) pc.addTrack(track, media);
    pc.onicecandidate = (e) => { if (e.candidate) sig.post({ to: viewer, kind: "ice", data: e.candidate }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "connected") onState({ phase: "peers", count: pcs.size }); };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    sig.post({ to: viewer, kind: "offer", data: offer });
  }
  onState({ phase: "hosting", count: 0 });
  if (media) media.getVideoTracks().forEach((t) => t.addEventListener("ended", () => stop()));   // user stops sharing → end
  function broadcast(msg) { const s = JSON.stringify(msg); for (const [, ch] of channels) { if (ch.readyState === "open") { try { ch.send(s); } catch {} } else (ch._q || (ch._q = [])).push(s); } }
  // per-viewer send — request/response users (peer egress) answer ONE peer; broadcast would leak the reply to the room.
  function send(viewer, msg) { const ch = channels.get(viewer); if (!ch) return false; const s = JSON.stringify(msg); if (ch.readyState === "open") { try { ch.send(s); } catch { return false; } } else (ch._q || (ch._q = [])).push(s); return true; }
  function stop() { for (const [, pc] of pcs) try { pc.close(); } catch {} pcs.clear(); channels.clear(); try { if (media && !stream) media.getTracks().forEach((t) => t.stop()); } catch {} sig.close(); onState({ phase: "ended" }); }
  return { ok: true, live: true, stop, peers: () => pcs.size, broadcast, send };
}

// JOIN (view-only): receive the host's stream + control channel. Returns { leave, send(msg) }.
export async function join({ room, onState = () => {}, onControl = () => {}, signal = null } = {}) {
  const base = signal || (typeof location !== "undefined" ? location.origin : "");
  const me = _rid();
  let pc = null, host = null, ctl = null;
  const _sendQ = [];   // queued until the ctl channel opens (a doc op / doc-hello sent too early would otherwise be lost)
  const sig = _connect(base, room, me, async (d) => {
    if (d.kind === "offer" && d.from) {
      host = d.from;
      pc = new RTCPeerConnection({ iceServers: ICE });
      pc.ontrack = (e) => { onState({ phase: "connected", stream: e.streams[0] }); };
      pc.ondatachannel = (e) => { ctl = e.channel; ctl.onopen = () => { onState({ phase: "channel" }); const q = _sendQ.splice(0); for (const s of q) try { ctl.send(s); } catch {} }; ctl.onmessage = (ev) => { try { onControl(JSON.parse(ev.data)); } catch {} }; };
      pc.onicecandidate = (e) => { if (e.candidate) sig.post({ to: host, kind: "ice", data: e.candidate }); };
      pc.onconnectionstatechange = () => { if (pc.connectionState === "connected") onState({ phase: "connected-pc" }); if (pc.connectionState === "failed" || pc.connectionState === "disconnected") onState({ phase: "error", detail: "Connection lost." }); };
      try { await pc.setRemoteDescription(d.data); const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); sig.post({ to: host, kind: "answer", data: ans }); }
      catch (e) { onState({ phase: "error", detail: String(e && e.message || e) }); }
    } else if (d.kind === "ice" && d.from === host && pc && d.data) { try { await pc.addIceCandidate(d.data); } catch {} }
    else if (d.kind === "peer-leave" && d.from === host) { onState({ phase: "ended" }); try { pc && pc.close(); } catch {} }
  });
  onState({ phase: "connecting" });
  function send(msg) { const s = JSON.stringify(msg); if (ctl && ctl.readyState === "open") { try { ctl.send(s); } catch {} } else _sendQ.push(s); }
  function leave() { try { pc && pc.close(); } catch {} sig.close(); }
  return { ok: true, live: true, leave, send };
}

export function installTogetherMesh() {
  if (typeof window === "undefined" || typeof RTCPeerConnection === "undefined") return false;
  if (window.HoloTogether && (window.HoloTogether.host || window.HoloTogether.join)) return true;
  window.HoloTogether = Object.assign(window.HoloTogether || {}, {
    live: true,
    host: (opts) => host(opts),
    join: (opts) => join(opts),
  });
  return true;
}
// auto-install when imported in a browser
try { installTogetherMesh(); } catch {}
