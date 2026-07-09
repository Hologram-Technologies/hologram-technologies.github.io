// holo-watch.js — Watch Together: one holospace link, perfectly-synced playback
// + optional reaction cameras. The link IS the room (?room=…&watch=…).
//
// Transport: a content-blind room relay (SSE down + POST up) — the dev backend's
// /room/<id> (a hosted relay plays this role in production). Playback sync rides
// the room (play/pause/seek + a leader drift-heartbeat); cameras are peer-to-peer
// WebRTC (perfect negotiation, mesh), signalled over the same room.

(function () {
  "use strict";
  if (window.HoloWatch) return;
  const rid = () => Math.random().toString(36).slice(2, 10);
  const STUN = [{ urls: "stun:stun.l.google.com:19302" }];

  function join(roomId, hooks) {
    const me = rid();
    const peers = new Set();
    const pcs = new Map();                 // peerId -> { pc, makingOffer, ignoreOffer, polite }
    let localStream = null, suppress = 0, leader = me, dead = false;
    const isLeader = () => leader === me;
    const recomputeLeader = () => { leader = [me, ...peers].sort()[0]; };
    const presence = () => hooks.onPresence && hooks.onPresence(peers.size + 1, isLeader());

    const post = (msg) => { try { fetch(`/room/${roomId}?peer=${me}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...msg, from: me }) }); } catch {} };
    const sig = (to, data) => post({ k: "sig", to, data });

    // ── WebRTC perfect negotiation (per peer) ──────────────────────────────────
    function ensurePC(peer) {
      let e = pcs.get(peer); if (e) return e;
      const pc = new RTCPeerConnection({ iceServers: STUN });
      e = { pc, makingOffer: false, ignoreOffer: false, polite: me > peer };
      pcs.set(peer, e);
      if (localStream) localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
      pc.onicecandidate = ({ candidate }) => candidate && sig(peer, { ice: candidate });
      pc.ontrack = ({ streams }) => hooks.onRemoteStream && hooks.onRemoteStream(peer, streams[0]);
      pc.onnegotiationneeded = async () => {
        try { e.makingOffer = true; await pc.setLocalDescription(); sig(peer, { sdp: pc.localDescription }); }
        catch {} finally { e.makingOffer = false; }
      };
      return e;
    }
    async function onSignal(peer, data) {
      const e = ensurePC(peer), pc = e.pc;
      try {
        if (data.sdp) {
          const collision = data.sdp.type === "offer" && (e.makingOffer || pc.signalingState !== "stable");
          e.ignoreOffer = !e.polite && collision; if (e.ignoreOffer) return;
          await pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === "offer") { await pc.setLocalDescription(); sig(peer, { sdp: pc.localDescription }); }
        } else if (data.ice) { try { await pc.addIceCandidate(data.ice); } catch {} }
      } catch {}
    }

    // ── room messages ──────────────────────────────────────────────────────────
    function meet(from) { if (!peers.has(from)) { peers.add(from); recomputeLeader(); presence(); if (localStream) ensurePC(from); } }
    function handle(m) {
      if (!m || m.from === me) return;
      switch (m.k) {
        case "hello": meet(m.from); post({ k: "present" }); break;     // greet newcomer back
        case "present": meet(m.from); break;
        case "bye": if (peers.delete(m.from)) { const e = pcs.get(m.from); if (e) { try { e.pc.close(); } catch {} pcs.delete(m.from); } recomputeLeader(); presence(); hooks.onPeerLeave && hooks.onPeerLeave(m.from); } break;
        case "act": suppress = Date.now() + 900; hooks.apply && hooks.apply(m.action); break;
        case "video": suppress = Date.now() + 1600; hooks.onVideo && hooks.onVideo(m.id); break;
        case "sync": {
          if (m.from !== leader) return; const s = hooks.getState && hooks.getState(); if (!s) return;
          if (typeof m.time === "number" && Math.abs(s.time - m.time) > 1.2) { suppress = Date.now() + 900; hooks.apply && hooks.apply({ type: "seek", time: m.time }); }
          if (typeof m.playing === "boolean" && m.playing !== s.playing) { suppress = Date.now() + 900; hooks.apply && hooks.apply({ type: m.playing ? "play" : "pause" }); }
          break;
        }
        case "sig": if (m.to === me) onSignal(m.from, m.data); break;
      }
    }

    const es = new EventSource(`/room/${roomId}?peer=${me}`);
    es.onmessage = (ev) => { try { handle(JSON.parse(ev.data)); } catch {} };
    es.onopen = () => post({ k: "hello" });
    const beat = setInterval(() => { if (!dead && isLeader() && peers.size) { const s = hooks.getState && hooks.getState(); if (s) post({ k: "sync", time: s.time, playing: s.playing }); } }, 2200);

    return {
      peerId: me,
      broadcast(action) { if (Date.now() < suppress) return; post({ k: "act", action }); },
      setVideo(id) { post({ k: "video", id }); },
      async toggleCamera() {
        if (localStream) { localStream.getTracks().forEach((t) => t.stop()); for (const e of pcs.values()) e.pc.getSenders().forEach((s) => { try { e.pc.removeTrack(s); } catch {} }); localStream = null; return null; }
        try { localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false }); } catch { return null; }
        for (const peer of peers) { const e = ensurePC(peer); localStream.getTracks().forEach((t) => e.pc.addTrack(t, localStream)); }
        return localStream;
      },
      leave() { dead = true; clearInterval(beat); post({ k: "bye" }); try { es.close(); } catch {} for (const e of pcs.values()) { try { e.pc.close(); } catch {} } if (localStream) localStream.getTracks().forEach((t) => t.stop()); },
    };
  }
  window.HoloWatch = { join, newRoom: rid };
})();
