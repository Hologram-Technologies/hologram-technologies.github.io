// holo-obs.js — the engine for Holo Studio (OBS Studio, hologram-native).
//
// Drop-in classic script: <script src="_shared/holo-obs.js"></script> → window.HoloStudio
// (also self-exposes in Node, so the pure OBS model + WHIP shaping + κ are witnessed for real).
//
// Faithful to OBS Studio's source-of-truth model — Scenes → Sources → Audio Mixer → Record →
// Stream — realized entirely on browser standards and the platform's existing engines, so it
// is an ORCHESTRATION layer, not new infrastructure:
//   • Sources         — W3C Screen Capture (getDisplayMedia) + Media Capture (getUserMedia),
//                        plus a "holospace" source (capture-this-tab of a mounted holospace)
//                        and the Holo Capture annotation canvas as an overlay source.
//   • Scene compositor — a program canvas (base resolution × FPS) drawn per-source-transform
//                        (OBS scene-item transforms; webcam PiP), then canvas.captureStream().
//   • Audio mixer      — Web Audio MediaStreamAudioDestinationNode, one gain node per source
//                        (OBS per-source mute/volume); mic enhanced via _shared/holo-audio.js.
//   • Record           — MediaRecorder → bytes → κ (sha256) → the OPFS κ-store (the recording
//                        IS its content address — Law 1/5; OBS records to a file, we to a κ).
//   • Stream           — OBS's two real egress paths: (a) the SERVERLESS WebRTC mesh
//                        (_shared/holo-rtc.js → a holo://κ room; the UOR-native default), and
//                        (b) WHIP — OBS 30's WebRTC-HTTP Ingestion Protocol, byte-faithful.
//
// No DOM/canvas is touched at import: the Scene/Source model, the canonical scene-collection
// serialization → κ, and the WHIP request/answer shaping are PURE, so they run anywhere
// (page · Node witness); only Studio.start()/record()/goLive*() use the browser.

