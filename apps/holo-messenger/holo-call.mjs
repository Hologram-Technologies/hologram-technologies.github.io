// holo-call.mjs - Holo Calls: 1:1 (and, later, group) voice/video over the SAME together-signal relay as Together.
//
// Unlike Together's one-host→many-viewer star, a call is SYMMETRIC: both peers send AND receive media. We use WebRTC
// "perfect negotiation" (polite/impolite by peer id) so the two sides can both try to offer without glare. Media is
// E2E P2P (DTLS-SRTP); the relay only shuttles SDP/ICE and never sees audio or video. The call is also a κ-link (built
// on holo-together.mjs) so it can travel as a message to a bridged contact and open in any browser (together-view.html — the one verified off-Hologram viewer).

import * as Together from "./holo-together.mjs";

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
const _rid = () => "c" + Math.random().toString(36).slice(2, 10);

// ── link layer (kind:"call") ──────────────────────────────────────────────────────────────────────────────────────
export async function createCall({ callerName = "", video = false, ttlSeconds = 3600, signal = null, room = null } = {}) {
  // content carries the modality ("audio"|"video"); capability "control" = a real participant (vs a view-only guest)
  return Together.createSession({ kind: "call", hostName: callerName, capability: "control", content: video ? "video" : "audio", signal, room, ttlSeconds });
}
export function buildCallLink(intent, opts = {}) { return Together.buildLink(intent, { viewPath: "/apps/holo-messenger/together-view.html", ...opts }); }
export function parseCall(input) { return Together.parseSession(input); }
export function describeCall(intent) { return { video: intent.content === "video", caller: intent.hostName || "Someone", headline: (intent.hostName || "Someone") + " is calling", verb: intent.content === "video" ? "Video call" : "Voice call" }; }
// SYNC detector for an incoming-call link in a message body → { intent, url } | null (ring on a FRESH one).
const _CALL_RE = /(\S*call-view\.html#([A-Za-z0-9_-]+))|(holo:\/\/together\/\S*#([A-Za-z0-9_-]+))/;
export function callLinkInText(text) {
  const m = String(text || "").match(_CALL_RE); if (!m) return null;
  const payload = m[2] || m[4], url = m[0];
  try { const it = JSON.parse(decodeURIComponent(escape(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))))); if (it && it.kind === "call" && it.room) return { intent: it, url, payload }; } catch {}
  return null;
}

// ── symmetric perfect-negotiation peer ────────────────────────────────────────────────────────────────────────────
function _connect(base, room, peer, onMsg) {
  const es = new EventSource(`${base}/signal?room=${encodeURIComponent(room)}&peer=${encodeURIComponent(peer)}`);
  es.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch { return; } onMsg(d); };
  const post = (obj) => { try { fetch(`${base}/signal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, from: peer, ...obj }) }); } catch {} };
  return { post, close: () => { try { es.close(); } catch {} } };
}

function _makePeer(post, other, polite, localStream, onRemoteStream, onState) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  let makingOffer = false, ignoreOffer = false;
  if (localStream) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  pc.ontrack = ({ streams }) => { if (streams && streams[0]) onRemoteStream(streams[0]); };
  pc.onnegotiationneeded = async () => { try { makingOffer = true; await pc.setLocalDescription(); post({ to: other, kind: "sdp", data: pc.localDescription }); } catch {} finally { makingOffer = false; } };
  pc.onicecandidate = ({ candidate }) => { if (candidate) post({ to: other, kind: "ice", data: candidate }); };
  pc.onconnectionstatechange = () => onState(pc.connectionState);
  async function onSignal(d) {
    try {
      if (d.sdp) {
        const collision = d.sdp.type === "offer" && (makingOffer || pc.signalingState !== "stable");
        ignoreOffer = !polite && collision;
        if (ignoreOffer) return;
        await pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === "offer") { await pc.setLocalDescription(); post({ to: other, kind: "sdp", data: pc.localDescription }); }
      } else if (d.ice) { try { await pc.addIceCandidate(d.ice); } catch (e) { if (!ignoreOffer) throw e; } }
    } catch {}
  }
  return { pc, onSignal, close: () => { try { pc.close(); } catch {} } };
}

// Join a call room with your local `media` (a MediaStream from getUserMedia or synthetic). Symmetric: caller and callee
// both call this - the caller after minting+sending the link, the callee on ACCEPT. Returns controls.
export async function joinCall(intent, { media = null, onState = () => {}, onRemoteStream = () => {}, onPeer = () => {} } = {}) {
  const base = intent.signal || (typeof location !== "undefined" ? location.origin : "");
  const room = intent.room, me = _rid();
  let peer = null, otherId = null, ended = false;
  const sig = _connect(base, room, me, async (d) => {
    if (ended) return;
    if (d.kind === "ready") { for (const p of (d.peers || [])) ensurePeer(p); }
    else if (d.kind === "peer-join") ensurePeer(d.from);
    else if (d.kind === "peer-leave" && d.from === otherId) end("ended");
    else if (d.kind === "bye" && d.from === otherId) end("ended");
    else if (d.kind === "sdp" && d.from === otherId && peer) peer.onSignal({ sdp: d.data });
    else if (d.kind === "ice" && d.from === otherId && peer) peer.onSignal({ ice: d.data });
  });
  function ensurePeer(other) {
    if (peer || ended) return;
    otherId = other;
    peer = _makePeer((msg) => sig.post(msg), other, me < other /* polite */, media, onRemoteStream, (cs) => onState({ phase: cs }));
    onPeer(other);
  }
  function end(reason) { if (ended) return; ended = true; try { peer && peer.close(); } catch {} try { sig.close(); } catch {} onState({ phase: reason || "ended" }); }
  onState({ phase: "connecting" });
  return {
    me,
    hangup() { try { sig.post({ kind: "bye" }); } catch {} end("ended"); },
    mute(on) { if (media) media.getAudioTracks().forEach((t) => (t.enabled = !on)); },
    setCamera(on) { if (media) media.getVideoTracks().forEach((t) => (t.enabled = on)); },
    peers: () => (peer ? 1 : 0),
    _pc: () => (peer ? peer.pc : null),
  };
}
