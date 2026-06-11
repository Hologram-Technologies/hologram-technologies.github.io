// holo-owncast.js — the live-channel engine for Holo Stream (Owncast, hologram-native).
//
// Drop-in classic script: <script src="_shared/holo-owncast.js"></script> → window.HoloOwncast
// (also self-exposes in Node, so the pure API model + LL-HLS playlist are witnessed for real).
//
// Owncast is a self-hosted, single-broadcaster live channel: RTMP→HLS + a watch page + live
// chat + viewer count + followers + emoji, exposing a small HTTP API (/api/status, /api/config,
// /api/chat, /api/emoji, /api/followers) and a chat event model (CHAT, USER_JOINED, NAME_CHANGE,
// CONNECTED_USER_INFO). The browser-native, serverless realization:
//   • the BROADCASTER is Holo Stream's composited program (no RTMP — browsers can't ingest it);
//   • the OUTPUT is a CONTENT-ADDRESSED LL-HLS stream — the program is segmented (MediaRecorder)
//     into an init segment + media segments, each addressed by its κ; a rolling HLS playlist
//     lists them by κ. A viewer re-derives every segment (Law 5), fetches each κ ONCE (Law 3
//     dedup), O(1) by content — and plays it (MSE / Holo Video). No media server, no CDN.
//   • CHAT + presence ride the existing content-blind κ pub/sub (holo-collab), so the chat
//     converges serverlessly and the viewer count is content-addressed presence.
//
// No DOM is touched at import; the API shapes, the LL-HLS playlist generator, and the segment κ
// are pure (run in the witness). Only Segmenter/Presence use the browser.