(function () {
  "use strict";

  // ── OBS source kinds (its obs_source_info id space, mapped to W3C capture) ───────────
  const TYPES = [
    { kind: "display",   obs: "monitor_capture",    label: "Display Capture",      via: "getDisplayMedia", audio: true },
    { kind: "window",    obs: "window_capture",     label: "Window Capture",       via: "getDisplayMedia", audio: true },
    { kind: "holospace", obs: "browser_source",     label: "Holospace",            via: "getDisplayMedia", audio: true },
    { kind: "camera",    obs: "v4l2_input",         label: "Video Capture Device", via: "getUserMedia",    audio: false },
    { kind: "mic",       obs: "pulse_input_capture", label: "Audio Input Capture", via: "getUserMedia",    audio: true, novideo: true },
    { kind: "overlay",   obs: "image_source",        label: "Annotation Overlay",  via: "canvas",          audio: false },
  ];
  const TYPE = Object.fromEntries(TYPES.map((t) => [t.kind, t]));

  // OBS scene-item transforms are normalized to the base canvas (0..1) so a scene is
  // resolution-independent. Layout presets mirror OBS's common streamer arrangements.
  const LAYOUTS = {
    full:   (i, n) => ({ x: 0, y: 0, w: 1, h: 1 }),                                   // source fills program
    pip:    (i, n) => (i === 0 ? { x: 0, y: 0, w: 1, h: 1 } : { x: 0.72, y: 0.70, w: 0.26, h: 0.28 }), // base + webcam corner
    side:   (i, n) => (i === 0 ? { x: 0, y: 0, w: 0.72, h: 1 } : { x: 0.72, y: 0, w: 0.28, h: 1 }),
    grid:   (i, n) => { const c = Math.ceil(Math.sqrt(n)), r = Math.ceil(n / c); return { x: (i % c) / c, y: ((i / c) | 0) / r, w: 1 / c, h: 1 / r }; },
  };
  // OBS scene transitions (we expose the names; the compositor cross-fades on switch).
  const TRANSITIONS = ["cut", "fade"];
  const BASES = { "1080p": { w: 1920, h: 1080 }, "720p": { w: 1280, h: 720 }, "480p": { w: 854, h: 480 } };
  const FPS_CHOICES = [60, 30, 24];

  // ── κ (content address) — sha256, axis-prefixed (matches holo-capture / teleport) ───
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  async function kappa(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
    if (subtle) return "sha256:" + hex(new Uint8Array(await subtle.digest("SHA-256", u8)));
    const { createHash } = require("crypto");
    return "sha256:" + createHash("sha256").update(Buffer.from(u8)).digest("hex");
  }
  const utf8 = (s) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, "utf8")));

  // ── canonical scene collection (.holoscene) → its own κ (Law 2) ─────────────────────
  function canonicalScene(studio) {
    const pub = {
      v: 1, base: studio.base, fps: studio.fps, layout: studio.layout, transition: studio.transition,
      scenes: studio.scenes.map((sc) => ({
        name: sc.name,
        sources: sc.sources.map((s) => ({ kind: s.kind, name: s.name, transform: round(s.transform), audio: { muted: !!s.muted, gain: r3(s.gain) }, visible: s.visible !== false })),
      })),
      active: studio.activeIndex,
    };
    return stableStringify(pub);
  }
  function round(t) { return { x: r3(t.x), y: r3(t.y), w: r3(t.w), h: r3(t.h) }; }
  const r3 = (n) => Math.round((+n || 0) * 1000) / 1000;
  function stableStringify(x) {
    if (x === null || typeof x !== "object") return JSON.stringify(x);
    if (Array.isArray(x)) return "[" + x.map(stableStringify).join(",") + "]";
    const k = Object.keys(x).sort();
    return "{" + k.map((kk) => JSON.stringify(kk) + ":" + stableStringify(x[kk])).join(",") + "}";
  }
  const sceneBytes = (studio) => utf8(canonicalScene(studio));
  async function sceneKappa(studio) { return kappa(sceneBytes(studio)); }

  // ── WHIP (WebRTC-HTTP Ingestion Protocol) — OBS 30's WebRTC egress, byte-faithful ───
  // PURE request/answer shaping (so the witness verifies protocol conformance with no net):
  //   POST <endpoint>  Content-Type: application/sdp  [Authorization: Bearer <token>]  body=offer.sdp
  //   ← 201 Created    Location: <resource>           body=answer.sdp
  //   DELETE <resource>  to stop.
  function whipRequest(opts) {
    const headers = { "Content-Type": "application/sdp" };
    if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
    return { method: "POST", url: opts.endpoint, headers, body: String(opts.sdp || "") };
  }
  function parseWhipAnswer(status, headers, body) {
    const get = (h, k) => (h && (typeof h.get === "function" ? h.get(k) : (h[k] || h[k.toLowerCase()]))) || "";
    const ok = status === 201;
    const loc = get(headers, "Location");
    return { ok, status, resource: loc || "", answerSdp: ok ? String(body || "") : "", error: ok ? "" : ("WHIP ingest returned " + status) };
  }
  function whipDelete(resource) { return { method: "DELETE", url: resource }; }

  // ── pick the best MediaRecorder mime the browser supports (faithful codec mapping) ──
  const REC_MIMES = [
    "video/mp4;codecs=h264,aac",      // OBS's native H.264/AAC, when the browser offers it
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=av1,opus",
    "video/webm", "video/mp4",
  ];
  function pickMime() {
    const MR = (typeof MediaRecorder !== "undefined") ? MediaRecorder : null;
    if (!MR || !MR.isTypeSupported) return "video/webm";
    for (const m of REC_MIMES) if (MR.isTypeSupported(m)) return m;
    return "video/webm";
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  // Studio — the live engine (browser only). One scene collection, a program compositor,
  // an audio mixer, a recorder, and the two streamers. Mirrors OBS's runtime.
  // ════════════════════════════════════════════════════════════════════════════════════
  class Studio {
    constructor(opts) {
      opts = opts || {};
      this.base = opts.base && BASES[opts.base] ? opts.base : "720p";
      this.fps = FPS_CHOICES.includes(opts.fps) ? opts.fps : 30;
      this.layout = opts.layout || "pip";
      this.transition = "fade";
      this.scenes = [{ name: "Scene", sources: [] }];
      this.activeIndex = 0;
      this.overlaySource = opts.overlay || null;   // a canvas/Image (the Holo Capture annotation)
      this.iceServers = opts.iceServers || [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
      this.running = false; this.recording = false; this.live = { mesh: null, whip: null };
      this._raf = 0; this._cb = opts.on || (() => {});
      this._dpr = 1;
    }
    get scene() { return this.scenes[this.activeIndex]; }
    emit(ev, data) { try { this._cb(ev, data); } catch {} }

    // ── sources (OBS "+ Add Source") ──────────────────────────────────────────────────
    async addSource(kind, opts) {
      opts = opts || {};
      const t = TYPE[kind]; if (!t) throw new Error("unknown source kind: " + kind);
      let stream = opts.stream || null, el = null;
      if (!stream && kind !== "overlay") {
        if (t.via === "getDisplayMedia") stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: this.fps }, audio: true, preferCurrentTab: kind === "holospace" });
        else if (t.via === "getUserMedia") stream = await navigator.mediaDevices.getUserMedia(t.novideo ? { audio: true } : { video: { width: { ideal: 1280 }, height: { ideal: 720 }, deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined }, audio: false });
      }
      if (kind === "overlay") el = this.overlaySource || opts.canvas;
      else if (stream && !t.novideo) { el = document.createElement("video"); el.muted = true; el.playsInline = true; el.srcObject = stream; el.play().catch(() => {}); }
      const src = {
        id: "src_" + Math.random().toString(36).slice(2, 9), kind, name: opts.name || t.label,
        stream, _el: el, transform: opts.transform || { x: 0, y: 0, w: 1, h: 1 }, visible: true,
        muted: false, gain: 1, _audioNode: null, _gainNode: null,
      };
      this.scene.sources.push(src);
      this.applyLayout();
      if (this.running) this._wireAudio(src);
      // ending the underlying capture (user clicks browser "Stop sharing") removes the source
      if (stream) stream.getVideoTracks().forEach((tr) => (tr.onended = () => this.removeSource(src.id)));
      this.emit("sources", this.scene.sources);
      return src;
    }
    removeSource(id) {
      const i = this.scene.sources.findIndex((s) => s.id === id); if (i < 0) return;
      const s = this.scene.sources[i];
      try { s.stream && s.stream.getTracks().forEach((t) => t.stop()); } catch {}
      try { s._audioNode && s._audioNode.disconnect(); } catch {}
      this.scene.sources.splice(i, 1); this.applyLayout(); this.emit("sources", this.scene.sources);
    }
    setVisible(id, v) { const s = this.scene.sources.find((x) => x.id === id); if (s) { s.visible = !!v; this.emit("sources", this.scene.sources); } }
    setTransform(id, t) { const s = this.scene.sources.find((x) => x.id === id); if (s) { s.transform = { ...s.transform, ...t }; this.emit("sources", this.scene.sources); } }
    raise(id, dz) { const a = this.scene.sources; const i = a.findIndex((s) => s.id === id); const j = Math.max(0, Math.min(a.length - 1, i + dz)); if (i >= 0 && i !== j) { const [s] = a.splice(i, 1); a.splice(j, 0, s); this.emit("sources", a); } }
    setLayout(name) { if (LAYOUTS[name]) { this.layout = name; this.applyLayout(); } }
    applyLayout() { const fn = LAYOUTS[this.layout] || LAYOUTS.pip; const vids = this.scene.sources.filter((s) => TYPE[s.kind] && !TYPE[s.kind].novideo); vids.forEach((s, i) => { s.transform = fn(i, vids.length); }); this.emit("sources", this.scene.sources); }

    // ── the program compositor (OBS program output) → a captured MediaStream ──────────
    start() {
      if (this.running) return this.programStream;
      const { w, h } = BASES[this.base];
      this.canvas = (typeof document !== "undefined") ? document.createElement("canvas") : null;
      this.canvas.width = w; this.canvas.height = h;
      this.ctx = this.canvas.getContext("2d", { alpha: false, desynchronized: true });
      // audio: one mixer destination; each source's audio → a gain node → destination.
      // Resume the context (it starts suspended without a user gesture) so the program
      // audio track is live — otherwise a recording of a silent scene can stall.
      this.actx = new (window.AudioContext || window.webkitAudioContext)();
      try { this.actx.resume(); } catch {}
      this.mixDest = this.actx.createMediaStreamDestination();
      // Keep-alive: a SILENT constant source so the program ALWAYS has a live audio track.
      // Without it, MediaRecorder(…,opus/aac) stalls waiting for audio when no mic is added
      // (a camera-only or screen-only scene) — producing 0 segments / a 0-byte recording.
      try { const ks = this.actx.createConstantSource(); ks.offset.value = 0; ks.connect(this.mixDest); ks.start(); this._keepAlive = ks; } catch {}
      for (const s of this.scene.sources) this._wireAudio(s);
      this.running = true; this._draw(); this._draw();   // prime the canvas before capture
      const vstream = this.canvas.captureStream(this.fps);
      this.programVideoTrack = vstream.getVideoTracks()[0];
      this.programStream = new MediaStream([this.programVideoTrack, ...this.mixDest.stream.getAudioTracks()]);
      this.emit("running", true);
      return this.programStream;
    }
    _wireAudio(s) {
      try {
        if (!this.actx || !s.stream || !s.stream.getAudioTracks().length) return;
        const node = this.actx.createMediaStreamSource(s.stream);
        const g = this.actx.createGain(); g.gain.value = s.muted ? 0 : s.gain;
        node.connect(g).connect(this.mixDest); s._audioNode = node; s._gainNode = g;
      } catch {}
    }
    setMuted(id, m) { const s = this.scene.sources.find((x) => x.id === id); if (s) { s.muted = !!m; if (s._gainNode) s._gainNode.gain.value = m ? 0 : s.gain; this.emit("sources", this.scene.sources); } }
    setGain(id, g) { const s = this.scene.sources.find((x) => x.id === id); if (s) { s.gain = +g; if (s._gainNode && !s.muted) s._gainNode.gain.value = +g; } }
    _draw() {
      if (!this.running) return;
      const { w, h } = BASES[this.base], ctx = this.ctx;
      ctx.fillStyle = "#05070a"; ctx.fillRect(0, 0, w, h);
      for (const s of this.scene.sources) {
        if (s.visible === false) continue;
        const el = s._el || (s.kind === "overlay" ? this.overlaySource : null); if (!el) continue;
        const t = s.transform, dx = t.x * w, dy = t.y * h, dw = t.w * w, dh = t.h * h;
        try {
          const ew = el.videoWidth || el.width || el.naturalWidth, eh = el.videoHeight || el.height || el.naturalHeight;
          if (!ew || !eh) continue;
          // cover-fit the source into its box (OBS "fill" bounding-box)
          const scale = Math.max(dw / ew, dh / eh), sw = dw / scale, sh = dh / scale, sx = (ew - sw) / 2, sy = (eh - sh) / 2;
          ctx.drawImage(el, sx, sy, sw, sh, dx, dy, dw, dh);
        } catch {}
      }
      this._raf = requestAnimationFrame(() => this._draw());
    }
    stop() {
      this.running = false; if (this._raf) cancelAnimationFrame(this._raf);
      this.stopRecord(); this.stopLiveMesh(); this.stopLiveWhip();
      for (const sc of this.scenes) for (const s of sc.sources) { try { s.stream && s.stream.getTracks().forEach((t) => t.stop()); } catch {} }
      try { this.actx && this.actx.close(); } catch {}
      this.emit("running", false);
    }

    // ── record (OBS "Start Recording") → a content-addressed κ clip ───────────────────
    record() {
      if (!this.running) this.start();
      const mime = pickMime();
      this._chunks = []; this.rec = new MediaRecorder(this.programStream, { mimeType: mime });
      this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this._chunks.push(e.data); };
      this._recStart = Date.now(); this.rec.start(1000); this.recording = true; this.recMime = mime;
      this.emit("record", { state: "recording", mime });
    }
    async stopRecord() {
      if (!this.rec || !this.recording) return null;
      const rec = this.rec, mime = this.recMime, dur = (Date.now() - this._recStart) / 1000;
      const done = new Promise((res) => (rec.onstop = res));
      try { rec.stop(); } catch {} await done; this.recording = false; this.rec = null;
      const blob = new Blob(this._chunks, { type: mime });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const k = await kappa(bytes);
      const out = { blob, bytes, kappa: k, mime, duration: dur, width: BASES[this.base].w, height: BASES[this.base].h };
      this.emit("record", { state: "stopped", ...out });
      return out;
    }

    // ── stream (a) the SERVERLESS mesh — reuse Hologram Meet's engine (UOR-native) ────
    async goLiveMesh(opts) {
      if (!this.running) this.start();
      if (!window.HoloRTC) throw new Error("HoloRTC (the serverless mesh) is unavailable");
      const mesh = await window.HoloRTC.join({ secret: opts.secret, sync: opts.sync, name: opts.name || "Holo Studio", iceServers: this.iceServers, audio: false, video: false, quality: opts.quality || "auto" });
      // publish the COMPOSITED program stream over the existing mesh (one tiny shim)
      if (mesh.publishProgram) mesh.publishProgram(this.programStream);
      this.live.mesh = mesh; this.emit("live", { kind: "mesh", state: "live", room: opts.secret });
      return mesh;
    }
    stopLiveMesh() { try { this.live.mesh && this.live.mesh.leave && this.live.mesh.leave(); } catch {} this.live.mesh = null; }

    // ── stream (b) WHIP — OBS 30's WebRTC-HTTP Ingestion Protocol (interop) ───────────
    async goLiveWhip(endpoint, token) {
      if (!this.running) this.start();
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      for (const tr of this.programStream.getTracks()) pc.addTransceiver(tr, { direction: "sendonly" });
      await pc.setLocalDescription(await pc.createOffer());
      await iceComplete(pc);
      const req = whipRequest({ endpoint, sdp: pc.localDescription.sdp, token });
      const resp = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
      const ans = parseWhipAnswer(resp.status, resp.headers, await resp.text());
      if (!ans.ok) { pc.close(); throw new Error(ans.error); }
      await pc.setRemoteDescription({ type: "answer", sdp: ans.answerSdp });
      const resource = ans.resource ? new URL(ans.resource, endpoint).href : "";
      this.live.whip = { pc, resource }; this.emit("live", { kind: "whip", state: "live", endpoint });
      return { resource };
    }
    async stopLiveWhip() {
      const w = this.live.whip; if (!w) return; this.live.whip = null;
      try { if (w.resource) { const d = whipDelete(w.resource); await fetch(d.url, { method: d.method }); } } catch {}
      try { w.pc.close(); } catch {}
    }

    serialize() { return sceneBytes(this); }
    kappa() { return sceneKappa(this); }
  }

  function iceComplete(pc) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((res) => { const t = setTimeout(res, 1500); pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); res(); } }); });
  }

  const HoloStudio = {
    TYPES, TYPE, LAYOUTS, TRANSITIONS, BASES, FPS_CHOICES, REC_MIMES,
    create: (opts) => new Studio(opts), Studio,
    canonicalScene, sceneKappa, kappa, pickMime,
    whipRequest, parseWhipAnswer, whipDelete, version: 1,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = HoloStudio;
  if (typeof self !== "undefined") self.HoloStudio = HoloStudio;
  if (typeof window !== "undefined") window.HoloStudio = HoloStudio;
})();
