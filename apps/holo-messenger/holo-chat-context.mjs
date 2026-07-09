// holo-chat-context.mjs — CONTEXT-KEYED CHAT: any κ-object becomes a room you can talk in.
//
// The whole idea in one line: Together (holo-together.mjs) already proves "one link = one live
// shared room", but its `room` is RANDOM. Here the room is DERIVED from a context κ, so everyone
// who opens the SAME context (a video, a game session, a doc, a space, a DM pair) lands in the
// SAME conversation with NO link to exchange. That single change turns every app into a place to talk.
//
// This is `HoloChat.block(contextΚ)` from the build prompt — the App→Chat direction. It is the ONE
// new seam; it rides the proven substrate and adds no server:
//   • room derived, never allocated ................ Law L1 (content, not location)
//   • operate on a canonical context string ........ Law L2 (canonical forms)
//   • messages mirrored to OPFS keyed by room ...... Law L3 (store as memory)
//   • every byte verified by re-derivation ......... Law L5 (verify by re-derivation)
// Transport tiers (cheapest that satisfies presence):
//   • same-device / cross-tab → BroadcastChannel (sub-ms, no relay)
//   • cross-device           → window.HoloTogether ctl datachannel (together-signal + WebRTC)
// Framework-free (matches Together): the same module powers a chat block inside any host app AND
// the unified inbox surface. Node-import-safe: every browser API is feature-guarded.

export const CHAT_CONTEXT_VERSION = 1;