(function () {
  "use strict";

  const VERSION = "Owncast/hologram-1.0";
  // Owncast's chat event model (faithful type strings).
  const EVENTS = { CHAT: "CHAT", USER_JOINED: "USER_JOINED", USER_PART: "USER_PART", NAME_CHANGE: "NAME_CHANGE", CONNECTED_USER_INFO: "CONNECTED_USER_INFO", CHAT_ACTION: "CHAT_ACTION" };

  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  async function kappa(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const sub = (globalThis.crypto && globalThis.crypto.subtle) || null;
    if (sub) return "sha256:" + hex(new Uint8Array(await sub.digest("SHA-256", u8)));
    const { createHash } = require("crypto"); return "sha256:" + createHash("sha256").update(Buffer.from(u8)).digest("hex");
  }
  const segmentKappa = kappa;

  // ── the Owncast HTTP API, modeled as content (no server) ────────────────────────────
  // GET /api/status
  function makeStatus(o) {
    o = o || {};
    return { online: !!o.online, viewerCount: o.viewerCount | 0,
      sessionMaxViewerCount: o.sessionMaxViewerCount | 0, overallMaxViewerCount: o.overallMaxViewerCount | 0,
      lastConnectTime: o.lastConnectTime || null, lastDisconnectTime: o.lastDisconnectTime || null,
      streamTitle: o.streamTitle || "", serverTime: o.serverTime || new Date().toISOString(), versionNumber: VERSION };
  }
  // GET /api/config
  function makeConfig(o) {
    o = o || {};
    return { name: o.name || "Holo Channel", summary: o.summary || "", logo: o.logo || "", tags: o.tags || [],
      socialHandles: o.socialHandles || [], streamTitle: o.streamTitle || "", offlineMessage: o.offlineMessage || "This stream is offline.",
      chatDisabled: !!o.chatDisabled, chatRequireAuthentication: false, nsfw: !!o.nsfw, hideViewerCount: !!o.hideViewerCount,
      extraPageContent: o.extraPageContent || "", customStyles: "", appearanceVariables: {} };
  }
  // POST /api/chat/register → an anonymous, content-addressed chat identity
  async function registerUser(displayName) {
    const id = (await kappa(new TextEncoder().encode((displayName || "guest") + ":" + Math.random()))).split(":")[1].slice(0, 24);
    const accessToken = (await kappa(new TextEncoder().encode(id + ":token"))).split(":")[1].slice(0, 32);
    return { id, accessToken, displayName: displayName || ("user-" + id.slice(0, 6)) };
  }
  // a CHAT event (matches Owncast's wire shape closely)
  function chatEvent(user, body) { return { type: EVENTS.CHAT, id: rid(), timestamp: new Date().toISOString(), user: { id: user.id, displayName: user.displayName }, body: String(body || "") }; }
  function systemEvent(type, payload) { return Object.assign({ type, id: rid(), timestamp: new Date().toISOString() }, payload || {}); }
  const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);

  // GET /api/emoji — Owncast ships a default emoji set; here a small content-addressable list
  const DEFAULT_EMOJI = ["😀", "😂", "❤️", "🔥", "🎉", "👍", "🙌", "💎", "🚀", "📈", "💰", "🤑", "👀", "🫡", "🧡"];
  function emojiList() { return DEFAULT_EMOJI.map((e, i) => ({ name: "emoji" + i, emoji: e, url: "" })); }
  // GET /api/followers
  function followersPage(list, offset, limit) { list = list || []; offset = offset | 0; limit = limit || 50; return { total: list.length, results: list.slice(offset, offset + limit) }; }

  // ── LL-HLS playlist (Apple HTTP Live Streaming, low-latency) — PURE generator ────────
  // A rolling LIVE media playlist (no #EXT-X-ENDLIST): an #EXT-X-MAP init segment + the recent
  // media segments, each URI being a holo://κ (content-addressed). LL-HLS partial segments are
  // emitted as #EXT-X-PART. This is byte-faithful HLS that any HLS player (incl. Holo Video's
  // video.js VHS) parses; the URIs resolve by content, so playback re-derives + dedups (Laws 3/5).
  function playlist(opts) {
    opts = opts || {};
    const segs = opts.segments || [];                  // [{ kappa, uri?, duration, parts?:[{kappa,uri?,duration}] }]
    const target = Math.max(1, Math.ceil(opts.targetDuration || 2));
    const seq = opts.mediaSequence | 0;
    const lines = ["#EXTM3U", "#EXT-X-VERSION:9", "#EXT-X-TARGETDURATION:" + target, "#EXT-X-MEDIA-SEQUENCE:" + seq];
    const partTarget = opts.partTarget || 0.5;
    lines.push("#EXT-X-PART-INF:PART-TARGET=" + partTarget.toFixed(3));
    lines.push("#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=" + (partTarget * 3).toFixed(3));
    if (opts.init) lines.push('#EXT-X-MAP:URI="' + uriOf(opts.init) + '"');
    for (const s of segs) {
      for (const p of (s.parts || [])) lines.push('#EXT-X-PART:DURATION=' + (p.duration || partTarget).toFixed(3) + ',URI="' + uriOf(p) + '"');
      lines.push("#EXTINF:" + (s.duration || target).toFixed(3) + ",");
      lines.push(uriOf(s));
    }
    return lines.join("\n") + "\n";
  }
  const uriOf = (s) => s.uri || ("holo://" + (s.kappa || ""));

  // master playlist (one rendition; Owncast offers a ladder — we expose the base rendition)
  function masterPlaylist(opts) {
    opts = opts || {};
    return ["#EXTM3U", "#EXT-X-VERSION:9",
      '#EXT-X-STREAM-INF:BANDWIDTH=' + (opts.bandwidth || 2500000) + ',CODECS="' + (opts.codecs || "avc1.640028,mp4a.40.2") + '",RESOLUTION=' + (opts.resolution || "1280x720"),
      opts.media || "stream.m3u8"].join("\n") + "\n";
  }

  // ── the live segmenter (browser) — program MediaStream → content-addressed segments ──
  class Segmenter {
    constructor(opts) { opts = opts || {}; this.segmentMs = opts.segmentMs || 2000; this.maxSegments = opts.maxSegments || 8; this.mime = opts.mime || pickMime();
      this.init = null; this.segments = []; this._seq = 0; this.onSegment = opts.onSegment || (() => {}); this.onPlaylist = opts.onPlaylist || (() => {}); }
    start(stream) {
      if (this.rec) return; this._stream = stream;
      this.rec = new MediaRecorder(stream, { mimeType: this.mime });
      this.rec.ondataavailable = async (e) => {
        if (!e.data || !e.data.size) return;
        const bytes = new Uint8Array(await e.data.arrayBuffer());
        const k = await kappa(bytes);
        if (!this.init) { this.init = { kappa: k, bytes, duration: 0 }; this.onSegment({ kind: "init", kappa: k, bytes }); return; }
        const seg = { kappa: k, bytes, duration: this.segmentMs / 1000, seq: this._seq++ };
        this.segments.push(seg); while (this.segments.length > this.maxSegments) this.segments.shift();
        this.onSegment({ kind: "media", kappa: k, bytes, seq: seg.seq });
        this.onPlaylist(this.playlist());
      };
      this.rec.start(this.segmentMs); this.online = true; this.startedAt = new Date().toISOString();
    }
    playlist() { return playlist({ init: this.init, segments: this.segments, targetDuration: this.segmentMs / 1000, mediaSequence: Math.max(0, this._seq - this.segments.length) }); }
    stop() { try { this.rec && this.rec.stop(); } catch {} this.rec = null; this.online = false; }
  }
  function pickMime() {
    const MR = (typeof MediaRecorder !== "undefined") ? MediaRecorder : null;
    if (!MR || !MR.isTypeSupported) return "video/webm";
    for (const m of ["video/mp4;codecs=avc1,mp4a", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) if (MR.isTypeSupported(m)) return m;
    return "video/webm";
  }

  // ── presence → viewer count (content-addressed heartbeats; relay-agnostic) ───────────
  class Presence {
    constructor(opts) { opts = opts || {}; this.ttl = opts.ttl || 9000; this.seen = new Map(); }
    beat(id) { this.seen.set(id, Date.now()); }
    drop(id) { this.seen.delete(id); }
    count() { const now = Date.now(); for (const [k, t] of this.seen) if (now - t > this.ttl) this.seen.delete(k); return this.seen.size; }
  }

  const HoloOwncast = {
    VERSION, EVENTS, makeStatus, makeConfig, registerUser, chatEvent, systemEvent, emojiList, followersPage,
    playlist, masterPlaylist, segmentKappa, kappa, Segmenter, Presence, pickMime, version: 1,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = HoloOwncast;
  if (typeof self !== "undefined") self.HoloOwncast = HoloOwncast;
  if (typeof window !== "undefined") window.HoloOwncast = HoloOwncast;
})();
