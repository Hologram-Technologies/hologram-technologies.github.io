// holo-call.mjs - Holo Calls: 1:1 (and, later, group) voice/video over the SAME together-signal relay as Together.
//
// Unlike Together's one-host→many-viewer star, a call is SYMMETRIC: both peers send AND receive media. We use WebRTC
// "perfect negotiation" (polite/impolite by peer id) so the two sides can both try to offer without glare. Media is
// E2E P2P (DTLS-SRTP); the relay only shuttles SDP/ICE and never sees audio or video. The call is also a κ-link (built
// on holo-together.mjs) so it can travel as a message to a bridged contact and open in any browser (together-view.html — the one verified off-Hologram viewer).

import * as Together from "./holo-together.mjs";

// STUN discovers reflexive candidates; a free TURN (Open Relay) RELAYS media when a peer is behind a symmetric NAT
// (mobile carriers, strict firewalls) — STUN alone can't, and a large fraction of real device pairs need it. The
// turns:443 leg survives TCP-only / port-restricted networks. Content stays E2E DTLS-SRTP; the relay only forwards
// encrypted packets, never plaintext media.
const ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turns:openrelay.metered.ca:443"], username: "openrelayproject", credential: "openrelayproject" },
];
const _rid = () => "c" + Math.random().toString(36).slice(2, 10);

// ── media quality (shared by 1:1 calls, the group mesh, and the standalone call-view page) ───────────────────────
// callMedia: getUserMedia with WhatsApp/Meet-grade defaults — 720p30, echo-cancelled/denoised/AGC'd speech — and a
// graceful ladder: HD → any camera → mic only → null. contentHints let the encoder optimize (speech vs motion).
export async function callMedia(video) {
  const md = (typeof navigator !== "undefined") && navigator.mediaDevices; if (!md || !md.getUserMedia) return null;
  const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  const hd = video ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: "user" } : false;
  let s = null;
  try { s = await md.getUserMedia({ audio, video: hd }); }
  catch { try { s = await md.getUserMedia({ audio, video: !!video }); } catch { try { s = await md.getUserMedia({ audio: true }); } catch {} } }
  if (s) { try { s.getAudioTracks().forEach((t) => { t.contentHint = "speech"; }); s.getVideoTracks().forEach((t) => { t.contentHint = "motion"; }); } catch {} }
  return s;
}
// tunePeer: cap sender bitrates so quality is HIGH but never floods a peer's downlink (the mesh scales the cap by
// room size). "balanced" degradation keeps both motion and sharpness under pressure. Safe to call repeatedly; must
// run after negotiation (encodings exist once the transceiver is live) — callers invoke it on "connected".
export async function tunePeer(pc, { videoKbps = 2500, audioKbps = 64 } = {}) {
  try {
    for (const sn of pc.getSenders()) {
      if (!sn || !sn.track) continue;
      try {
        const p = sn.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = (sn.track.kind === "video" ? videoKbps : audioKbps) * 1000;
        if (sn.track.kind === "video") p.degradationPreference = "balanced";
        await sn.setParameters(p);
      } catch {}
    }
  } catch {}
}

// ── link layer (kind:"call") ──────────────────────────────────────────────────────────────────────────────────────
export async function createCall({ callerName = "", video = false, ttlSeconds = 3600, signal = null, room = null } = {}) {
  // content carries the modality ("audio"|"video"); capability "control" = a real participant (vs a view-only guest)
  return Together.createSession({ kind: "call", hostName: callerName, capability: "control", content: video ? "video" : "audio", signal, room, ttlSeconds });
}
// The view page is CALL-VIEW (a real participant lobby → the meet grid, any browser) — a NEW path, so no SW ever
// serves it stale (the M4 rule), and the live ring regex already recognizes call-view.html#. Anchored to THIS
// module's own URL (import.meta.url), the proven normalization-proof way to survive /Q → /hologram-os → root moves.
const _VIEW_URL = (() => { try { return new URL("./call-view.html", import.meta.url).pathname; } catch { return "/apps/holo-messenger/call-view.html"; } })();
export function buildCallLink(intent, opts = {}) { return Together.buildLink(intent, { viewPath: _VIEW_URL, ...opts }); }
export function parseCall(input) { return Together.parseSession(input); }
export function describeCall(intent) { return { video: intent.content === "video", caller: intent.hostName || "Someone", headline: (intent.hostName || "Someone") + " is calling", verb: intent.content === "video" ? "Video call" : "Voice call" }; }
// SYNC detector for an incoming-call link in a message body → { intent, url } | null (ring on a FRESH one).
// Matches BOTH view pages — buildCallLink emits …/together-view.html#… (the buildLink default), the older
// call-view.html form stays recognized — plus the in-shell holo:// form. The decoded payload's kind==="call"
// check below is the real gate, so a watch/doc together link matching here never rings.
const _CALL_RE = /(\S*(?:call|together)-view\.html#([A-Za-z0-9_-]+))|(holo:\/\/together\/\S*#([A-Za-z0-9_-]+))/;
export function callLinkInText(text) {
  const m = String(text || "").match(_CALL_RE); if (!m) return null;
  const payload = m[2] || m[4], url = m[0];
  try { const it = JSON.parse(decodeURIComponent(escape(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))))); if (it && it.kind === "call" && it.room) return { intent: it, url, payload }; } catch {}
  return null;
}

