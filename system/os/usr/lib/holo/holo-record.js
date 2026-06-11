// holo-record.js — HOLO RECORD: the ONE hologram-native recorder of your ENTIRE activity in
// Hologram OS. A single, always-on, auditable feature with one obvious home — it records your day
// and pours it into your Holo Notepad SOVEREIGN DAILY GRAPH, the private UOR-substrate-native
// context layer for sovereign social / knowledge / internet graphs and the semantic open web.
//
// (Merges the former holo-activity.js — "sense WHAT you do" — with the screen recorder —
//  "capture the PIXELS" — into one feature: recording your activity IS recording, whether the
//  bytes are an app you opened or a clip you made. One module, one global, no drift.)
//
// TWO faces, one κ-addressed home:
//   • SENSE — on EVERY holospace frame (loaded by holo-manage.js) it senses which app / page /
//     article you opened and who you are meeting, and emits a CONTENT-BLIND activity event onto a
//     BroadcastChannel + a localStorage inbox, so your day is recorded even when Holo Notepad is
//     closed. Holo Notepad drains the stream into the memory bank with mountRecorder(bank).
//   • PIXELS — capture a MediaStream (W3C Screen Capture getDisplayMedia · Media Capture
//     getUserMedia · this tab · any stream), encode it with the platform MediaRecorder, and the
//     resulting bytes ARE the address (Law L1/L2): κ = sha256(bytes), axis-prefixed. A saved clip
//     is a holo://κ — pinnable, shareable, re-derivable forever; one flipped byte is a different
//     clip (Law L5). 100% local; nothing is uploaded by default.
//
// THE BRIDGE — a recording is just another activity: on stop() a clip emits a kind:"recording"
// event carrying its holo://κ, so the clip lands on today's Daily Note as a content-addressed
// block alongside your visits and interactions. ONE master KILL-SWITCH (the OS-wide
// holo-memory-capture flag) pauses ALL capture — sensing and recording — in one place.
//
// No deps, no CDN. Pure + Node-safe where it can be: the DOM auto-probe and live media capture run
// only in a browser; the transport, kill-switch, recorder state machine (which accepts an injected
// MediaRecorder), κ, and clip metadata all run headless, so the witness exercises the real feature.

