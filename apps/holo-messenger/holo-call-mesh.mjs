// holo-call-mesh.mjs - group calls: an N-peer WebRTC MESH over the together-signal relay. Adapted from the Player's
// working reaction-camera mesh (apps/player/holo-watch.js) but on the shared `/signal` relay and the kind:"meet" κ-link,
// so a room is joinable in any browser (off-Hologram). Each peer holds one RTCPeerConnection to EVERY other peer; both
// sides use WebRTC "perfect negotiation" (polite = me<other by id) so they can both offer without glare. Media is E2E
// P2P (DTLS-SRTP); the relay only shuttles SDP/ICE. Mesh is fine to ~6 peers; beyond that an SFU forwards (MEET-E seam).

import * as Together from "./holo-together.mjs";
import { openSignal, tunePeer } from "./holo-call.mjs?v=930599a2417d";   // THE ONE SIGNAL DOOR — origin /signal on desktop, sealed Nostr rendezvous on hosted static; ?v matches app.mjs's pin so the SW serves ONE fresh copy, never a stale bare-URL cache hit

import { createBlurEffect } from "./holo-stream-effects.mjs";   // J1: lifted Jitsi background blur (segmentation to canvas composite), pure client, runs on the local camera before the mesh

const ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turns:openrelay.metered.ca:443"], username: "openrelayproject", credential: "openrelayproject" },
];
const _rid = () => "m" + Math.random().toString(36).slice(2, 10);

// ── link layer (kind:"meet") ──
export async function createMeet({ hostName = "", video = true, title = "", ttlSeconds = 8 * 3600, signal = null, room = null } = {}) {
  return Together.createSession({ kind: "meet", title, hostName, capability: "control", content: video ? "video" : "audio", signal, room, ttlSeconds });
}
// call-view.html = the participant page (lobby → grid, any browser). NEW path so no SW serves it stale; anchored to
// this module's own URL (normalization-proof across /Q → /hologram-os → root).
const _VIEW_URL = (() => { try { return new URL("./call-view.html", import.meta.url).pathname; } catch { return "/apps/holo-messenger/call-view.html"; } })();
export function buildMeetLink(intent, opts = {}) { return Together.buildLink(intent, { viewPath: _VIEW_URL, ...opts }); }
export function parseMeet(input) { return Together.parseSession(input); }
export function describeMeet(intent) { return { video: intent.content === "video", host: intent.hostName || "Someone", headline: intent.title || ((intent.hostName || "Someone") + "'s room") }; }
// SYNC detector for a GROUP-call link in a message body (the meet twin of holo-call.callLinkInText — same URL shapes,
// the decoded payload's kind==="meet" is the real gate, so a watch/doc together link never rings a group call).
const _MEET_RE = /(\S*(?:call|together)-view\.html#([A-Za-z0-9_-]+))|(holo:\/\/together\/\S*#([A-Za-z0-9_-]+))/;
export function meetLinkInText(text) {
  const m = String(text || "").match(_MEET_RE); if (!m) return null;
  const payload = m[2] || m[4], url = m[0];
  try { const it = JSON.parse(decodeURIComponent(escape(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))))); if (it && it.kind === "meet" && it.room) return { intent: it, url, payload }; } catch {}
  return null;
}

// (the per-module EventSource _connect was deleted — the mesh now signals through holo-call's shared openSignal,
//  so 1:1 calls and group meets ride ONE transport: /signal on an origin, the sealed Nostr rendezvous on hosted static)

