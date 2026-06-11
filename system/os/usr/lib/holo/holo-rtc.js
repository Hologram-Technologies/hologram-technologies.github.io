// holo-rtc.js — the serverless WebRTC mesh engine for Hologram Meet.
//
// One reusable engine (the idiom of _shared/holo-gpu.js / _shared/game-frame.js):
// `meet.html` and any other holospace drive it to run a peer-to-peer video call
// with NO media server. This is the honest serverless answer to Jitsi Meet —
// Jitsi needs Prosody (signaling) + Videobridge (an SFU media router); a mesh
// needs neither. Media flows DIRECTLY between browsers over WebRTC's DTLS-SRTP
// (so it is genuinely end-to-end: there is no middlebox to trust), and ALL
// non-RTP data — signalling, presence, reactions, chat, shared files — rides the
// repo's existing content-blind κ pub/sub (holo-kappa-sync / holo-broker-sync),
// exactly as the Holo Messenger does.
//
// UOR content addressing is leveraged throughout (security · privacy · leanness ·
// scalability):
//   • Every signalling / presence / reaction / chat / file object is JSON, SEALED
//     with an AES-256-GCM room key HKDF-derived (WebCrypto) from the URL-fragment
//     secret (#k=…), published as a content-addressed κ object (κ = sha256 of the
//     sealed bytes), and re-derived to its κ on receipt (Law L5). The relay sees
//     only ciphertext on a random topic — content-blind. Sealing also
//     AUTHENTICATES, closing the unauthenticated-DTLS-fingerprint MITM, so the
//     DTLS-SRTP end-to-end guarantee holds for media.
//   • Shared FILES are sealed → addressed by κ → fetched by κ from whichever peer
//     holds them and verified on receipt: a P2P content-distribution layer (dedup
//     + integrity) with no file server.
//   • Lean: the "engine" is the platform's own WebRTC + WebCrypto — no vendored
//     binary, no CDN.
//
// Scalability: a full mesh is O(n²) uplinks, so for larger calls the engine
// down-scales the OUTBOUND resolution as the roster grows (no simulcast/SVC
// without an SFU). STUN is used only for NAT address discovery (sees no media);
// NO TURN (a TURN relay would carry media — breaking serverless + private). On a
// symmetric NAT with no TURN the direct path may fail: the honest serverless limit.
//
// Negotiation = the W3C "perfect negotiation" pattern (polite/impolite decided
// deterministically by peer-id), so simultaneous offers (glare) never wedge the
// mesh. Pure, dependency-free. Exposes a small event API.