const _te = new TextEncoder();
const _subtle = () => (globalThis.crypto && globalThis.crypto.subtle);
async function _sha256hex(s) {
  const h = await _subtle().digest("SHA-256", _te.encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function _rand() { const b = (globalThis.crypto || crypto).getRandomValues(new Uint8Array(6)); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function _pretty(text) { try { if (typeof window !== "undefined" && window.HoloApps && window.HoloApps.previewOf) return window.HoloApps.previewOf(text) || text; } catch {} return text; }

// ── E2E: seal the wire so the relay/BroadcastChannel carry ciphertext, never plaintext ─────────────
// The key is derived from the context's CANONICAL form: a private room (unguessable random ref) → the key
// is secret to link-holders; a public context → the key is as public as the context already is. Secrecy
// tracks the room. Local OPFS keeps plaintext (on-device, Law L3); only the network wire is encrypted.
const _td = new TextDecoder();
function _b64(u8) { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function _unb64(s) { const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/")); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
export async function roomKey(canon) {
  const base = await _subtle().importKey("raw", _te.encode(String(canon)), "HKDF", false, ["deriveKey"]);
  return _subtle().deriveKey({ name: "HKDF", hash: "SHA-256", salt: _te.encode("holo-chat-room/v1"), info: _te.encode("aesgcm") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function sealWire(key, obj) {
  const iv = (globalThis.crypto || crypto).getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await _subtle().encrypt({ name: "AES-GCM", iv }, key, _te.encode(JSON.stringify(obj))));
  return { i: _b64(iv), c: _b64(ct) };
}
export async function openWire(key, wire) {
  try { if (!wire || !wire.i || !wire.c) return null; const pt = await _subtle().decrypt({ name: "AES-GCM", iv: _unb64(wire.i) }, key, _unb64(wire.c)); return JSON.parse(_td.decode(pt)); } catch { return null; }
}

// The cross-origin rendezvous relay (together-signal). Precedence mirrors holo-together.defaultSignal():
// explicit global → window global → <meta> → localStorage → same origin. "" = no relay (local/offline only).
// The relay is content-blind and stores nothing; it only fans a room's messages out to whoever is subscribed.
export function signalBase() {
  try {
    if (typeof globalThis !== "undefined" && globalThis.HOLO_TOGETHER_SIGNAL) return String(globalThis.HOLO_TOGETHER_SIGNAL);
    if (typeof window !== "undefined" && window.HoloTogetherSignal) return String(window.HoloTogetherSignal);
    if (typeof document !== "undefined" && document.querySelector) { const m = document.querySelector('meta[name="holo-together-signal"]'); if (m && m.content) return m.content; }
    if (typeof localStorage !== "undefined") { const v = localStorage.getItem("holo.together.signal"); if (v) return v; }
  } catch {}
  return (typeof location !== "undefined" ? location.origin : "");
}

// ── the context descriptor → a deterministic room ────────────────────────────────────────────────
// A context is { kind, ref }:
//   kind ∈ watch|listen|game|doc|file|space|feed|model|dm|room  (what you're doing / talking about)
//   ref  = the host object's κ  (a video κ, game-session κ, doc κ, space κ, feed-post κ, model κ)
//          OR, for a DM, an ARRAY of participant κ (order-independent → same room either way).
// Same context anywhere → same canonical string → same κ → same room. No id is ever handed out.
export function canonContext(ctx) {
  const kind = String((ctx && ctx.kind) || "room");
  let ref = ctx && ctx.ref;
  if (Array.isArray(ref)) ref = ref.map(String).sort().join(",");   // DM: participant-set, order-free
  return "holo-chat-ctx|v" + CHAT_CONTEXT_VERSION + "|" + kind + "|" + String(ref == null ? "" : ref);
}

// derive { v, kind, kappa, room, canon } from a context. `room` is a short stable channel id bound
// 1:1 to the κ (so BroadcastChannel / together-signal names stay tidy while κ carries full integrity).
export async function contextRoom(ctx) {
  const canon = canonContext(ctx);
  const kappa = await _sha256hex(canon);
  return { v: CHAT_CONTEXT_VERSION, kind: String((ctx && ctx.kind) || "room"), kappa, room: "cr" + kappa.slice(0, 16), canon };
}

// Law L5: a context-room is trusted only if re-deriving its κ from its canonical form matches, AND
// the room id is the bound prefix of that κ. Any tampered field fails closed.
export async function verifyContextRoom(cr) {
  if (!cr || cr.v !== CHAT_CONTEXT_VERSION || !cr.kappa || !cr.canon) return false;
  if (cr.room !== "cr" + String(cr.kappa).slice(0, 16)) return false;
  // the canonical form is the source of truth — the displayed fields must not lie about it (L5).
  const parts = String(cr.canon).split("|");
  if (parts[0] !== "holo-chat-ctx" || parts[1] !== "v" + CHAT_CONTEXT_VERSION || parts[2] !== cr.kind) return false;
  return (await _sha256hex(cr.canon)) === cr.kappa;
}

// ── the message: a mini hash-linked strand (tamper-evident, order-preserving) ─────────────────────
// id = sha256 of the canonical message, prev = id of the message it extends → the log self-verifies
// and dedups (same author + same clock + same text → same id, so replays collapse).
function _canonMsg(m) {
  return ["v1", m.room || "", m.from || "", String(m.seq | 0), String(m.ts | 0), m.prev || "", m.text || ""].join("␟");
}
export async function makeMessage({ room, from, text, seq, ts, prev = "" }) {
  const m = { room, from: String(from || "anon"), text: String(text == null ? "" : text), seq: seq | 0, ts: ts | 0, prev };
  m.id = await _sha256hex(_canonMsg(m));
  return m;
}
export async function verifyMessage(m) {
  if (!m || !m.id) return false;
  return (await _sha256hex(_canonMsg(m))) === m.id;
}

// ── durable mirror (Law L3): OPFS if present, else localStorage, else in-memory. Keyed by room κ. ──
const _mem = new Map();
async function _opfsRoot() {
  try {
    if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.getDirectory) {
      const root = await navigator.storage.getDirectory();
      return await root.getDirectoryHandle("holo-chat", { create: true });
    }
  } catch {}
  return null;
}
async function loadLog(room) {
  const dir = await _opfsRoot();
  if (dir) {
    try { const fh = await dir.getFileHandle(room + ".json", { create: false }); const f = await fh.getFile(); return JSON.parse(await f.text()); } catch { return []; }
  }
  try { if (typeof localStorage !== "undefined") { const v = localStorage.getItem("holo.chat." + room); return v ? JSON.parse(v) : []; } } catch {}
  return _mem.get(room) || [];
}
async function saveLog(room, log) {
  const dir = await _opfsRoot();
  if (dir) {
    try { const fh = await dir.getFileHandle(room + ".json", { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify(log)); await w.close(); return; } catch {}
  }
  try { if (typeof localStorage !== "undefined") { localStorage.setItem("holo.chat." + room, JSON.stringify(log)); return; } } catch {}
  _mem.set(room, log);
}

// ── the live channel: same-device BroadcastChannel + optional cross-device Together mesh ──────────
// Returns { history, send, onMessage, close }. Verifies every inbound message (L5) and dedups by id.
export async function openContextChannel(ctx, { meName = null, label = null, role = null } = {}) {
  const cr = (ctx && ctx.kappa && ctx.room) ? ctx : await contextRoom(ctx);
  if (!(await verifyContextRoom(cr))) throw new Error("context-room failed verification (L5)");
  const room = cr.room;
  const me = String(meName || ("me-" + (cr.kappa.slice(0, 6))));
  const _label = String(label || (ctx && ctx.label) || (cr.kind + " · " + room));
  let log = (await loadLog(room)).filter(Boolean);
  const seen = new Set(log.map((m) => m.id));
  const listeners = new Set();
  const _key = await roomKey(cr.canon);   // per-room seal key — the wire carries ciphertext only
  // make the room discoverable in the unified inbox immediately (preview from its tail, if any)
  try { const tail = log[log.length - 1]; await registerRoom({ room, kappa: cr.kappa, kind: cr.kind, v: cr.v, canon: cr.canon, label: _label, preview: tail ? _pretty(tail.text) : "", ts: tail ? tail.ts : 0 }); } catch {}

  const _emit = (m) => { for (const cb of listeners) { try { cb(m); } catch {} } };
  const _ingest = async (m) => {
    if (!m || seen.has(m.id)) return false;
    if (!(await verifyMessage(m))) return false;          // L5: reject a lying message
    seen.add(m.id); log.push(m); log.sort((a, b) => (a.ts - b.ts) || (a.seq - b.seq) || (a.id < b.id ? -1 : 1));
    await saveLog(room, log); _emit(m);
    // reflect into the unified inbox: newest preview + time; inbound (not mine) bumps unread.
    try {
      const inbound = m.from !== me;
      const cur = (await _loadIndexRaw()).find((x) => x.room === room);
      await registerRoom({ room, kappa: cr.kappa, kind: cr.kind, v: cr.v, canon: cr.canon, label: _label, preview: (inbound ? m.from + ": " : "") + _pretty(m.text), ts: m.ts, unread: inbound ? ((cur && cur.unread) || 0) + 1 : (cur ? cur.unread : 0) });
    } catch {}
    return true;
  };

  // same-device: BroadcastChannel keyed by the room κ (sub-ms, zero relay)
  let bc = null;
  try { if (typeof BroadcastChannel !== "undefined") { bc = new BroadcastChannel("holo-chat-" + room); bc.onmessage = async (e) => { const m = await openWire(_key, e && e.data); if (m) _ingest(m); }; } } catch {}

  // cross-origin / cross-device: the together-signal relay (content-blind SSE broadcast). Everyone who opens
  // this room — on ANY origin pointed at the same relay — converges. Messages carry their κ id, so every peer
  // re-verifies (L5) and dedups. A late joiner is backfilled our recent tail (directed, dedup-safe). Fail-soft:
  // no relay reachable → the SSE just errors and we fall back to the same-origin BroadcastChannel path.
  let relay = null;
  try {
    const base = signalBase();
    if (base && typeof EventSource !== "undefined") {
      const pid = me + "-" + _rand();
      const es = new EventSource(base + "/signal?room=" + encodeURIComponent(room) + "&peer=" + encodeURIComponent(pid));
      const post = (obj) => { try { fetch(base + "/signal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room, from: pid, ...obj }) }); } catch {} };
      es.onmessage = async (e) => {
        let d; try { d = JSON.parse(e.data); } catch { return; }
        if (!d) return;
        if (d.kind === "holochat" && d.data) { const m = await openWire(_key, d.data); if (m) _ingest(m); }
        else if (d.kind === "peer-join" && d.from && log.length) for (const mm of log.slice(-30)) post({ to: d.from, kind: "holochat", data: await sealWire(_key, mm) });
      };
      relay = { pid, post, close: () => { try { es.close(); } catch {} } };
    }
  } catch {}

  // cross-device on a HOSTED origin (github.io) — where the origin /signal relay 404s — rides the content-blind
  // Nostr mailbox (holo-rendezvous R1/R2, public relays, SEC-7): sealed blobs only, keyed by a coordinate DERIVED
  // from the room κ, so only holders of the room converge. Verify-on-receipt is the same _ingest gate (L5). A
  // throwaway relay key signs events (relay-acceptance only, never a trust root). Fail-soft: no relay → no-op, and
  // BroadcastChannel still carries same-device. `window.__holoChatMailbox` overrides the backend (tests / P6 inject
  // a deterministic mailbox). Gated to 1:1 DM rooms + real hosted origins, so it never fires in Node/localhost.
  let mail = null, rtc = null, rtcStop = false, rtcClose = null;
  try {
    const override = (typeof window !== "undefined" && window.__holoChatMailbox) || null;
    const hosted = typeof location !== "undefined" && !!location.hostname && !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
    if (cr.kind === "dm" && (override || (hosted && typeof WebSocket !== "undefined"))) {
      const rdv = await import("../../usr/lib/holo/holo-rendezvous.mjs");
      const coord = rdv.coordinate(room);
      const mbox = override ? await override({ relays: rdv.DEFAULT_RELAYS }) : await rdv.makeNostrMailbox();
      if (mbox && (!mbox.relayCount || mbox.relayCount() > 0)) {
        const drain = async (blob) => { try { const w = JSON.parse(blob); const m = await openWire(_key, w); if (m) _ingest(m); } catch {} };
        // EVENT-DRIVEN (low-latency): the relay pushes each sealed blob into `onData` the instant it lands — no poll
        // wait — so cross-device latency is bounded by relay RTT (~tens of ms), not a poll interval. A slow 2s poll
        // is kept only as a backstop (and to service mailbox backends, like the test mock, that have no onData).
        const sub = mbox.liveGet(coord, undefined, drain);
        let ri = 0;
        const timer = setInterval(() => { const arr = (sub && sub.collected) || []; while (ri < arr.length) drain(arr[ri++]); }, 150);   // fast fallback (≤150ms) for backends without onData; onData makes the happy path ~RTT
        mail = { post: (sealed) => { try { mbox.put(coord, JSON.stringify(sealed)); } catch {} }, close: () => { try { clearInterval(timer); sub && sub.close && sub.close(); } catch {} } };

        // FAST PATH — a direct WebRTC data channel (sub-RTT, no relay for message bytes). The invite/join asymmetry
        // assigns roles with no glare: the INVITER hosts (answerSide, serve-many re-arm), the JOINER offers. The SDP
        // handshake rides the SAME content-blind mailbox on a DISTINCT coordinate (room|rtc). STUN for NAT; fail-soft
        // — if it never connects (symmetric NAT / no relay), the event-driven mailbox above already carries every
        // message. When the channel opens, sends prefer it. Verify-on-receipt is unchanged (_ingest, L5).
        if (role && typeof RTCPeerConnection !== "undefined" && mbox.get) {
          const ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:global.stun.twilio.com:3478"] }];
          const _hs = [];   // offerSide/answerSide handles → { close } that shuts the RTCPeerConnection (not just the data channel)
          const _closeAll = () => { for (const h of _hs) { try { h && h.close && h.close(); } catch {} } _hs.length = 0; };
          rtcClose = _closeAll;   // so the channel's close() tears the pc(s) down — otherwise ICE churns forever (a real leak)
          const onChannel = (dc) => {
            try {
              dc.onmessage = async (e) => { try { const w = JSON.parse(e.data); const m = await openWire(_key, w); if (m) _ingest(m); } catch {} };
              rtc = { post: (sealed) => { try { if (dc.readyState === "open") dc.send(JSON.stringify(sealed)); } catch {} } };
            } catch {}
          };
          const rk = room + "|rtc";
          if (role === "host") { const arm = () => { if (rtcStop) return; rdv.answerSide({ pairKappa: rk, mailbox: mbox, onChannel, iceServers: ICE }).then((h) => { if (h) _hs.push(h); if (rtcStop) _closeAll(); else arm(); }).catch(() => { if (!rtcStop) setTimeout(arm, 1500); }); }; arm(); }
          else { rdv.offerSide({ pairKappa: rk, mailbox: mbox, onChannel, iceServers: ICE }).then((h) => { if (h) { _hs.push(h); if (rtcStop) _closeAll(); } }).catch(() => {}); }
        }
        mail._mbox = mbox;   // keep a handle so close() can shut the shared mailbox after rtc stops
      } else { try { mbox && mbox.close && mbox.close(); } catch {} }
    }
  } catch {}

  const send = async (text) => {
    const t = String(text == null ? "" : text).trim();
    if (!t) return null;
    const prev = log.length ? log[log.length - 1].id : "";
    const seq = log.length ? (log[log.length - 1].seq | 0) + 1 : 0;
    const m = await makeMessage({ room, from: me, text: t, seq, ts: Date.now(), prev });
    await _ingest(m);
    const sealed = await sealWire(_key, m);   // encrypt before it touches BroadcastChannel / data channel / mailbox
    try { bc && bc.postMessage(sealed); } catch {}
    try { relay && relay.post({ kind: "holochat", data: sealed }); } catch {}
    try { rtc && rtc.post(sealed); } catch {}    // fast path (direct P2P) when the data channel is open…
    try { mail && mail.post(sealed); } catch {}  // …and the content-blind relay always, as the universal fallback (dedup by κ)
    return m;
  };

  return {
    cr, room, kappa: cr.kappa, me,
    history: () => log.slice(),
    onMessage: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    send,
    close: () => { rtcStop = true; try { rtcClose && rtcClose(); } catch {} try { bc && bc.close(); } catch {} try { relay && relay.close(); } catch {} try { mail && mail.close(); mail && mail._mbox && mail._mbox.close && mail._mbox.close(); } catch {} listeners.clear(); },
  };
}

// ── HoloChat.block(contextΚ, {mount}) — the embeddable chat surface (App→Chat) ────────────────────
// Framework-free DOM. Renders a message list + composer into `mount`, wired to openContextChannel.
// A host app calls exactly this and nothing else — that is the combinatorics acceptance test.
export async function block(ctx, { mount, meName = null, placeholder = "Message…", title = null } = {}) {
  if (typeof document === "undefined" || !mount) throw new Error("block() needs a DOM mount");
  const ch = await openContextChannel(ctx, { meName });
  mount.innerHTML = "";
  const root = document.createElement("div"); root.className = "holo-chat-block"; root.style.cssText = "display:flex;flex-direction:column;height:100%;min-height:0;font:14px/1.4 system-ui,sans-serif;color:#e9edef;";
  if (title) { const h = document.createElement("div"); h.textContent = title; h.style.cssText = "padding:8px 12px;font-weight:600;opacity:.85;border-bottom:1px solid #ffffff14;flex:0 0 auto;"; root.appendChild(h); }
  const list = document.createElement("div"); list.className = "holo-chat-list"; list.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:6px;";
  const bar = document.createElement("form"); bar.style.cssText = "flex:0 0 auto;display:flex;gap:8px;padding:10px 12px;border-top:1px solid #ffffff14;";
  const input = document.createElement("input"); input.type = "text"; input.placeholder = placeholder; input.style.cssText = "flex:1;min-height:44px;box-sizing:border-box;background:#2a3942;border:0;border-radius:22px;padding:11px 16px;color:#e9edef;font-size:15px;outline:none;";
  const send = document.createElement("button"); send.type = "submit"; send.textContent = "Send"; send.style.cssText = "min-height:44px;background:#00a884;border:0;border-radius:22px;padding:11px 18px;color:#04160f;font-weight:600;font-size:15px;cursor:pointer;";
  if (typeof window !== "undefined" && window.HoloApps && window.HoloApps.pick) {   // "+" opens the App Tray
    const plus = document.createElement("button"); plus.type = "button"; plus.textContent = "＋"; plus.title = "Add an app";
    plus.style.cssText = "flex:0 0 auto;width:44px;height:44px;background:#202c33;border:0;border-radius:22px;color:#e9edef;font-size:20px;cursor:pointer;";
    plus.onclick = () => window.HoloApps.pick(ch);
    bar.appendChild(plus);
  }
  bar.append(input, send); root.append(list, bar); mount.appendChild(root);

  const atBottom = () => (list.scrollHeight - list.scrollTop - list.clientHeight) < 40;
  const render = (m) => {
    const mine = m.from === ch.me;
    const row = document.createElement("div"); row.style.cssText = "max-width:78%;align-self:" + (mine ? "flex-end" : "flex-start") + ";background:" + (mine ? "#005c4b" : "#202c33") + ";border-radius:8px;padding:6px 10px;word-wrap:break-word;";
    if (!mine) { const who = document.createElement("div"); who.textContent = m.from; who.style.cssText = "font-size:13px;opacity:.7;margin-bottom:2px;"; row.appendChild(who); }
    let bodyEl;   // an app-card message renders as a tappable card (delegated to HoloApps); else plain text
    if (typeof window !== "undefined" && window.HoloApps && window.HoloApps.isCard && window.HoloApps.isCard(m.text)) bodyEl = window.HoloApps.renderCard(m.text, ch);
    else { bodyEl = document.createElement("div"); bodyEl.textContent = m.text; }
    row.appendChild(bodyEl);
    const stick = atBottom(); list.appendChild(row); if (stick) list.scrollTop = list.scrollHeight;
  };
  for (const m of ch.history()) render(m);
  list.scrollTop = list.scrollHeight;
  ch.onMessage(render);
  bar.addEventListener("submit", async (e) => { e.preventDefault(); const t = input.value; input.value = ""; await ch.send(t); });
  return { channel: ch, root, destroy: () => { ch.close(); mount.innerHTML = ""; } };
}

// ── UNIFIED INBOX (Moss cross-group chat): every context-chat, one list ───────────────────────────
// The payoff of context-keyed rooms: because every chat — a game lobby, a watch party, a DM, a doc
// thread — writes into the same registry keyed by its room κ, they ALL appear in one inbox with no
// per-app wiring. "Talk with people from all your contexts without switching." The index is a small
// derived cache (Law L3): rooms are re-discoverable from their logs; this is just the fast list.

const INDEX_KEY = "holo.chat.index";
let _idxBC = null;
const _idxListeners = new Set();   // in-page subscribers (a BroadcastChannel never delivers to itself)
function _indexBus() {
  try { if (!_idxBC && typeof BroadcastChannel !== "undefined") _idxBC = new BroadcastChannel("holo-chat-index"); } catch {}
  return _idxBC;
}
// notify BOTH other tabs (BroadcastChannel) AND same-page inbox listeners.
function _emitIndex(room) {
  try { const bus = _indexBus(); bus && bus.postMessage({ kind: "index", room }); } catch {}
  for (const cb of _idxListeners) { try { cb(room); } catch {} }
}
async function _loadIndexRaw() {
  const dir = await _opfsRoot();
  if (dir) { try { const fh = await dir.getFileHandle("_index.json", { create: false }); const f = await fh.getFile(); return JSON.parse(await f.text()); } catch { return []; } }
  try { if (typeof localStorage !== "undefined") { const v = localStorage.getItem(INDEX_KEY); return v ? JSON.parse(v) : []; } } catch {}
  return _mem.get(INDEX_KEY) || [];
}
async function _saveIndexRaw(ix) {
  const dir = await _opfsRoot();
  if (dir) { try { const fh = await dir.getFileHandle("_index.json", { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify(ix)); await w.close(); return; } catch {} }
  try { if (typeof localStorage !== "undefined") { localStorage.setItem(INDEX_KEY, JSON.stringify(ix)); return; } } catch {}
  _mem.set(INDEX_KEY, ix);
}

// PURE: merge one room entry into the index (newest first). Witnessed headlessly.
export function upsertRoomEntry(index, e) {
  const i = index.findIndex((x) => x.room === e.room);
  if (i < 0) index.push({ unread: 0, ...e });
  else {
    const prev = index[i];
    index[i] = { ...prev, ...e, unread: (e.unread == null ? prev.unread : e.unread) };
  }
  index.sort((a, b) => (b.ts || 0) - (a.ts || 0) || (a.room < b.room ? -1 : 1));
  return index;
}

export async function listRooms() { return await _loadIndexRaw(); }
export async function registerRoom(entry) {
  const ix = upsertRoomEntry(await _loadIndexRaw(), entry);
  await _saveIndexRaw(ix);
  _emitIndex(entry.room);
  return ix;
}
export async function clearUnread(room) {
  const ix = await _loadIndexRaw(); const i = ix.findIndex((x) => x.room === room);
  if (i >= 0 && ix[i].unread) { ix[i].unread = 0; await _saveIndexRaw(ix); _emitIndex(room); }
  return ix;
}

// the inbox surface: renders listRooms() and live-updates on the index bus. Click → onOpen(entry).
export async function inbox(mount, { onOpen = () => {}, meName = null, empty = "No conversations yet." } = {}) {
  if (typeof document === "undefined" || !mount) throw new Error("inbox() needs a DOM mount");
  const _KIND_ICON = { watch: "🎬", listen: "🎵", game: "🎮", doc: "📝", file: "📎", space: "✨", feed: "📣", model: "🧠", dm: "💬", room: "#️⃣" };
  mount.innerHTML = "";
  const root = document.createElement("div"); root.className = "holo-chat-inbox"; root.style.cssText = "display:flex;flex-direction:column;height:100%;min-height:0;overflow-y:auto;font:14px/1.4 system-ui,sans-serif;color:#e9edef;";
  mount.appendChild(root);
  const draw = async () => {
    const rooms = await listRooms();
    root.innerHTML = "";
    if (!rooms.length) { const e = document.createElement("div"); e.textContent = empty; e.style.cssText = "opacity:.5;padding:16px;"; root.appendChild(e); return; }
    for (const r of rooms) {
      const row = document.createElement("button"); row.type = "button"; row.dataset.room = r.room;
      row.style.cssText = "display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid #ffffff0d;padding:10px 12px;color:inherit;cursor:pointer;";
      const ic = document.createElement("div"); ic.textContent = _KIND_ICON[r.kind] || "#️⃣"; ic.style.cssText = "font-size:20px;width:34px;height:34px;display:grid;place-items:center;background:#202c33;border-radius:50%;flex:0 0 auto;";
      const mid = document.createElement("div"); mid.style.cssText = "flex:1;min-width:0;";
      const top = document.createElement("div"); top.style.cssText = "display:flex;justify-content:space-between;gap:8px;";
      const name = document.createElement("div"); name.textContent = r.label || (r.kind + " · " + r.room); name.style.cssText = "font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      const time = document.createElement("div"); time.textContent = r.ts ? new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""; time.style.cssText = "font-size:13px;opacity:.5;flex:0 0 auto;";
      const prev = document.createElement("div"); prev.textContent = r.preview || ""; prev.style.cssText = "font-size:13px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      top.append(name, time); mid.append(top, prev); row.append(ic, mid);
      if (r.unread) { const b = document.createElement("div"); b.textContent = r.unread; b.style.cssText = "background:#00a884;color:#04160f;font-size:13px;font-weight:700;min-width:20px;height:20px;border-radius:10px;display:grid;place-items:center;padding:0 6px;flex:0 0 auto;"; row.appendChild(b); }
      row.addEventListener("click", async () => { await clearUnread(r.room); onOpen(r); });
      root.appendChild(row);
    }
  };
  await draw();
  const h = () => draw();
  _idxListeners.add(h);                                                   // same-page updates (self-posts)
  try { const bus = _indexBus(); if (bus) bus.addEventListener("message", h); } catch {}   // cross-tab updates
  return { refresh: draw, root, destroy: () => { _idxListeners.delete(h); try { const bus = _indexBus(); bus && bus.removeEventListener("message", h); } catch {} } };
}

// install window.HoloChat so any host app can `HoloChat.block(ctx, {mount})` with zero imports
export function installHoloChat() {
  if (typeof window === "undefined") return false;
  window.HoloChat = Object.assign(window.HoloChat || {}, { version: CHAT_CONTEXT_VERSION, contextRoom, verifyContextRoom, openContextChannel, block, canonContext, inbox, listRooms, registerRoom, clearUnread, upsertRoomEntry, signalBase, roomKey, sealWire, openWire });
  return true;
}
try { installHoloChat(); } catch {}
