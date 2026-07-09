// holo-call-mesh.mjs - group calls: an N-peer WebRTC MESH over the together-signal relay. Adapted from the Player's
// working reaction-camera mesh (apps/player/holo-watch.js) but on the shared `/signal` relay and the kind:"meet" κ-link,
// so a room is joinable in any browser (off-Hologram). Each peer holds one RTCPeerConnection to EVERY other peer; both
// sides use WebRTC "perfect negotiation" (polite = me<other by id) so they can both offer without glare. Media is E2E
// P2P (DTLS-SRTP); the relay only shuttles SDP/ICE. Mesh is fine to ~6 peers; beyond that an SFU forwards (MEET-E seam).

import * as Together from "./holo-together.mjs";

const ICE = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
const _rid = () => "m" + Math.random().toString(36).slice(2, 10);

// ── link layer (kind:"meet") ──
export async function createMeet({ hostName = "", video = true, ttlSeconds = 8 * 3600, signal = null, room = null } = {}) {
  return Together.createSession({ kind: "meet", hostName, capability: "control", content: video ? "video" : "audio", signal, room, ttlSeconds });
}
export function buildMeetLink(intent, opts = {}) { return Together.buildLink(intent, { viewPath: "/apps/holo-messenger/together-view.html", ...opts }); }
export function parseMeet(input) { return Together.parseSession(input); }
export function describeMeet(intent) { return { video: intent.content === "video", host: intent.hostName || "Someone", headline: (intent.hostName || "Someone") + "'s room" }; }

function _connect(base, room, peer, onMsg) {
  const es = new EventSource(`${base}/signal?room=${encodeURIComponent(room)}&peer=${encodeURIComponent(peer)}`);
  es.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch { return; } onMsg(d); };
  const post = (obj) => { try { fetch(`${base}/signal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, from: peer, ...obj }) }); } catch {} };
  return { post, close: () => { try { es.close(); } catch {} } };
}

// Join the meeting mesh with your local `media`. Returns controls + emits per-participant streams.
export async function joinMesh(intent, { media = null, displayName = "", onParticipant = () => {}, onParticipantLeave = () => {}, onState = () => {}, onActiveSpeaker = () => {} } = {}) {
  const base = intent.signal || (typeof location !== "undefined" ? location.origin : "");
  const room = intent.room, me = _rid();
  const peers = new Map();   // other → { pc, makingOffer, ignoreOffer, polite, stream }
  let left = false;

  const sig = _connect(base, room, me, async (d) => {
    if (left) return;
    if (d.kind === "ready") { for (const p of (d.peers || [])) ensure(p); }
    else if (d.kind === "peer-join") ensure(d.from);
    else if (d.kind === "peer-leave") drop(d.from);
    else if (d.kind === "bye") drop(d.from);
    // ensure on signal receipt too - with simultaneous joins an offer can arrive BEFORE peer-join; dropping it would
    // deadlock (both sides offered, neither applied). Perfect negotiation resolves the resulting glare.
    else if (d.kind === "sdp" && d.from && d.from !== me) { ensure(d.from); onSignal(d.from, { sdp: d.data }); }
    else if (d.kind === "ice" && d.from && d.from !== me) { ensure(d.from); onSignal(d.from, { ice: d.data }); }
  });

  function ensure(other) {
    if (other === me || peers.has(other) || left) return;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const st = { pc, makingOffer: false, ignoreOffer: false, polite: me < other, stream: null };
    peers.set(other, st);
    if (media) for (const t of media.getTracks()) pc.addTrack(t, media);
    pc.ontrack = ({ streams }) => { if (streams && streams[0]) { st.stream = streams[0]; onParticipant(other, streams[0]); } };
    pc.onnegotiationneeded = async () => { try { st.makingOffer = true; await pc.setLocalDescription(); sig.post({ to: other, kind: "sdp", data: pc.localDescription }); } catch {} finally { st.makingOffer = false; } };
    pc.onicecandidate = ({ candidate }) => { if (candidate) sig.post({ to: other, kind: "ice", data: candidate }); };
    pc.onconnectionstatechange = () => { onState({ peer: other, state: pc.connectionState }); };
  }
  async function onSignal(other, d) {
    const st = peers.get(other); if (!st) return; const pc = st.pc;
    try {
      if (d.sdp) {
        const collision = d.sdp.type === "offer" && (st.makingOffer || pc.signalingState !== "stable");
        st.ignoreOffer = !st.polite && collision; if (st.ignoreOffer) return;
        await pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === "offer") { await pc.setLocalDescription(); sig.post({ to: other, kind: "sdp", data: pc.localDescription }); }
      } else if (d.ice) { try { await pc.addIceCandidate(d.ice); } catch (e) { if (!st.ignoreOffer) throw e; } }
    } catch {}
  }
  function drop(other) { const st = peers.get(other); if (!st) return; try { st.pc.close(); } catch {} peers.delete(other); analysers.delete(other); onParticipantLeave(other); }

  // active-speaker: RMS of each remote stream via an AudioContext analyser; loudest above a floor wins.
  let ac = null, asTimer = null, lastAS = null; const analysers = new Map();
  function startActiveSpeaker() {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); ac.resume && ac.resume(); } catch { return; }
    asTimer = setInterval(() => {
      let best = null, bestLvl = 0;
      for (const [other, st] of peers) {
        if (!st.stream || !st.stream.getAudioTracks().length) continue;
        let an = analysers.get(other);
        if (!an) { try { const src = ac.createMediaStreamSource(st.stream); an = ac.createAnalyser(); an.fftSize = 256; src.connect(an); analysers.set(other, an); } catch { continue; } }
        const buf = new Uint8Array(an.frequencyBinCount); an.getByteTimeDomainData(buf);
        let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        const rms = Math.sqrt(sum / buf.length);
        if (rms > bestLvl) { bestLvl = rms; best = other; }
      }
      if (best && bestLvl > 0.012 && best !== lastAS) { lastAS = best; onActiveSpeaker(best); }
    }, 400);
  }
  if (typeof window !== "undefined") startActiveSpeaker();

  onState({ phase: "connecting" });
  return {
    me,
    participants: () => [...peers.keys()],
    count: () => peers.size,
    mute(on) { if (media) media.getAudioTracks().forEach((t) => (t.enabled = !on)); },
    setCamera(on) { if (media) media.getVideoTracks().forEach((t) => (t.enabled = on)); },
    streamOf: (other) => { const st = peers.get(other); return st ? st.stream : null; },
    leave() { left = true; try { sig.post({ kind: "bye" }); } catch {} try { clearInterval(asTimer); } catch {} for (const [, st] of peers) { try { st.pc.close(); } catch {} } peers.clear(); try { sig.close(); } catch {} try { ac && ac.close(); } catch {} onState({ phase: "ended" }); },
  };
}