(function () {
  "use strict";
  const G = typeof globalThis !== "undefined" ? globalThis : (typeof self !== "undefined" ? self : window);
  if (G.HoloRecord) return;
  const hasWin = typeof window !== "undefined" && typeof document !== "undefined";
  const W = hasWin ? window : G;

  // ════════════════════════════════════════════════════════════════════════════════════
  // FACE 1 — SENSE: the content-blind activity stream + the OS-wide kill-switch.
  // ════════════════════════════════════════════════════════════════════════════════════
  const CHANNEL = "holo-memory", INBOX = "holo-memory-inbox", CAP_FLAG = "holo-memory-capture";
  const ls = () => { try { return (hasWin && window.localStorage) || G.localStorage || null; } catch { return null; } };

  // ── master kill-switch (OS-wide, persisted; in-memory fallback when headless) ──────
  let _capMem = true;
  function captureOn() { const s = ls(); if (s) { try { return s.getItem(CAP_FLAG) !== "off"; } catch {} } return _capMem; }
  function setCapture(on) { _capMem = !!on; const s = ls(); if (s) { try { s.setItem(CAP_FLAG, on ? "on" : "off"); } catch {} } }

  // ── transport — broadcast on a content-blind channel + buffer to the inbox ─────────
  function emit(ev) {
    if (!captureOn()) return null;
    ev = { ts: Date.now(), source: "frame", ...ev };
    try { const ch = new BroadcastChannel(CHANNEL); ch.postMessage(ev); ch.close(); } catch {}
    const s = ls(); if (s) { try { const a = JSON.parse(s.getItem(INBOX) || "[]"); a.push(ev); s.setItem(INBOX, JSON.stringify(a.slice(-500))); } catch {} }
    return ev;
  }

  // ── source adapters — sense the current frame → an activity event ──────────────────
  function probe() {
    if (!hasWin) return null;
    const loader = (location.pathname.split("/").pop() || "").toLowerCase();
    if (/^(notepad|holospace|boot|splash)\.html$/.test(loader)) return null;     // self / shells — record the app, not the shell
    const app = (document.title || "").trim() || loader.replace(/\.html$/, "");
    // article capture — if this frame is Holo Browser, it minted a κ for the page
    try { const B = W.HoloBrowser; const cur = B && typeof B.current === "function" ? B.current() : null;
      if (cur && (cur.url || cur.title)) return emit({ kind: "visit", app: "Holo Browser", title: cur.title || "", url: cur.url || "", kappa: cur.kappa || cur.did || "", entities: cur.title ? [cur.title] : [], source: "browser" }); } catch {}
    // interaction capture — if this frame is a live collaborative session, record who you're with
    try { const h = W.__holoMeet || W.__holoDocs || W.__holoGit || W.__holoCloud; const roster = h && typeof h.roster === "function" ? h.roster() : null;
      const peers = roster ? roster.filter((r) => !r.you).map((r) => r.name).filter(Boolean) : [];
      if (peers.length) return emit({ kind: "interaction", app, entities: peers, source: "collab", summary: "live session" }); } catch {}
    return emit({ kind: "visit", app, title: "", url: location.href, source: "frame" });   // generic frame visit
  }

  // ── consumer side — drain the inbox + subscribe to the live bus into a sink (a bank) ─
  function drain() { const s = ls(); if (!s) return []; try { const a = JSON.parse(s.getItem(INBOX) || "[]"); s.setItem(INBOX, "[]"); return a; } catch { return []; } }
  function subscribe(fn) { let ch = null; try { ch = new BroadcastChannel(CHANNEL); ch.onmessage = (e) => fn(e.data); } catch {} return () => { try { ch && ch.close(); } catch {} }; }
  function mountRecorder(bank, { onIngest } = {}) {
    const seen = new Set();
    const take = async (ev) => { const k = await bank.ingest(ev); if (k && !seen.has(k)) { seen.add(k); onIngest && onIngest(bank.get(k)); } };
    drain().forEach(take);                 // history captured while Notepad was closed
    const off = subscribe(take);           // live stream while it's open
    return { stop() { off(); } };
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  // FACE 2 — PIXELS: capture a MediaStream → a content-addressed κ clip (holo://κ).
  // ════════════════════════════════════════════════════════════════════════════════════
  // ── κ — content address of the exact recorded bytes (sha256, axis-prefixed) ──────────
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  async function kappa(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const subtle = (G.crypto && G.crypto.subtle) || null;
    if (subtle) return "sha256:" + hex(new Uint8Array(await subtle.digest("SHA-256", u8)));
    const { createHash } = require("crypto");          // Node without global webcrypto
    return "sha256:" + createHash("sha256").update(Buffer.from(u8)).digest("hex");
  }
  const holoUrl = (k) => "holo://" + String(k || "").replace(/^sha256:/, "sha256:");   // holo://sha256:…
  const didOf = (k) => "did:holo:" + String(k || "");                                  // did:holo:sha256:…
  const utf8 = (s) => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, "utf8")));

  // ── mime — faithful codec preference (OBS records H.264/AAC; then the open web codecs) ─
  const REC_MIMES = [
    "video/mp4;codecs=h264,aac",      // OBS's native H.264/AAC, when the browser offers it
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=av1,opus",
    "video/webm", "video/mp4",
  ];
  // pickMime(prefer?) — honour an explicit preference if supported, else the best supported one.
  function pickMime(prefer) {
    const MR = (typeof G.MediaRecorder !== "undefined") ? G.MediaRecorder : null;
    if (!MR || !MR.isTypeSupported) return prefer || "video/webm";
    if (prefer && MR.isTypeSupported(prefer)) return prefer;
    for (const m of REC_MIMES) if (MR.isTypeSupported(m)) return m;
    return "video/webm";
  }
  const extFor = (mime) => (/mp4/.test(mime) ? "mp4" : "webm");

  // ── sources — W3C capture targets a recording can open (browser only) ────────────────
  const SOURCES = [
    { id: "screen", label: "Entire Screen", via: "getDisplayMedia", audio: true },
    { id: "window", label: "Application Window", via: "getDisplayMedia", audio: true },
    { id: "tab",    label: "This Holospace (tab)", via: "getDisplayMedia", audio: true, preferCurrentTab: true },
    { id: "camera", label: "Camera", via: "getUserMedia", audio: true },
    { id: "audio",  label: "Microphone only", via: "getUserMedia", audio: true, novideo: true },
  ];
  const SOURCE = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
  // open a MediaStream for a source id (or pass a ready stream straight through)
  async function openSource(target, opts = {}) {
    if (target && typeof target === "object" && typeof target.getTracks === "function") return target;   // already a stream
    const s = SOURCE[target] || SOURCE.screen;
    const md = (G.navigator && G.navigator.mediaDevices) || null;
    if (!md) throw new Error("HoloRecord: navigator.mediaDevices unavailable (browser only)");
    const fps = opts.fps || 30;
    if (s.via === "getDisplayMedia")
      return md.getDisplayMedia({ video: { frameRate: fps }, audio: opts.audio !== false, preferCurrentTab: !!s.preferCurrentTab });
    // getUserMedia (camera / mic)
    return md.getUserMedia(s.novideo
      ? { audio: true }
      : { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: fps, deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined }, audio: opts.audio !== false });
  }

  // ── canonical clip metadata → its own κ (a .holorec sidecar; Law L2) ─────────────────
  function stableStringify(x) {
    if (x === null || typeof x !== "object") return JSON.stringify(x);
    if (Array.isArray(x)) return "[" + x.map(stableStringify).join(",") + "]";
    const k = Object.keys(x).sort();
    return "{" + k.map((kk) => JSON.stringify(kk) + ":" + stableStringify(x[kk])).join(",") + "}";
  }
  function clipMeta(c) {
    const pub = { v: 1, kind: "holo-record", kappa: c.kappa || "", mime: c.mime || "", duration: Math.round((c.duration || 0) * 1000) / 1000,
      width: c.width | 0, height: c.height | 0, size: c.size | 0, source: c.source || "" };
    return pub;
  }
  const metaBytes = (c) => utf8(stableStringify(clipMeta(c)));
  async function metaKappa(c) { return kappa(metaBytes(c)); }

  // ── the BRIDGE — a finished clip becomes an activity event (pixels → daily graph) ─────
  // emit a content-addressed recording onto the SAME activity stream, so the clip lands on today's
  // Daily Note as a holo://κ block alongside your visits/interactions. Gated by the kill-switch.
  function emitRecording(clip, extra = {}) {
    if (!clip || !clip.kappa) return null;
    const label = extra.title || (SOURCE[clip.source] && SOURCE[clip.source].label) || "Screen recording";
    return emit({
      kind: "recording", app: extra.app || "Holo Record", title: label,
      url: clip.holoUrl || holoUrl(clip.kappa), kappa: clip.kappa,
      entities: extra.entities || [], source: "record",
      summary: extra.summary || (`${Math.round(clip.duration || 0)}s ${clip.source || ""} clip`).trim(),
      mime: clip.mime || "", size: clip.size | 0, durationMs: Math.round((clip.duration || 0) * 1000),
    });
  }

  // ════════════════════════════════════════════════════════════════════════════════════
  // Recorder — a small state machine over MediaRecorder. The recorded bytes become a κ clip.
  // `opts.MediaRecorder` / a passed-in stream let the witness drive the whole lifecycle with
  // no DOM. `opts.toGraph` auto-records a finished clip into your daily graph (the bridge).
  // States: "idle" → "recording" ⇄ "paused" → "stopped".
  // ════════════════════════════════════════════════════════════════════════════════════
  class Recorder {
    constructor(opts = {}) {
      this.state = "idle";
      this.mime = null;
      this.source = opts.source || "";
      this.width = opts.width | 0;
      this.height = opts.height | 0;
      this._chunks = [];
      this._t0 = 0; this._elapsed = 0; this._pausedAt = 0;
      this._cb = opts.on || (() => {});
      this._MR = opts.MediaRecorder || G.MediaRecorder || null;
      this._toGraph = !!opts.toGraph;                 // bridge: emit a recording activity event on stop
      this._graphMeta = opts.graphMeta || {};
      this.stream = null;
      this.rec = null;
    }
    emit(ev, data) { try { this._cb(ev, data); } catch {} }
    get recording() { return this.state === "recording" || this.state === "paused"; }
    _now() { return (G.performance && typeof G.performance.now === "function") ? G.performance.now() : Date.now(); }

    // start(streamOrTargetId, opts) — open/accept a stream and begin encoding.
    async start(target, opts = {}) {
      if (this.state === "recording" || this.state === "paused") return this;
      if (!this._MR) throw new Error("HoloRecord: MediaRecorder unavailable (browser only)");
      this.stream = await openSource(target, opts);
      if (!this.source && typeof target === "string") this.source = target;
      this.mime = pickMime(opts.mime);
      const conf = { mimeType: this.mime };
      if (opts.videoBitsPerSecond) conf.videoBitsPerSecond = opts.videoBitsPerSecond;
      this.rec = new this._MR(this.stream, conf);
      this._chunks = [];
      this.rec.ondataavailable = (e) => { if (e && e.data && (e.data.size || e.data.byteLength)) this._chunks.push(e.data); };
      // user clicks the browser "Stop sharing" → finalize the clip
      try { this.stream.getVideoTracks && this.stream.getVideoTracks().forEach((tr) => (tr.onended = () => { if (this.recording) this.stop(); })); } catch {}
      this.rec.start(opts.timeslice || 1000);
      this._t0 = this._now(); this._elapsed = 0; this.state = "recording";
      this.emit("state", { state: "recording", mime: this.mime, source: this.source });
      return this;
    }
    pause() {
      if (this.state !== "recording") return false;
      try { this.rec.pause(); } catch {}
      this._elapsed += this._now() - this._t0; this.state = "paused";
      this.emit("state", { state: "paused" }); return true;
    }
    resume() {
      if (this.state !== "paused") return false;
      try { this.rec.resume(); } catch {}
      this._t0 = this._now(); this.state = "recording";
      this.emit("state", { state: "recording" }); return true;
    }
    // duration in seconds, excluding paused spans
    duration() { return (this._elapsed + (this.state === "recording" ? this._now() - this._t0 : 0)) / 1000; }

    // stop() → the content-addressed clip { blob, bytes, kappa, holoUrl, did, mime, duration, width, height, size, source }
    async stop() {
      if (this.state === "idle" || this.state === "stopped") return null;
      const dur = this.duration();
      const done = new Promise((res) => { this.rec.onstop = res; });
      try { this.rec.stop(); } catch {}
      await done;
      try { this.stream && this.stream.getTracks && this.stream.getTracks().forEach((t) => t.stop && t.stop()); } catch {}
      this.state = "stopped";
      const BlobC = G.Blob || (typeof Blob !== "undefined" ? Blob : null);
      const blob = BlobC ? new BlobC(this._chunks, { type: this.mime }) : null;
      const bytes = blob ? new Uint8Array(await blob.arrayBuffer())
        : concatChunks(this._chunks);
      const k = await kappa(bytes);
      const clip = { blob, bytes, kappa: k, holoUrl: holoUrl(k), did: didOf(k), mime: this.mime,
        duration: dur, width: this.width, height: this.height, size: bytes.length, source: this.source };
      this.emit("state", { state: "stopped", ...clip });
      if (this._toGraph) emitRecording(clip, this._graphMeta);     // the bridge: pixels → your daily graph
      return clip;
    }
    // browser helpers
    objectUrl(clip) { return (clip && clip.blob && G.URL && G.URL.createObjectURL) ? G.URL.createObjectURL(clip.blob) : ""; }
    download(clip, name) {
      if (!clip || !clip.blob || typeof document === "undefined") return false;
      const a = document.createElement("a"); a.href = this.objectUrl(clip);
      a.download = name || ("holo-record." + extFor(clip.mime)); a.click();
      setTimeout(() => { try { G.URL.revokeObjectURL(a.href); } catch {} }, 4000); return true;
    }
  }
  // fold raw chunks (Uint8Array / ArrayBuffer) when Blob is unavailable
  function concatChunks(chunks) {
    const arrs = chunks.map((c) => c instanceof Uint8Array ? c : new Uint8Array(c.buffer || c));
    let n = 0; for (const a of arrs) n += a.length; const o = new Uint8Array(n); let p = 0;
    for (const a of arrs) { o.set(a, p); p += a.length; } return o;
  }

  const create = (opts) => new Recorder(opts);
  // one-shot: open + start; caller holds the recorder and calls .stop() later.
  async function record(target, opts) { const r = new Recorder(opts); await r.start(target, opts); return r; }

  // ── unified headless self-test (the witness runs this; pure parts + injected MediaRecorder) ─
  async function selfTest() {
    const checks = []; const ok = (c, m) => { checks.push({ ok: !!c, msg: m }); return !!c; };

    // ── PIXELS ──
    ok(REC_MIMES[0] === "video/mp4;codecs=h264,aac", "REC_MIMES prefers OBS-native H.264/AAC first");
    ok(typeof pickMime() === "string" && pickMime().length > 0, "pickMime() always returns a usable mime (webm fallback)");
    const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const c = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 9]);
    const ka = await kappa(a), kb = await kappa(b), kc = await kappa(c);
    ok(/^sha256:[0-9a-f]{64}$/.test(ka), "κ = sha256 over the exact bytes (64 hex, axis-prefixed)");
    ok(ka === kb, "Law L5 — identical recorded bytes re-derive to the SAME κ");
    ok(ka !== kc, "Law L5 — one flipped byte yields a DIFFERENT κ (a forged clip is refused)");
    ok(holoUrl(ka) === "holo://" + ka && didOf(ka) === "did:holo:" + ka, "a clip is addressable as holo://κ and did:holo:…");
    const m1 = await metaKappa({ kappa: ka, mime: "video/webm", duration: 2.0, width: 1280, height: 720, size: 8, source: "screen" });
    const m2 = await metaKappa({ source: "screen", size: 8, height: 720, width: 1280, duration: 2.0, mime: "video/webm", kappa: ka });
    ok(m1 === m2, "clip metadata (.holorec) canonicalizes to a stable κ regardless of key order");
    ok(SOURCE.screen && SOURCE.window && SOURCE.tab && SOURCE.camera, "sources: screen · window · this-tab · camera · mic");
    ok(SOURCE.tab.preferCurrentTab === true && SOURCE.camera.via === "getUserMedia", "tab capture uses preferCurrentTab; camera uses getUserMedia");
    const FakeMR = makeFakeMediaRecorder();
    const r = new Recorder({ MediaRecorder: FakeMR, width: 1280, height: 720 });
    ok(r.state === "idle", "a fresh recorder is idle");
    await r.start(fakeStream(), { source: "screen", timeslice: 10 });
    ok(r.state === "recording" && r.recording === true, "start() → recording");
    ok(r.pause() === true && r.state === "paused", "pause() → paused");
    ok(r.resume() === true && r.state === "recording", "resume() → recording");
    const clip = await r.stop();
    ok(r.state === "stopped", "stop() → stopped");
    ok(clip && /^sha256:[0-9a-f]{64}$/.test(clip.kappa) && clip.size > 0, "stop() yields a content-addressed κ clip with bytes");
    ok(clip.width === 1280 && clip.height === 720 && clip.mime && clip.duration >= 0, "the clip carries mime + dimensions + duration");
    const r2 = new Recorder({ MediaRecorder: FakeMR });
    await r2.start(fakeStream()); const clip2 = await r2.stop();
    ok(clip2.kappa === clip.kappa, "Law L5 — two recordings of identical bytes mint the IDENTICAL κ");
    const mediaOk = checks.every((x) => x.ok);

    // ── SENSE — the content-blind activity stream + the OS-wide master kill-switch ──
    const prev = captureOn();
    setCapture(false); const blocked = emit({ kind: "visit", app: "X" });        // kill-switch ⇒ nothing emitted
    setCapture(true); const passed = emit({ kind: "visit", app: "Y" });
    const killOk = blocked === null && passed != null && passed.app === "Y";
    ok(killOk, "master kill-switch: capture OFF emits nothing; ON emits the event");
    ok(typeof probe === "function" && typeof mountRecorder === "function" && typeof drain === "function" && typeof subscribe === "function",
      "activity-stream API present (probe · mountRecorder · drain · subscribe)");

    // ── BRIDGE — a finished clip becomes a recording activity event (pixels → daily graph) ──
    const recEv = emitRecording(clip, { app: "Holo Record" });
    const bridgeOk = !!recEv && recEv.kind === "recording" && recEv.kappa === clip.kappa && /^holo:\/\/sha256:/.test(recEv.url) && recEv.source === "record";
    ok(bridgeOk, "the bridge: a finished recording emits a kind:'recording' activity event carrying its holo://κ");
    setCapture(false); const recBlocked = emitRecording(clip) === null; setCapture(true);
    ok(recBlocked, "the ONE kill-switch also pauses media-recording capture (sensing + recording, one switch)");
    setCapture(prev);

    return { ok: checks.every((x) => x.ok), mediaOk, killOk, bridgeOk, checks };
  }

  // a tiny MediaRecorder-shaped fake: emits two fixed data chunks then fires onstop (headless).
  function makeFakeMediaRecorder() {
    const PAYLOAD = [new Uint8Array([72, 79, 76, 79]), new Uint8Array([82, 69, 67])];   // "HOLO","REC"
    return class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      constructor(stream, conf) { this.stream = stream; this.mimeType = (conf && conf.mimeType) || "video/webm"; this.state = "inactive"; this.ondataavailable = null; this.onstop = null; }
      start() { this.state = "recording"; for (const p of PAYLOAD) this.ondataavailable && this.ondataavailable({ data: chunkBlob(p) }); }
      pause() { this.state = "paused"; }
      resume() { this.state = "recording"; }
      stop() { this.state = "inactive"; const cb = this.onstop; if (cb) cb({}); }
    };
    function chunkBlob(u8) {
      const B = G.Blob || (typeof Blob !== "undefined" ? Blob : null);
      if (B) return new B([u8], { type: "video/webm" });
      return { size: u8.length, byteLength: u8.length, buffer: u8.buffer };       // last-resort raw chunk
    }
  }
  function fakeStream() { return { getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] }; }

  // ── auto-run on every frame — the ubiquitous, always-on sensing (browser only) ──────
  if (hasWin) {
    const boot = () => { probe(); addEventListener("visibilitychange", () => { if (!document.hidden) probe(); }); addEventListener("focus", probe); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  }

  const HoloRecord = {
    // sense — the activity stream + kill-switch (the capture layer behind your daily graph)
    emit, probe, drain, subscribe, mountRecorder, captureOn, setCapture, emitRecording,
    CHANNEL, INBOX, CAP_FLAG,
    // pixels — the screen / camera recorder → a content-addressed clip
    REC_MIMES, SOURCES, SOURCE, pickMime, extFor, openSource,
    kappa, holoUrl, didOf, clipMeta, metaKappa, stableStringify,
    Recorder, create, record,
    // one unified headless self-test
    selfTest, version: 2,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = HoloRecord;
  if (typeof self !== "undefined") self.HoloRecord = HoloRecord;
  if (typeof window !== "undefined") window.HoloRecord = HoloRecord;
  G.HoloRecord = HoloRecord;
})();