// Join the meeting mesh with your local `media`. Returns controls + emits per-participant streams.
export async function joinMesh(intent, { media = null, displayName = "", onParticipant = () => {}, onParticipantLeave = () => {}, onState = () => {}, onActiveSpeaker = () => {}, onName = () => {} } = {}) {
  const base = intent.signal || (typeof location !== "undefined" ? location.origin : "");
  const room = intent.room, me = _rid();
  const peers = new Map();   // other → { pc, makingOffer, ignoreOffer, polite, stream }
  const names = new Map();   // other → display name (rides the sealed signal, never the media path)
  let left = false;

  // QUALITY, mesh-aware: every peer costs an uplink copy, so the per-peer video cap scales down as the room grows —
  // total uplink stays ~constant (≈2.5 Mbps) and nobody's connection melts. Retuned on every join/leave.
  const _vCap = () => { const n = Math.max(1, peers.size); return n <= 1 ? 2500 : n <= 3 ? 1200 : n <= 5 ? 800 : 500; };
  function retune() { const kbps = _vCap(); for (const [, st] of peers) tunePeer(st.pc, { videoKbps: kbps }); }

  const sig = await openSignal(base, room, me, async (d) => {
    if (left) return;
    if (d.kind === "ready") { for (const p of (d.peers || [])) ensure(p); }
    else if (d.kind === "peer-join") ensure(d.from);
    else if (d.kind === "peer-leave") drop(d.from);
    else if (d.kind === "bye") drop(d.from);
    else if (d.kind === "name" && d.from && d.from !== me) { if (d.name && names.get(d.from) !== d.name) { names.set(d.from, String(d.name).slice(0, 40)); onName(d.from, names.get(d.from)); } }
    // ensure on signal receipt too - with simultaneous joins an offer can arrive BEFORE peer-join; dropping it would
    // deadlock (both sides offered, neither applied). Perfect negotiation resolves the resulting glare.
    else if (d.kind === "sdp" && d.from && d.from !== me) { ensure(d.from); onSignal(d.from, { sdp: d.data }); }
    else if (d.kind === "ice" && d.from && d.from !== me) { ensure(d.from); onSignal(d.from, { ice: d.data }); }
  });
  const sayName = () => { if (displayName) { try { sig.post({ kind: "name", name: String(displayName).slice(0, 40) }); } catch {} } };
  sayName();   // introduce yourself; re-said whenever a NEW peer appears so late joiners always learn every name

  // ── RESILIENCE: a call must SURVIVE a network change (Wi-Fi↔cellular on a phone), not freeze. When a peer's
  // ICE dies, restartIce() re-gathers candidates on the new network → onnegotiationneeded fires a fresh offer
  // (perfect negotiation resolves the glare of both sides restarting). "disconnected" is often transient so we
  // wait a beat; "failed" restarts now. A `connection.change` handoff proactively restarts every peer.
  function scheduleRestart(other, st, delay) {
    if (left || !peers.has(other)) return;
    clearTimeout(st.reT);
    st.reT = setTimeout(() => {
      if (left || !peers.has(other)) return;
      const cs = st.pc.connectionState, ics = st.pc.iceConnectionState;
      if (cs === "connected" || cs === "completed" || ics === "connected" || ics === "completed") return;   // recovered on its own
      try { st.pc.restartIce(); } catch {}
    }, delay);
  }
  let _netHook = null;
  try { const conn = navigator.connection; if (conn && conn.addEventListener) { _netHook = () => { for (const [other, st] of peers) scheduleRestart(other, st, 200); }; conn.addEventListener("change", _netHook); } } catch {}

  function ensure(other) {
    if (other === me || peers.has(other) || left) return;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const st = { pc, makingOffer: false, ignoreOffer: false, polite: me < other, stream: null };
    peers.set(other, st);
    sayName();
    if (media) for (const t of media.getTracks()) pc.addTrack(t, media);
    pc.ontrack = ({ streams }) => { if (streams && streams[0]) { st.stream = streams[0]; onParticipant(other, streams[0], names.get(other) || null); } };
    pc.onnegotiationneeded = async () => { try { st.makingOffer = true; await pc.setLocalDescription(); sig.post({ to: other, kind: "sdp", data: pc.localDescription }); } catch {} finally { st.makingOffer = false; } };
    pc.onicecandidate = ({ candidate }) => { if (candidate) sig.post({ to: other, kind: "ice", data: candidate }); };
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "failed") { onState({ peer: other, state: "reconnecting" }); scheduleRestart(other, st, 300); }
      else if (s === "disconnected") { onState({ peer: other, state: "reconnecting" }); scheduleRestart(other, st, 2500); }
      else if (s === "connected" || s === "completed") { onState({ peer: other, state: "connected" }); }
    };
    pc.onconnectionstatechange = () => {
      const cs = pc.connectionState;
      if (cs === "connected") { retune(); onState({ peer: other, state: "connected" }); }
      else if (cs === "failed") { onState({ peer: other, state: "reconnecting" }); scheduleRestart(other, st, 300); }
      else onState({ peer: other, state: cs });
    };
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
  function drop(other) { const st = peers.get(other); if (!st) return; try { clearTimeout(st.reT); } catch {} try { st.pc.close(); } catch {} peers.delete(other); names.delete(other); analysers.delete(other); onParticipantLeave(other); retune(); }

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
    nameOf: (other) => names.get(other) || null,
    mute(on) { if (media) media.getAudioTracks().forEach((t) => (t.enabled = !on)); },
    setCamera(on) { if (media) media.getVideoTracks().forEach((t) => (t.enabled = on)); },
    // swap the outgoing VIDEO track on every peer without renegotiation (replaceTrack is seamless) and keep
    // the local `media` object consistent. camera flip stops the old track (stopOld); screen share KEEPS the
    // camera alive (stopOld=false) so it can be restored when presenting ends.
    async replaceVideoTrack(track, stopOld = true) {
      if (!track) return;
      for (const [, st] of peers) { const s = st.pc.getSenders().find((x) => x.track && x.track.kind === "video"); if (s) { try { await s.replaceTrack(track); } catch {} } }
      if (media) { const old = media.getVideoTracks()[0]; if (old && old !== track) { try { media.removeTrack(old); if (stopOld) old.stop(); } catch {} } try { media.addTrack(track); } catch {} }
    },
    streamOf: (other) => { const st = peers.get(other); return st ? st.stream : null; },
    _pcs: () => [...peers.values()].map((st) => st.pc),   // debug/witness: the raw peer connections (bitrate-cap gate)
    leave() { left = true; try { sig.post({ kind: "bye" }); } catch {} try { clearInterval(asTimer); } catch {} try { if (_netHook && navigator.connection) navigator.connection.removeEventListener("change", _netHook); } catch {} for (const [, st] of peers) { try { clearTimeout(st.reT); } catch {} try { st.pc.close(); } catch {} } peers.clear(); try { sig.close(); } catch {} try { ac && ac.close(); } catch {} onState({ phase: "ended" }); },
  };
}