// ── symmetric perfect-negotiation peer ────────────────────────────────────────────────────────────────────────────
// THE ONE SIGNAL DOOR for every realtime surface (1:1 calls here, the group mesh in holo-call-mesh.mjs): the
// signaling channel for (room, peer). On a real ORIGIN (desktop / dev server) it rides the together-signal relay
// (SSE + POST /signal). On a STATIC hosted origin (github.io) that relay 404s, so — exactly like 1:1 chat
// (holo-chat-context) — it rides the content-blind Nostr rendezvous instead: sealed {from,…} blobs at a coordinate
// DERIVED from the room κ, over public relays. No server we run; the relay sees only ciphertext. Returns {post, close}.
export async function openSignal(base, room, peer, onMsg) { return _connect(base, room, peer, onMsg); }
async function _connect(base, room, peer, onMsg, { announce = true } = {}) {
  const hosted = typeof location !== "undefined" && !!location.hostname && !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
  if (hosted && typeof WebSocket !== "undefined") {
    try { return await _connectNostr(room, peer, onMsg, { announce }); } catch {}   // fail-soft → fall through to the origin relay
  }
  const es = new EventSource(`${base}/signal?room=${encodeURIComponent(room)}&peer=${encodeURIComponent(peer)}`);
  es.onmessage = (e) => { let d; try { d = JSON.parse(e.data); } catch { return; } onMsg(d); };
  const post = (obj) => { try { fetch(`${base}/signal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, from: peer, ...obj }) }); } catch {} };
  return { post, close: () => { try { es.close(); } catch {} } };
}
// Nostr backend for _connect. Presence is SYNTHESIZED (a dumb pub/sub has no server to announce joins): each side
// re-announces "peer-join" a few times so the callee — who joins on ACCEPT, seconds after the ring — always discovers
// the caller within the mailbox TTL. Own echoes (relays fan a put back to the sender) are dropped by `from === peer`.
async function _connectNostr(room, peer, onMsg, { announce = true } = {}) {
  const rdv = await import("/usr/lib/holo/holo-rendezvous.mjs");
  const { roomKey, sealWire, openWire } = await import("./holo-chat-context.mjs");
  const coord = rdv.coordinate(room);
  const key = await roomKey(room);                         // both peers hold `room` (from the call link) → same key + coord
  const mbox = await rdv.makeNostrMailbox();
  if (mbox.relayCount && mbox.relayCount() === 0) { try { mbox.close(); } catch {} throw new Error("no relays"); }
  const seen = new Set();
  const sub = mbox.liveGet(coord, Math.floor(Date.now() / 1000) - 120, async (blob) => {
    if (seen.has(blob)) return; seen.add(blob);            // de-dupe the same event fanned from several relays
    let wire; try { wire = JSON.parse(blob); } catch { return; }
    const msg = await openWire(key, wire);
    if (!msg || msg.from === peer) return;                 // drop junk + my own echoed put
    onMsg(msg);
  });
  const post = async (obj) => { try { const wire = await sealWire(key, { from: peer, ...obj }); mbox.put(coord, JSON.stringify(wire)); } catch {} };
  // announce:false = a control-only channel (declineCall) — it must never present as a joinable media peer
  let n = 0, t = null; const beat = () => { post({ kind: "peer-join" }); if (++n < 5) t = setTimeout(beat, 2500); }; if (announce) beat();
  return { post, close: () => { try { clearTimeout(t); sub && sub.close && sub.close(); mbox.close && mbox.close(); } catch {} } };
}

function _makePeer(post, other, polite, localStream, onRemoteStream, onState) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  let makingOffer = false, ignoreOffer = false;
  if (localStream) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  pc.ontrack = ({ streams }) => { if (streams && streams[0]) onRemoteStream(streams[0]); };
  pc.onnegotiationneeded = async () => { try { makingOffer = true; await pc.setLocalDescription(); post({ to: other, kind: "sdp", data: pc.localDescription }); } catch {} finally { makingOffer = false; } };
  pc.onicecandidate = ({ candidate }) => { if (candidate) post({ to: other, kind: "ice", data: candidate }); };
  // survive a network change: restartIce re-gathers on the new path (Wi-Fi↔cellular) instead of freezing
  let reT = null;
  const restart = (delay) => { clearTimeout(reT); reT = setTimeout(() => { const cs = pc.connectionState, ics = pc.iceConnectionState; if (cs === "connected" || cs === "completed" || ics === "connected" || ics === "completed") return; try { pc.restartIce(); } catch {} }, delay); };
  pc.oniceconnectionstatechange = () => { const s = pc.iceConnectionState; if (s === "failed") { onState("reconnecting"); restart(300); } else if (s === "disconnected") { onState("reconnecting"); restart(2500); } else if (s === "connected" || s === "completed") onState("connected"); };
  try { if (navigator.connection && navigator.connection.addEventListener) { pc._netHook = () => restart(200); navigator.connection.addEventListener("change", pc._netHook); } } catch {}
  pc.onconnectionstatechange = () => { const cs = pc.connectionState; if (cs === "connected") { tunePeer(pc); onState("connected"); } else if (cs === "failed") { onState("reconnecting"); restart(300); } else onState(cs); };   // 1:1 → full HD budget
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
  return { pc, onSignal, close: () => { try { clearTimeout(reT); } catch {} try { if (pc._netHook && navigator.connection) navigator.connection.removeEventListener("change", pc._netHook); } catch {} try { pc.close(); } catch {} } };
}

// DECLINE without joining — the callee's red button. Opens the signal door just long enough to tell the caller
// "declined" (their UI flips instantly instead of ringing into the no-answer timeout), then tears down. The delay
// before close lets the sealed put actually reach the relays on the Nostr path (fire-and-forget over a fresh WS).
export async function declineCall(intent) {
  try {
    const base = intent.signal || (typeof location !== "undefined" ? location.origin : "");
    const sig = await _connect(base, intent.room, _rid(), () => {}, { announce: false });
    sig.post({ kind: "bye", reason: "declined" });
    setTimeout(() => { try { sig.close(); } catch {} }, 2500);
    return { ok: true };
  } catch { return { ok: false }; }
}

// Join a call room with your local `media` (a MediaStream from getUserMedia or synthetic). Symmetric: caller and callee
// both call this - the caller after minting+sending the link, the callee on ACCEPT. Returns controls.
export async function joinCall(intent, { media = null, onState = () => {}, onRemoteStream = () => {}, onPeer = () => {} } = {}) {
  const base = intent.signal || (typeof location !== "undefined" ? location.origin : "");
  const room = intent.room, me = _rid();
  let peer = null, otherId = null, ended = false, noAnswerT = null;
  const sig = await _connect(base, room, me, async (d) => {
    if (ended) return;
    if (d.kind === "ready") { for (const p of (d.peers || [])) ensurePeer(p); }
    else if (d.kind === "peer-join") ensurePeer(d.from);
    else if (d.kind === "peer-leave" && d.from === otherId) end("ended");
    // a DECLINE arrives from a channel that never joined as a media peer (otherId still null) — the reason field,
    // not the sender id, is authoritative (the room is capability-scoped by the link + signaling is sealed).
    else if (d.kind === "bye" && (d.from === otherId || d.reason === "declined")) end(d.reason === "declined" ? "declined" : "ended");
    else if (d.kind === "sdp" && d.from === otherId && peer) peer.onSignal({ sdp: d.data });
    else if (d.kind === "ice" && d.from === otherId && peer) peer.onSignal({ ice: d.data });
  });
  function ensurePeer(other) {
    if (peer || ended) return;
    otherId = other; clearTimeout(noAnswerT);   // someone picked up → the ring window is over
    peer = _makePeer((msg) => sig.post(msg), other, me < other /* polite */, media, onRemoteStream, (cs) => onState({ phase: cs }));
    onPeer(other);
  }
  function end(reason) { if (ended) return; ended = true; clearTimeout(noAnswerT); try { peer && peer.close(); } catch {} try { sig.close(); } catch {} onState({ phase: reason || "ended" }); }
  // WhatsApp semantics: an unanswered call doesn't ring forever — no peer within the ring window ⇒ "no-answer"
  // (the callee's own ring card auto-misses on the same clock, app-side).
  noAnswerT = setTimeout(() => { if (!peer && !ended) { try { sig.post({ kind: "bye", reason: "no-answer" }); } catch {} end("no-answer"); } }, 45000);
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