(function () {
  "use strict";
  const W = window;
  if (W.HoloRTC) return;

  const te = new TextEncoder();
  const td = new TextDecoder();
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function sha256Hex(u8) { return hex(await crypto.subtle.digest("SHA-256", u8)); }

  // ── room-secret → unguessable topic + AES-GCM key (WebCrypto HKDF) ──────────
  async function deriveRoom(secret) {
    const ikm = await crypto.subtle.importKey("raw", te.encode(String(secret)), "HKDF", false, ["deriveKey", "deriveBits"]);
    const salt = te.encode("holo-meet/v1");
    const topicBits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info: te.encode("room-topic") }, ikm, 256);
    const key = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt, info: te.encode("room-key") }, ikm,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return { topic: "meet:" + b64u(topicBits).slice(0, 32), key };
  }

  // Seal a JS value (and optional extra bytes) → { kappa, bytes }. iv(12) ‖
  // AES-GCM(ciphertext). κ = sha256 of the sealed bytes (Law-L5 verifiable).
  async function sealBytes(key, plain) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
    const bytes = new Uint8Array(iv.length + ct.length);
    bytes.set(iv, 0); bytes.set(ct, iv.length);
    return { kappa: "sha256:" + (await sha256Hex(bytes)), bytes };
  }
  const seal = (key, obj) => sealBytes(key, te.encode(JSON.stringify(obj)));
  async function openBytes(key, bytes) {
    const iv = bytes.subarray(0, 12), ct = bytes.subarray(12);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
  }
  async function open(key, bytes) { try { return JSON.parse(td.decode(await openBytes(key, bytes))); } catch { return null; } }
  // Law L5: re-derive the sealed bytes' κ and compare to the announced label.
  const verifier = (kappa, bytes) => sha256Hex(bytes).then((h) => "sha256:" + h === kappa);

  const rid = () => hex(crypto.getRandomValues(new Uint8Array(8)));

  // ── adaptive video-quality ladder (sender side) ─────────────────────────────
  // The outbound capture resolution + per-peer encode bitrate are chosen from this
  // ladder by device hardware × measured uplink × roster size. 4K is the ceiling
  // when the hardware, the network, and the call size (≤2 peers) all allow it.
  const TIER_ORDER = ["180p", "360p", "720p", "1080p", "4k"];
  const TIER = {
    "180p": { w: 320, h: 180, fps: 15, kbps: 250, label: "180p" },
    "360p": { w: 640, h: 360, fps: 30, kbps: 700, label: "360p" },
    "720p": { w: 1280, h: 720, fps: 30, kbps: 1800, label: "720p" },
    "1080p": { w: 1920, h: 1080, fps: 30, kbps: 4000, label: "1080p" },
    "4k": { w: 3840, h: 2160, fps: 30, kbps: 12000, label: "4K" },
  };
  const minTier = (a, b) => TIER_ORDER[Math.min(TIER_ORDER.indexOf(a), TIER_ORDER.indexOf(b))];

  // Probe the device's hardware ceiling — how much this machine can reasonably
  // ENCODE (cores/memory/mobile) and what its DISPLAY can show (for the receive-side
  // Holo Compositor super-resolution target).
  function deviceProfile() {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    const mobile = (typeof matchMedia === "function" && matchMedia("(pointer:coarse)").matches) || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || "");
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const screenPx = (typeof screen !== "undefined" ? Math.max(screen.width || 0, screen.height || 0) : 0) * dpr;
    let encCeil = "4k";
    if (mobile) encCeil = cores >= 6 && mem >= 4 ? "1080p" : "720p";
    else if (cores <= 2 || mem <= 2) encCeil = "360p";
    else if (cores <= 4) encCeil = "720p";
    else if (cores <= 6) encCeil = "1080p";
    const dispCeil = screenPx >= 3000 ? "4k" : screenPx >= 1700 ? "1080p" : screenPx >= 1100 ? "720p" : "360p";
    return { cores, mem, mobile, dpr, screenPx, encCeil, dispCeil };
  }

  class Mesh {
    constructor(opts) {
      this.opts = opts;
      this.sync = opts.sync;
      this.myId = rid();
      this.iceServers = opts.iceServers || [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
      this.peers = new Map();   // peerId → { pc, name, stream, makingOffer, ignoreOffer, polite, state, mic, cam, raised, sharing, quality }
      this.localStream = null;
      this.screenStream = null;
      this.camTrack = null;
      this.local = { name: opts.name || "Guest-" + this.myId.slice(0, 4), mic: opts.audio !== false, cam: opts.video !== false, raised: false, sharing: false };
      this.curCam = null; this.curMic = null;   // selected device ids
      this._seen = new Set();
      this._fileCache = new Map();   // κ → sealed bytes we hold (for serving by κ)
      this._timers = [];
      this.quality = { mode: opts.quality && TIER[opts.quality] ? "manual" : "auto", tier: "720p" };
      const noop = () => {};
      this.cb = {
        onlocalstream: opts.onlocalstream || noop, onpeer: opts.onpeer || noop, ontrack: opts.ontrack || noop,
        onstate: opts.onstate || noop, onleave: opts.onleave || noop, onspeaker: opts.onspeaker || noop,
        onchat: opts.onchat || noop, onroster: opts.onroster || noop, onreact: opts.onreact || noop,
        onraise: opts.onraise || noop, onsharing: opts.onsharing || noop, onfile: opts.onfile || noop,
        onquality: opts.onquality || noop, onsendquality: opts.onsendquality || noop, onerror: opts.onerror || noop,
      };
    }

    async start() {
      const { topic, key } = await deriveRoom(this.opts.secret);
      this.topic = topic; this.key = key;
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: this.local.mic, video: this.local.cam ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false });
      } catch (e) { this.localStream = new MediaStream(); this.local.cam = false; this.cb.onerror(e); }
      this.camTrack = this.localStream.getVideoTracks()[0] || null;
      this.local.mic = !!this.localStream.getAudioTracks()[0] && this.local.mic;
      this.local.cam = !!this.camTrack && this.local.cam;
      this.cb.onlocalstream(this.localStream);

      // Adaptive quality: probe the hardware ceiling, then start at a safe tier and
      // let the auto loop ramp toward the best the device + uplink + roster allow.
      this._dev = deviceProfile(); this._encCeil = this._dev.encCeil;
      await this._applyTier(this.quality.mode === "manual" && TIER[this.opts.quality] ? this.opts.quality : minTier("720p", this._encCeil));

      await this.sync.subscribe(this.topic, (t, kappa) => { if (t === this.topic) this._recv(kappa); });
      await this._announce({ t: "hello", ...this._stateMsg() });
      this._timers.push(setInterval(() => this._announce({ t: "hello", ...this._stateMsg() }), 3000));
      this._timers.push(setInterval(() => this._pollSpeaker(), 600));
      this._timers.push(setInterval(() => this._pollQuality(), 2000));
      this._timers.push(setInterval(() => this._autoAdapt(), 4000));
      this.started = true;
      return this;
    }

    _stateMsg() { return { mic: this.local.mic, cam: this.local.cam, raised: this.local.raised, sharing: this.local.sharing }; }

    async _announce(msg) {
      const full = { ...msg, from: this.myId, name: this.local.name };
      const { kappa, bytes } = await seal(this.key, full);
      this._seen.add(kappa);
      await this.sync.announce(this.topic, kappa, bytes);
    }

    async _recv(kappa) {
      if (this._seen.has(kappa)) return;
      this._seen.add(kappa);
      const bytes = await this.sync.fetch(kappa, { verify: verifier });
      if (!bytes) return;
      const m = await open(this.key, bytes);
      if (!m || !m.from || m.from === this.myId) return;
      try { await this._dispatch(m, kappa); } catch (e) { this.cb.onerror(e); }
    }

    async _dispatch(m, kappa) {
      switch (m.t) {
        case "hello": this._ensurePeer(m.from, m.name); this._updateState(m.from, m); this._announce({ t: "state", ...this._stateMsg() }); break;
        case "state": this._ensurePeer(m.from, m.name); this._updateState(m.from, m); break;
        case "bye": this._dropPeer(m.from); break;
        case "chat": this.cb.onchat({ from: m.from, name: m.name, text: m.text, ts: m.ts }); break;
        case "react": this.cb.onreact({ from: m.from, name: m.name, emoji: m.emoji }); break;
        case "file": this.cb.onfile({ from: m.from, name: m.name, file: { name: m.fname, mime: m.mime, size: m.size, kappa: m.kappa, get: () => this.fetchFile(m.kappa) } }); break;
        case "sdp": await this._onDescription(m.from, m.name, m.sdp); break;
        case "ice": await this._onCandidate(m.from, m.ice); break;
      }
    }

    _updateState(peerId, m) {
      const p = this.peers.get(peerId); if (!p) return;
      const wasRaised = p.raised, wasSharing = p.sharing;
      if (m.name) p.name = m.name;
      if (typeof m.mic === "boolean") p.mic = m.mic;
      if (typeof m.cam === "boolean") p.cam = m.cam;
      if (typeof m.raised === "boolean") p.raised = m.raised;
      if (typeof m.sharing === "boolean") p.sharing = m.sharing;
      if (p.raised && !wasRaised) this.cb.onraise(peerId, true);
      if (!p.raised && wasRaised) this.cb.onraise(peerId, false);
      if (p.sharing !== wasSharing) this.cb.onsharing(peerId, p.sharing);
      this.cb.onroster(this.roster());
    }

    // ── one RTCPeerConnection per remote peer (full mesh) ─────────────────────
    _ensurePeer(peerId, name) {
      let p = this.peers.get(peerId);
      if (p) { if (name && p.name !== name) { p.name = name; this.cb.onpeer(peerId, { name }); } return p; }

      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      p = { pc, name: name || peerId.slice(0, 6), stream: new MediaStream(), makingOffer: false, ignoreOffer: false,
        polite: this.myId > peerId, state: "new", mic: true, cam: true, raised: false, sharing: false, quality: null,
        _bytes: 0, _ts: 0 };
      this.peers.set(peerId, p);

      for (const track of this.localStream.getTracks()) pc.addTrack(track, this.localStream);

      pc.onnegotiationneeded = async () => {
        try { p.makingOffer = true; await pc.setLocalDescription(); await this._announce({ t: "sdp", to: peerId, sdp: pc.localDescription }); }
        catch (e) { this.cb.onerror(e); } finally { p.makingOffer = false; }
      };
      pc.onicecandidate = ({ candidate }) => { if (candidate) this._announce({ t: "ice", to: peerId, ice: candidate }); };
      pc.ontrack = ({ track, streams }) => { const s = streams[0] || p.stream; p.stream = s; track.onunmute = () => this.cb.ontrack(peerId, s); this.cb.ontrack(peerId, s); };
      pc.onconnectionstatechange = () => {
        p.state = pc.connectionState; this.cb.onstate(peerId, pc.connectionState);
        if (pc.connectionState === "failed") { try { pc.restartIce(); } catch {} }
        if (pc.connectionState === "closed") this._dropPeer(peerId);
      };
      this.cb.onpeer(peerId, { name: p.name });
      this.cb.onroster(this.roster());
      this._applyTier(this.quality.tier); this._autoAdapt();   // cap the new sender + re-evaluate
      return p;
    }

    async _onDescription(peerId, name, description) {
      const p = this._ensurePeer(peerId, name); const pc = p.pc;
      const collision = description.type === "offer" && (p.makingOffer || pc.signalingState !== "stable");
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === "offer") { await pc.setLocalDescription(); await this._announce({ t: "sdp", to: peerId, sdp: pc.localDescription }); }
    }
    async _onCandidate(peerId, candidate) {
      const p = this.peers.get(peerId); if (!p) return;
      try { await p.pc.addIceCandidate(candidate); } catch (e) { if (!p.ignoreOffer) this.cb.onerror(e); }
    }
    _dropPeer(peerId) {
      const p = this.peers.get(peerId); if (!p) return;
      try { p.pc.close(); } catch {}
      this.peers.delete(peerId); this.cb.onleave(peerId); this.cb.onroster(this.roster()); this._autoAdapt();
    }

    // ── controls ──────────────────────────────────────────────────────────────
    toggleMic(on) { const t = this.localStream.getAudioTracks()[0]; if (t) { t.enabled = on == null ? !t.enabled : !!on; this.local.mic = t.enabled; this._announce({ t: "state", ...this._stateMsg() }); } return this.local.mic; }
    toggleCam(on) { const t = this.localStream.getVideoTracks()[0]; if (t) { t.enabled = on == null ? !t.enabled : !!on; this.local.cam = t.enabled; this._announce({ t: "state", ...this._stateMsg() }); } return this.local.cam; }
    micOn() { return this.local.mic; }
    camOn() { return this.local.cam; }
    raiseHand(on) { this.local.raised = on == null ? !this.local.raised : !!on; this._announce({ t: "state", ...this._stateMsg() }); return this.local.raised; }
    react(emoji) { this._announce({ t: "react", emoji: String(emoji).slice(0, 8) }); return { from: this.myId, name: this.local.name, emoji }; }
    setName(name) { this.local.name = String(name).slice(0, 40) || this.local.name; this._announce({ t: "state", ...this._stateMsg() }); return this.local.name; }
    name() { return this.local.name; }

    // ── screen share (replaceTrack swap — no renegotiation) ───────────────────
    canShareScreen() { return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia); }
    async shareScreen() {
      if (this.screenStream) return false;
      // Ask for full native resolution — a 4K screen shares at 4K (the clearest
      // "4K when possible" path, independent of the camera tier).
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } }, audio: false });
      const screenTrack = this.screenStream.getVideoTracks()[0];
      this._replaceVideo(screenTrack);
      // Screen content gets a high encode ceiling regardless of the camera tier.
      for (const { pc } of this.peers.values()) { const s = pc.getSenders().find((x) => x.track && x.track.kind === "video"); if (s && s.getParameters) { try { const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = 8000000; p.encodings[0].maxFramerate = 30; await s.setParameters(p); } catch {} } }
      this.local.sharing = true; this._announce({ t: "state", ...this._stateMsg() });
      this.cb.onlocalstream(this._composited(screenTrack));
      screenTrack.onended = () => this.stopScreen();
      return true;
    }
    stopScreen() {
      if (!this.screenStream) return;
      try { this.screenStream.getTracks().forEach((t) => t.stop()); } catch {}
      this.screenStream = null; this.local.sharing = false; this._announce({ t: "state", ...this._stateMsg() });
      this._replaceVideo(this.camTrack); this.cb.onlocalstream(this.localStream);
      this._applyTier(this.quality.tier);   // restore the camera's quality tier
    }
    isSharing() { return !!this.screenStream; }
    _replaceVideo(track) {
      for (const { pc } of this.peers.values()) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video") || pc.getSenders().find((s) => !s.track);
        if (sender) sender.replaceTrack(track).catch((e) => this.cb.onerror(e));
      }
    }
    _composited(videoTrack) { const s = new MediaStream(); const a = this.localStream.getAudioTracks()[0]; if (a) s.addTrack(a); if (videoTrack) s.addTrack(videoTrack); return s; }

    // ── publish an EXTERNAL composited program stream (Holo Studio / OBS) ──────────────
    // A streamer joins with audio:false,video:false (empty localStream), then hands us a
    // composited canvas+mix stream to broadcast. Reuses the existing senders: replace the
    // matching sender's track if present, else addTrack; set localStream so NEW peers
    // (_ensurePeer) publish the program too. No new transport — the same serverless mesh.
    publishProgram(stream) {
      if (!stream) return;
      this.localStream = stream; this.camTrack = stream.getVideoTracks()[0] || null;
      for (const { pc } of this.peers.values()) {
        for (const track of stream.getTracks()) {
          const sender = pc.getSenders().find((s) => s.track && s.track.kind === track.kind) || pc.getSenders().find((s) => !s.track);
          if (sender) sender.replaceTrack(track).catch((e) => this.cb.onerror(e));
          else { try { pc.addTrack(track, stream); } catch (e) { this.cb.onerror(e); } }
        }
      }
      this.local.sharing = true; try { this._announce({ t: "state", ...this._stateMsg() }); } catch {}
      this.cb.onlocalstream(stream);
    }

    // ── device selection ──────────────────────────────────────────────────────
    async devices() { try { return await navigator.mediaDevices.enumerateDevices(); } catch { return []; } }
    async switchCamera(deviceId) {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId } } });
      const nt = ns.getVideoTracks()[0]; if (!nt) return false;
      const old = this.localStream.getVideoTracks()[0]; if (old) { this.localStream.removeTrack(old); old.stop(); }
      this.localStream.addTrack(nt); this.camTrack = nt; nt.enabled = this.local.cam; this.curCam = deviceId;
      if (!this.screenStream) this._replaceVideo(nt);
      this.cb.onlocalstream(this.localStream); return true;
    }
    async switchMic(deviceId) {
      const ns = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
      const nt = ns.getAudioTracks()[0]; if (!nt) return false;
      const old = this.localStream.getAudioTracks()[0]; if (old) { this.localStream.removeTrack(old); old.stop(); }
      this.localStream.addTrack(nt); nt.enabled = this.local.mic; this.curMic = deviceId;
      for (const { pc } of this.peers.values()) { const s = pc.getSenders().find((x) => x.track && x.track.kind === "audio"); if (s) s.replaceTrack(nt).catch(() => {}); }
      this.cb.onlocalstream(this.localStream); return true;
    }

    // ── content-addressed file sharing (UOR: seal → κ → fetch-by-κ → verify) ──
    async sendFile(file) {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { kappa, bytes } = await sealBytes(this.key, buf);
      this._fileCache.set(kappa, bytes);                 // we serve this κ to peers
      await this.sync.announce(this.topic, kappa, bytes); // cache it at the relay / push to broker subs
      await this._announce({ t: "file", fname: file.name, mime: file.type || "application/octet-stream", size: file.size, kappa });
      return { name: file.name, mime: file.type, size: file.size, kappa };
    }
    async fetchFile(kappa) {
      let bytes = this._fileCache.get(kappa) || await this.sync.fetch(kappa, { verify: verifier });
      if (!bytes) return null;
      const plain = await openBytes(this.key, bytes);     // E2E decrypt
      return new Blob([plain]);
    }

    // ── active-speaker + connection-quality (getStats) ────────────────────────
    async _pollSpeaker() {
      let best = null, bestLvl = 0.01;
      for (const [id, p] of this.peers) { try { (await p.pc.getStats()).forEach((r) => { if (r.type === "inbound-rtp" && r.kind === "audio" && typeof r.audioLevel === "number" && r.audioLevel > bestLvl) { bestLvl = r.audioLevel; best = id; } }); } catch {} }
      if (best !== this._speaker) { this._speaker = best; this.cb.onspeaker(best); }
    }
    async _pollQuality() {
      for (const [id, p] of this.peers) {
        try {
          let bytes = 0, lost = 0, rtt = 0;
          (await p.pc.getStats()).forEach((r) => {
            if (r.type === "inbound-rtp" && !r.isRemote) { bytes += r.bytesReceived || 0; lost += r.packetsLost || 0; }
            if (r.type === "candidate-pair" && r.state === "succeeded" && r.currentRoundTripTime != null) rtt = r.currentRoundTripTime;
          });
          const now = performance.now(); const dt = (now - (p._ts || now)) / 1000 || 1;
          const kbps = p._ts ? ((bytes - p._bytes) * 8) / 1000 / dt : 0;
          p._bytes = bytes; p._ts = now;
          const tier = p.state !== "connected" ? 0 : kbps > 600 && rtt < 0.2 ? 3 : kbps > 150 ? 2 : 1;
          p.quality = { tier, kbps: Math.round(kbps), rtt: Math.round(rtt * 1000), lost };
          this.cb.onquality(id, p.quality);
        } catch {}
      }
    }

    // ── adaptive video quality: device hardware × uplink × roster → best tier ──
    // Applies the chosen tier as BOTH a capture constraint (resolution/fps) and a
    // per-peer encode cap (maxBitrate via RTCRtpSender.setParameters).
    async _applyTier(tier) {
      const t = TIER[tier] || TIER["720p"]; this.quality.tier = tier;
      if (this.camTrack && this.camTrack.applyConstraints && !this.screenStream) {
        try { await this.camTrack.applyConstraints({ width: { ideal: t.w }, height: { ideal: t.h }, frameRate: { ideal: t.fps } }); } catch {}
      }
      for (const { pc } of this.peers.values()) {
        const s = pc.getSenders().find((x) => x.track && x.track.kind === "video"); if (!s || !s.getParameters) continue;
        try { const p = s.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}];
          p.encodings[0].maxBitrate = t.kbps * 1000; p.encodings[0].maxFramerate = t.fps; await s.setParameters(p); } catch {}
      }
      this.cb.onsendquality(tier, { mode: this.quality.mode, w: t.w, h: t.h, fps: t.fps, kbps: t.kbps, label: t.label });
    }
    // Manual override: "auto" re-enables adaptation, a tier id pins it (honoured as
    // requested — the camera/encoder caps it naturally if it can't reach it).
    setQuality(v) {
      if (v === "auto") { this.quality.mode = "auto"; this._autoAdapt(true); return "auto"; }
      if (TIER[v]) { this.quality.mode = "manual"; this._applyTier(v); return v; }
      return this.quality.mode;
    }
    currentSendTier() { return { mode: this.quality.mode, tier: this.quality.tier }; }
    qualityTiers() { return TIER_ORDER.slice(); }
    deviceProfile() { return this._dev || deviceProfile(); }
    // The auto policy: budget = measured uplink (availableOutgoingBitrate, else the
    // Network Information downlink hint) ÷ roster; pick the top tier that fits, then
    // clamp by the hardware ceiling and a mesh roster cap. Ramps up cautiously
    // (2 samples) but drops on congestion immediately.
    async _autoAdapt(force) {
      if (this.quality.mode !== "auto") return;
      let avail = 0;
      for (const p of this.peers.values()) { try { (await p.pc.getStats()).forEach((r) => { if (r.type === "candidate-pair" && (r.nominated || r.selected) && r.availableOutgoingBitrate) avail = Math.max(avail, r.availableOutgoingBitrate); }); } catch {} }
      const peers = Math.max(1, this.peers.size);
      const conn = navigator.connection; const dlKbps = conn && conn.downlink ? conn.downlink * 1000 : 0;
      let budget = (avail ? avail / 1000 : dlKbps ? dlKbps * 0.6 : 2200) / peers;   // kbps per stream
      let net = "180p"; for (const tn of TIER_ORDER) if (TIER[tn].kbps * 1.25 <= budget) net = tn;
      const rosterCap = peers >= 6 ? "360p" : peers >= 3 ? "720p" : "4k";
      const target = minTier(minTier(this._encCeil || "1080p", net), rosterCap);
      if (force) return this._applyTier(target);
      if (target === this.quality.tier) return;
      const down = TIER_ORDER.indexOf(target) < TIER_ORDER.indexOf(this.quality.tier);
      if (down) return this._applyTier(target);                                       // react to congestion now
      if (target === this._pend) this._pendN = (this._pendN || 0) + 1; else { this._pend = target; this._pendN = 1; }
      if (this._pendN >= 2) this._applyTier(target);                                   // ramp up cautiously
    }

    sendChat(text) { const ts = Date.now(); this._announce({ t: "chat", text: String(text), ts }); return { from: this.myId, name: this.local.name, text: String(text), ts }; }

    roster() {
      const me = { id: this.myId, name: this.local.name, ...this._stateMsg(), state: "connected", you: true, quality: { tier: 3 } };
      const others = [...this.peers].map(([id, p]) => ({ id, name: p.name, mic: p.mic, cam: p.cam, raised: p.raised, sharing: p.sharing, state: p.state, quality: p.quality, you: false }));
      return [me, ...others];
    }
    connectedPeers() { let n = 0; for (const p of this.peers.values()) if (p.state === "connected") n++; return n; }
    peerList() { return [...this.peers].map(([id, p]) => ({ id, name: p.name, state: p.state })); }

    async leave() {
      this._timers.forEach(clearInterval); this._timers = [];
      try { await this._announce({ t: "bye" }); } catch {}
      for (const id of [...this.peers.keys()]) this._dropPeer(id);
      try { this.localStream && this.localStream.getTracks().forEach((t) => t.stop()); } catch {}
      try { this.screenStream && this.screenStream.getTracks().forEach((t) => t.stop()); } catch {}
      try { this.sync && this.sync.close && this.sync.close(); } catch {}
    }
  }

  async function join(opts) { const mesh = new Mesh(opts); await mesh.start(); return mesh; }
  W.HoloRTC = { join, deriveRoom, seal, open, _Mesh: Mesh };
})();