// ── SCREEN SHARE — a self-contained toggle over a joined mesh. getDisplayMedia → swap the outgoing camera for
// the screen (detail-hinted, higher bitrate for legible text), KEEP the camera alive to restore on stop. Everyone
// sees the screen where they saw your camera. Serverless: just another track over the same P2P mesh. Reused by the
// in-app call AND the standalone call-view door, so the logic lives here (not duplicated).
export function canShareScreen() { return typeof navigator !== "undefined" && !!navigator.mediaDevices && !!navigator.mediaDevices.getDisplayMedia; }
export function makeScreenShare(mesh, { media, ui, name = "You", facing = () => "user" }) {
  let sharing = false, camTrack = null;
  async function start() {
    if (sharing || !mesh) return;
    let ds = null; try { ds = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false }); } catch {}
    const screen = ds && ds.getVideoTracks()[0]; if (!screen) return;
    camTrack = (media && media.getVideoTracks()[0]) || null;
    try { screen.contentHint = "detail"; } catch {}
    try { await mesh.replaceVideoTrack(screen, false); } catch {}
    try { for (const pc of mesh._pcs()) tunePeer(pc, { videoKbps: 2500 }); } catch {}
    sharing = true; try { ui.attachLocal(media, name, false); ui.setSharing && ui.setSharing(true); } catch {}
    screen.onended = () => stop();   // the browser's own "Stop sharing" bar
  }
  async function stop() {
    if (!sharing || !mesh) return; sharing = false;
    let cam = camTrack;
    if (!cam || cam.readyState !== "live") { try { const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing() } }, audio: false }); cam = ns.getVideoTracks()[0]; } catch {} }
    if (cam) { try { await mesh.replaceVideoTrack(cam, false); } catch {} }
    camTrack = null; try { ui.attachLocal(media, name, facing() === "user"); ui.setSharing && ui.setSharing(false); } catch {}
  }
  return { toggle: () => (sharing ? stop() : start()), stop, sharing: () => sharing };
}

// BACKGROUND BLUR — a self-contained toggle over a joined mesh, mirroring makeScreenShare. Wrap the outgoing
// CAMERA in the lifted Jitsi blur effect and swap it in via replaceTrack; keep the raw camera alive so toggling
// off is instant. Pure client, serverless: the blurred frames ride the same P2P mesh, nobody's background leaks.
export function makeBlurEffect(mesh, { media, ui, name = "You", facing = () => "user", blurRadius = 14 } = {}) {
  let on = false, effect = null, rawCam = null;
  async function start() {
    if (on || !mesh) return;
    rawCam = (media && media.getVideoTracks()[0]) || null; if (!rawCam) return;
    try { effect = createBlurEffect(new MediaStream([rawCam]), { blurRadius }); } catch { effect = null; }
    const blurred = effect && effect.stream.getVideoTracks()[0]; if (!blurred) { effect = null; return; }
    try { await mesh.replaceVideoTrack(blurred, false); } catch {}
    on = true; try { ui.attachLocal(media, name, facing() === "user"); ui.setBlurring && ui.setBlurring(true); } catch {}
  }
  async function stop() {
    if (!on || !mesh) return; on = false;
    let cam = rawCam;
    if (!cam || cam.readyState !== "live") { try { const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing() } }, audio: false }); cam = ns.getVideoTracks()[0]; } catch {} }
    if (cam) { try { await mesh.replaceVideoTrack(cam, true); } catch {} }
    try { effect && effect.stop(); } catch {} effect = null; rawCam = null;
    try { ui.attachLocal(media, name, facing() === "user"); ui.setBlurring && ui.setBlurring(false); } catch {}
  }
  return { toggle: () => (on ? stop() : start()), stop, on: () => on };
}
